/**
 * `0 scan <target>`: a thread that follows the `scan` skill, then its findings as a report.
 *
 * No scan logic lives here. The command resolves the target to a folder, starts a thread with
 * the skill and a budget, waits, and prints what the thread recorded
 * (docs/design/scan-as-a-thread.md). The thread shows up in `0 threads` like any other.
 */
import { execFile, spawn } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { Command } from "commander";
import { buildInventory, CLAUDE_CODE_DEFAULT_MODEL, claudeCodeConfigured, exportReport, isReportExportFormat, type Batch } from "@0/engine";
import { CoverageLedger, coverageSentence, summarizeCoverage } from "@0/engine/storage";
import { consoleTransportOptions, openConsole, type ConsoleClient, type ConsoleTransportOptions } from "../console-client.js";
import { homeStateDir, parseSarif, parseScannerList, scanPrompt, scannerArguments, scannerById, scannerTakesRules, SCANNERS, type PrePassLeads, type BatchPromptInfo, type ScanReport } from "@0/engine/shared";
import { runPrePass } from "../prepass.js";
import { checkRulesScanners, resolveRulePaths } from "../scan-rules.js";
import { mergePasses, scanExitCode, scanJson, toScanReport, type ScanOutcome } from "../scan-report.js";
import { coverageReport, runBatches, type BatchOutcome } from "../scan-batches.js";
import { coverageJson, coverageText, DEFAULT_BATCH_SIZE, planBatchedScan, type BatchedSetup } from "../scan-batched.js";
import { planScan, planText } from "../scan-plan.js";
import { resumeHint, type ResumeHint } from "../scan-resume.js";
import { loadSteering, type Steering } from "../scan-steering.js";
import { finishWithError, UsageError } from "./output.js";
import { asJson, finishedThread, lastAssistantText, usageLine, type FinishedThread, type Json } from "./thread-output.js";

const exec = promisify(execFile);
const FORMATS = ["json", "md", "sarif", "html", "pdf"] as const;
const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
const DEFAULT_BUDGET_USD = 5;
/** Chosen by measurement: on the same one-file scan it finished in 26s and $0.0014 and recorded its finding first try; glm-5.3-flash took minutes and rejected a dozen `finding` calls. */
export const DEFAULT_SCAN_MODEL = "gpt-6-luna";
/** `--model` help for the thread commands. */
export const DEFAULT_MODEL_HELP = `default: ${CLAUDE_CODE_DEFAULT_MODEL} with a Claude subscription, otherwise ${DEFAULT_SCAN_MODEL}`;

/**
 * The model a scan, fix, verify or threat-model thread runs on without
 * `--model`: the Claude subscription's default when Claude Code is detected
 * (or selected with ZERO_SELECTED_PROVIDER=claude-code), otherwise the
 * measured upstream default. Another pinned provider keeps the upstream default.
 */
export function defaultScanModel(env: Readonly<NodeJS.ProcessEnv> = process.env): string {
  const pinned = (env["ZERO_FORCE_PROVIDER"] || env["ZERO_SELECTED_PROVIDER"] || env["ZERO_PROVIDER"])?.trim();
  if (pinned) return pinned === "claude-code" ? CLAUDE_CODE_DEFAULT_MODEL : DEFAULT_SCAN_MODEL;
  return claudeCodeConfigured(env) ? CLAUDE_CODE_DEFAULT_MODEL : DEFAULT_SCAN_MODEL;
}
const DEFAULT_TIMEOUT_SECONDS = 3600;
/** Consecutive failed status requests before the scan gives up on the console (about a minute with the backoff). */
const MAX_FAILED_POLLS = 12;
/** Passes that run at the same time: more only crowds the model provider and the console. */
const MAX_PARALLEL_PASSES = 3;
const MAX_PASSES = 5;
/** What `--policy` and `--org-policy` run. */
const POLICY_SKILL = "policy-check";
const BATCH_MODES = ["auto", "on", "off"];
const MAX_BATCH_SIZE = 50;
const GIT_TARGET =/^(git@|git:\/\/|ssh:\/\/git@)|\.git$|^https:\/\/(github|gitlab)\.com\//;

/**
 * The arguments that run this same program as a headless console for one scan. `--port 0` takes any free port, so another
 * console on the default port (a second user, another job on a shared runner, one started from a different home) cannot make
 * this one exit with "already running" and leave the scan without a console.
 */
export function headlessConsoleArgs(entry: string | undefined, dbPath?: string): string[] {
  return [...(entry && /\.[cm]?js$/.test(entry) ? [entry] : []), "--headless", "--port", "0", ...(dbPath ? ["--db-path", dbPath] : [])];
}

export interface ScanDeps {
  open(options: ConsoleTransportOptions): Promise<ConsoleClient>;
  out(bytes: Uint8Array | string): void;
  err(text: string): void;
  sleep(ms: number): Promise<void>;
  now(): Date;
  writeBytes(path: string, bytes: Uint8Array): void;
  /** The findings stored under a thread id, as the shared report type, from the engine the thread ran on. */
  loadReport(client: ConsoleClient, threadId: string): Promise<ScanReport>;
  /** Start a headless console for this scan; returns how to stop it. Used only when none is running. */
  startConsole(dbPath?: string): Promise<(() => void) & { failure?: () => string | undefined }>;
  /** What `git status` lists in the folder, or undefined when it is not a git work tree. A scan must leave it as it found it. */
  changedFiles(folder: string): Promise<Set<string> | undefined>;
  /** Run the chosen pattern scanners on the folder for leads, or undefined when none is installed or all fail. With `rules` (absolute paths, passed to scanners that take them) it throws when such a scanner is missing or cannot run them. */
  prePass(folder: string, scanners: string[], rules?: string[]): Promise<PrePassLeads | undefined>;
  /** The files that differ from a git ref (added, copied, modified, renamed), relative to the folder. Throws when the ref is not valid there. */
  diffFiles(folder: string, ref: string): Promise<string[]>;
  /** Make a folder out of a git URL. Returns the folder and how to remove it. */
  clone(url: string): Promise<{ dir: string; dispose(): void }>;
  /** The coverage ledger in the findings database (default: the local control database, or --db-path). Used by batched scans. */
  openLedger?(dbPath?: string): CoverageLedger;
  /** The commit a folder is on, or undefined when it is not a git work tree. A resumed scan refuses a different one. */
  gitHead?(folder: string): Promise<string | undefined>;
}
export const defaultScanDeps: ScanDeps = {
  open: options => openConsole(options),
  out: bytes => { process.stdout.write(bytes); },
  err: text => process.stderr.write(`${text}\n`),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  now: () => new Date(),
  writeBytes: (path, bytes) => writeFileSync(path, bytes, { mode: 0o600 }),
  async loadReport(client, threadId) {
    const report = asJson(await client.request("GET", `/api/scans/${encodeURIComponent(threadId)}/export?format=json`));
    if (!Array.isArray(report.findings)) throw new Error("The engine returned no report for this scan.");
    return report as unknown as ScanReport;
  },
  async changedFiles(folder) {
    try {
      const { stdout } = await exec("git", ["-C", folder, "status", "--porcelain", "--untracked-files=all"], { maxBuffer: 16 * 1024 * 1024 });
      return new Set(stdout.split("\n").filter(Boolean));
    } catch { return undefined; }
  },
  async startConsole(dbPath) {
    // Run the same program again as `--headless`: the script when node runs a .js file, else the compiled binary itself.
    // Its output goes to a file, so when it dies the scan can say why instead of waiting for a console that is not coming.
    const dir = mkdtempSync(join(tmpdir(), "0-console-"));
    const logPath = join(dir, "console.log");
    const log = openSync(logPath, "a");
    const child = spawn(process.execPath, headlessConsoleArgs(process.argv[1], dbPath), { stdio: ["ignore", log, log] });
    let failure: string | undefined;
    const tail = () => { try { return readFileSync(logPath, "utf8").trim().split("\n").slice(-6).join(" | ").slice(0, 600); } catch { return ""; } };
    child.on("error", error => { failure = `it could not be started (${error.message})`; });
    child.on("exit", (code, signal) => { failure = `it exited with ${signal ?? `code ${code}`}${tail() ? `: ${tail()}` : ""}`; });
    const stop = () => { child.kill("SIGTERM"); try { closeSync(log); } catch { /* already closed */ } };
    return Object.assign(stop, { failure: () => failure });
  },
  prePass: (folder, scanners, rules = []) => runPrePass(folder, scanners, rules, { note: text => process.stderr.write(`${text}\n`) }),
  async diffFiles(folder, ref) {
    const { stdout } = await exec("git", ["-C", folder, "diff", "--name-only", "--relative", "--diff-filter=ACMR", ref, "--"], { maxBuffer: 16 * 1024 * 1024 });
    return stdout.split("\n").map(line => line.trim()).filter(Boolean);
  },
  async clone(url) {
    const dir = mkdtempSync(join(tmpdir(), "0-scan-"));
    // An untrusted repository: no hooks, no external transports, shallow, and `--` before the URL.
    await exec("git", ["-c", "core.hooksPath=/dev/null", "-c", "protocol.ext.allow=never", "clone", "--depth", "1", "--quiet", "--", url, dir]);
    return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
  },
  openLedger: dbPath => new CoverageLedger(dbPath),
  async gitHead(folder) {
    try { return (await exec("git", ["-C", folder, "rev-parse", "HEAD"])).stdout.trim() || undefined; } catch { return undefined; }
  },
};

interface ScanOptions extends ConsoleTransportOptions {
  budget: string; diff?: string; prepass?: string; scanner?: string[]; rules?: string[]; format: string; output?: string; timeout: string; failOn?: string; model?: string; skill: string; passes: string;
  context?: string[]; policy?: string[]; orgPolicy?: string[]; repoContext?: boolean;
  batches?: string; batchSize?: string; concurrency?: string; resume?: string; force?: boolean; coverage?: string | boolean; allowPartial?: boolean; plan?: boolean;
}

export interface ResolvedTarget {
  /** Where the code is on this machine. */
  folder: string;
  /** What the thread, the title and the messages call the target: the folder's path, or a git URL without credentials. */
  label: string;
  /** What the report calls it: the same on every machine (the folder's name, or the git URL without credentials). */
  reportTarget: string;
  /** Finding paths are made relative to these. */
  roots: string[];
  dispose?: () => void;
}

/** A git URL without the user name and password a CI job puts in it, which must not reach a thread, a model or a report. */
export function withoutCredentials(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.username && !parsed.password) return url;
    parsed.username = "";
    parsed.password = "";
    return parsed.href;
  } catch { return url; }
}

const realPath = (path: string): string => { try { return realpathSync(path); } catch { return path; } };

/** A folder or a git URL. */
export async function resolveScanTarget(raw: string, deps: Pick<ScanDeps, "clone">): Promise<ResolvedTarget> {
  const target = raw.trim();
  if (!target) throw new UsageError("Supply a folder or a git URL to scan.");
  if (GIT_TARGET.test(target)) {
    const shown = withoutCredentials(target);
    const cloned = await deps.clone(target);
    return { folder: cloned.dir, label: shown, reportTarget: shown, roots: [...new Set([cloned.dir, realPath(cloned.dir)])], dispose: cloned.dispose };
  }
  const folder = resolve(target);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    throw new UsageError(`${target} is not a folder. Pass a folder or a git URL.`);
  }
  return { folder, label: folder, reportTarget: basename(folder) || folder, roots: [...new Set([folder, realPath(folder)])] };
}

function validate(target: string | undefined, options: ScanOptions): void {
  if (options.plan) {
    if (options.resume !== undefined || options.coverage !== undefined) throw new UsageError("--plan lists what a scan would do; drop --resume and --coverage.");
    if (options.format !== "md" && options.format !== "json") throw new UsageError("--plan prints text, or JSON with --format json.");
    if (options.output) throw new UsageError("--plan prints to the terminal; drop -o.");
  }
  if (!target?.trim() && !options.plan) throw new UsageError("Supply a folder or a git URL to scan.");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(options.skill)) throw new UsageError("--skill must be a skill id such as scan.");
  if (!(FORMATS as readonly string[]).includes(options.format)) throw new UsageError(`--format must be one of: ${FORMATS.join(", ")}.`);
  if (options.format === "pdf" && !options.output) throw new UsageError("PDF is binary; supply -o <file>.");
  if (options.prepass !== undefined && options.prepass !== "auto" && options.prepass !== "off") throw new UsageError("--prepass must be auto or off.");
  if (options.diff !== undefined && (!/^[A-Za-z0-9][A-Za-z0-9._\/~^@{}:-]{0,199}$/.test(options.diff) || options.diff.includes("..."))) throw new UsageError("--diff must be a git ref such as origin/main or HEAD~1.");
  if (options.rules?.length) { try { resolveRulePaths(options.rules); checkRulesScanners(options.scanner, options.prepass); } catch (error) { throw new UsageError(error instanceof Error ? error.message : String(error)); } }
  try { parseScannerList(options.scanner); } catch (error) { throw new UsageError(error instanceof Error ? error.message : String(error)); }
  if ((options.policy?.length || options.orgPolicy?.length) && options.skill !== "scan" && options.skill !== POLICY_SKILL) throw new UsageError(`--policy and --org-policy run the ${POLICY_SKILL} skill; drop --skill ${options.skill}.`);
  const budget = Number(options.budget);
  if (!Number.isFinite(budget) || budget <= 0 || budget > 1000) throw new UsageError("--budget must be a positive USD amount up to 1000.");
  const passes = Number(options.passes);
  if (!Number.isInteger(passes) || passes < 1 || passes > MAX_PASSES) throw new UsageError(`--passes must be a whole number from 1 to ${MAX_PASSES}.`);
  if (options.batches !== undefined && !BATCH_MODES.includes(options.batches)) throw new UsageError("--batches must be auto, on or off.");
  const batchSize = Number(options.batchSize ?? DEFAULT_BATCH_SIZE);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) throw new UsageError(`--batch-size must be a whole number from 1 to ${MAX_BATCH_SIZE}.`);
  const concurrency = Number(options.concurrency ?? 1);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_PARALLEL_PASSES) throw new UsageError(`--concurrency must be a whole number from 1 to ${MAX_PARALLEL_PASSES}.`);
  if ((options.batches === "on" || options.resume !== undefined) && passes > 1) throw new UsageError("--passes cannot be combined with batches or --resume; run the scan again to get another pass.");
  if (options.resume !== undefined) {
    if (options.batches === "off") throw new UsageError("--resume continues a batched scan; drop --batches off.");
    if (options.diff) throw new UsageError("--resume continues the units of an earlier scan; drop --diff.");
    if (GIT_TARGET.test((target ?? "").trim())) throw new UsageError("--resume works on a folder on this machine, not a git URL.");
  }
  if (options.coverage !== undefined && GIT_TARGET.test((target ?? "").trim())) throw new UsageError("--coverage reads the ledger of a folder on this machine, not a git URL.");
  if (options.force && options.resume === undefined) throw new UsageError("--force only applies to --resume.");
  const seconds = Number(options.timeout);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new UsageError("--timeout must be a positive number of seconds.");
  if (options.failOn !== undefined && !(SEVERITIES as readonly string[]).includes(options.failOn)) throw new UsageError(`--fail-on must be one of: ${SEVERITIES.join(", ")}.`);
}

const NO_CONSOLE = /No console running/;

/** The engine to run on: the one the options name or that is already running, else a headless one started for this scan. */
export async function connect(options: ConsoleTransportOptions, deps: Pick<ScanDeps, "open" | "err" | "sleep" | "startConsole">): Promise<{ client: ConsoleClient; stop?: () => void }> {
  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
  try { return { client: await deps.open(options) }; }
  catch (error) { if (!NO_CONSOLE.test(message(error))) throw error; }
  deps.err("no console is running; starting one for this scan");
  const stop = await deps.startConsole(options.dbPath);
  for (let attempt = 0; attempt < 60; attempt++) {
    try { return { client: await deps.open(options), stop }; }
    catch (error) { if (!NO_CONSOLE.test(message(error))) { stop(); throw error; } }
    // A console that already died is not coming; say why now instead of waiting out the clock.
    const failure = stop.failure?.();
    if (failure) { stop(); throw new Error(`The console this scan starts for itself stopped: ${failure}. Start one with \`0 --headless\` and run the scan again.`); }
    await deps.sleep(500);
  }
  stop();
  throw new Error("Could not start a console within 30s. Start one with `0 --headless` and run the scan again.");
}

interface PassContext { prePass?: PrePassLeads; scope?: string[]; steering: Steering; client: ConsoleClient; deps: ScanDeps; resolved: ResolvedTarget; options: ScanOptions; total: number; budget: number; deadline: number }
interface PassResult { threadId: string; done: FinishedThread; stored: ScanReport; budgetExhausted: boolean; timedOut: boolean; costUsd?: number }

/** Poll a thread until it finishes, the deadline passes (it is then cancelled) or the console is lost for too long. */
export async function waitForThread(client: ConsoleClient, deps: Pick<ScanDeps, "sleep">, id: string, deadline: number): Promise<{ snapshot: Json; timedOut: boolean }> {
  const path = `/api/console/sessions/${encodeURIComponent(id)}`;
  let snapshot: Json = {};
  let timedOut = false;
  let failedPolls = 0;
  for (;;) {
    await deps.sleep(1000);
    try {
      snapshot = asJson(asJson(await client.request("GET", path)).snapshot);
      failedPolls = 0;
    } catch (error) {
      // A console busy with several scans, or a provider timing out, can miss a status request while the thread keeps working.
      // Give up only after a run of failures, and say where the thread is.
      if (++failedPolls > MAX_FAILED_POLLS) {
        throw new Error(`Lost contact with the console while scanning: ${error instanceof Error ? error.message : String(error)}. The scan may still be running as thread ${id}; its findings are kept (\`0 findings export --scan ${id}\`).`);
      }
      await deps.sleep(Math.min(5000, 1000 * failedPolls));
      continue;
    }
    const session = asJson(snapshot.session);
    const finished = ["failed", "closed", "waiting"].includes(String(session.status)) || (session.status === "ready" && (lastAssistantText(snapshot) !== undefined || snapshot.lastOutcome != null));
    if (finished) break;
    if (Date.now() > deadline) {
      // Stop the thread and report what it stored so far; a scan that ran out of time still has findings.
      timedOut = true;
      await client.request("POST", `${path}/cancel`, {}).catch(() => undefined);
      await deps.sleep(2000);
      snapshot = await client.request("GET", path).then(value => asJson(asJson(value).snapshot), () => snapshot);
      break;
    }
  }
  return { snapshot, timedOut };
}

/** One scan thread: start it, wait for it, and read what it stored. Throws when the thread cannot run or the console is lost. */
interface PassExtra { batch?: BatchPromptInfo; budget?: number; prePass?: PrePassLeads | undefined }
async function runPass(ctx: PassContext, index: number, extra: PassExtra = {}): Promise<PassResult> {
  const { client, deps, resolved, options, total, deadline } = ctx;
  const budget = extra.budget ?? ctx.budget;
  const prePass = "prePass" in extra ? extra.prePass : ctx.prePass;
  const runtime = { runtime: { model: options.model ?? defaultScanModel() } };
  const part = extra.batch ? `batch ${extra.batch.index + 1} of ${extra.batch.total}` : total > 1 ? `pass ${index + 1} of ${total}` : "";
  const title = part ? `Scan ${resolved.label} (${part})` : `Scan ${resolved.label}`;
  const created = asJson(asJson(await client.request("POST", "/api/console/sessions", { ...runtime, title, costCeilingUsd: budget })).session);
  const id = String(created.id);
  const path = `/api/console/sessions/${encodeURIComponent(id)}`;
  try {
    await client.request("PATCH", `${path}/configuration`, { workspacePath: resolved.folder });
    await client.request("POST", `${path}/messages`, { text: scanPrompt(resolved.label, options.skill, prePass, ctx.scope, ctx.steering, extra.batch) });
  } catch (error) {
    // A thread that never started is no use to anyone; do not leave it in the list.
    const removed = await client.request("POST", `${path}/delete`, {}).then(() => true, () => false);
    const reason = error instanceof Error ? error.message : String(error);
    const hint = /model/i.test(reason) ? ` Pick another with --model (default ${DEFAULT_SCAN_MODEL}).` : "";
    throw new Error(`${reason}${hint}${removed ? "" : ` (thread ${id} was created; remove it with \`0 threads delete ${id} --yes\`)`}`);
  }
  deps.err(`scanning ${resolved.label} in thread ${id} (${part ? `${part}, ` : ""}budget $${Number(budget.toFixed(4))})`);

  const { snapshot, timedOut } = await waitForThread(client, deps, id, deadline);
  const done = finishedThread(snapshot);
  const costUsd = typeof done.usage.costUsd === "number" ? done.usage.costUsd : undefined;
  return { threadId: id, done, stored: await deps.loadReport(client, id), budgetExhausted: asJson(done.session).costCeilingExceeded === true, timedOut, ...(costUsd !== undefined ? { costUsd } : {}) };
}

/** Run `count` tasks, at most `limit` at a time, in order of index. */
async function inPool<T>(count: number, limit: number, task: (index: number) => Promise<T>): Promise<T[]> {
  const results: T[] = new Array(count);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, count) }, async () => {
    while (next < count) { const index = next++; results[index] = await task(index); }
  }));
  return results;
}

/** Format the report and write it to --output or standard output. */
async function writeReport(outcome: ScanOutcome, merged: ReturnType<typeof mergePasses>, stored: ScanReport, name: string, options: ScanOptions, deps: Pick<ScanDeps, "out" | "err" | "writeBytes">): Promise<void> {
  let body: Uint8Array | string;
  if (options.format === "json") body = `${JSON.stringify(scanJson(outcome, merged), null, 2)}\n`;
  else {
    const format = options.format === "md" ? "markdown" : options.format;
    if (!isReportExportFormat(format)) throw new UsageError(`--format must be one of: ${FORMATS.join(", ")}.`);
    body = (await exportReport(toScanReport(outcome, stored), format, name)).body;
  }
  if (options.output) {
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
    deps.writeBytes(options.output, bytes);
    deps.err(`Wrote ${options.output} (${bytes.byteLength} bytes)`);
  } else deps.out(body);
}

/** The thread has the same tools as any thread, so it could edit the code it reads. The message to show if it did, else undefined. */
async function unexpectedChanges(deps: Pick<ScanDeps, "changedFiles">, folder: string, before: Set<string> | undefined): Promise<string | undefined> {
  const after = before ? await deps.changedFiles(folder) : undefined;
  const changed = before && after ? [...after].filter(line => !before.has(line)) : [];
  return changed.length
    ? `The scan changed ${changed.length} file${changed.length === 1 ? "" : "s"} in the target (${changed.slice(0, 5).map(line => line.slice(3)).join(", ")}${changed.length > 5 ? ", ..." : ""}). A scan must not edit the code it reads; review and revert them.`
    : undefined;
}

/** `--plan`: list the inventory, the batches and a rough cost, and start nothing: no console, no model, no scanner, no database. */
async function printPlan(resolved: ResolvedTarget, options: ScanOptions, deps: ScanDeps): Promise<void> {
  let scope: string[] | undefined;
  if (options.diff) {
    try { scope = await deps.diffFiles(resolved.folder, options.diff); }
    catch { throw new UsageError(`'${options.diff}' is not a git ref in ${resolved.label}, or the folder is not a git work tree.`); }
  }
  const inventory = buildInventory(resolved.folder, scope ? { only: new Set(scope) } : {});
  const plan = planScan(inventory, { folder: resolved.label, batchSize: Number(options.batchSize ?? DEFAULT_BATCH_SIZE), batchesMode: options.batches ?? "auto", budgetUsd: Number(options.budget) });
  deps.out(options.format === "json" ? `${JSON.stringify(plan, null, 2)}\n` : `${planText(plan)}\n`);
}

/** `--coverage`: print the ledger of a scan of this folder (the latest, or the id given) and start nothing. */
async function printCoverage(resolved: ResolvedTarget, options: ScanOptions, deps: ScanDeps): Promise<void> {
  const ledger = (deps.openLedger ?? defaultScanDeps.openLedger!)(options.dbPath);
  try {
    const wanted = typeof options.coverage === "string" && options.coverage.trim() ? options.coverage.trim() : "latest";
    const scan = wanted === "latest" ? ledger.latestScan(resolved.folder) : ledger.getScan(wanted);
    if (!scan) throw new UsageError(wanted === "latest" ? `No batched scan of ${resolved.folder} is recorded. A scan is batched when the folder has more entry points than one thread takes; see --batches.` : `No scan ${wanted} in the findings database.`);
    const units = ledger.units(scan.id);
    const body = options.format === "json" ? `${JSON.stringify(coverageJson(scan, units), null, 2)}\n` : `${coverageText(scan, units)}\n`;
    if (options.output) deps.writeBytes(options.output, new TextEncoder().encode(body)); else deps.out(body);
  } finally { ledger.close(); }
}

const emptyStoredReport = (startedAt: string): ScanReport => ({ target: "", scanDepth: "default", startedAt, completedAt: startedAt, durationMs: 0, summary: { totalAttacks: 0, totalFindings: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 }, findings: [], warnings: [] } as unknown as ScanReport);

/**
 * The batched flow: one thread per batch of units, a ledger row per unit, and a report that says how much was reviewed.
 * A unit is reviewed only when its batch's thread finished normally; everything else stays pending with the reason.
 */
async function runBatchedScan(ctx: PassContext, setup: BatchedSetup, before: Set<string> | undefined, startedAt: string, budget: number): Promise<void> {
  const { client, deps, resolved, options } = ctx;
  const { ledger, scan } = setup;
  const ran = new Map<string, PassResult>();
  const count = setup.batches.length;
  deps.err(`${setup.resumed ? `resuming scan ${scan.id}` : `scan ${scan.id}`}: ${setup.summaryText} ${count ? `${count} batch${count === 1 ? "" : "es"} to run` : "nothing is pending"}`);

  const run = await runBatches({
    batches: setup.batches, ledger, scanId: scan.id, budgetUsd: budget, deadline: ctx.deadline, concurrency: Number(options.concurrency ?? 1), log: deps.err,
    run: async (batch: Batch, batchBudget: number): Promise<BatchOutcome> => {
      // Hits of the pattern scanners that sit in this batch's files are its leads; the others belong to other batches.
      const files = new Set(batch.units.flatMap(unit => unit.files ?? [unit.path]));
      const leads = ctx.prePass?.leads.filter(lead => lead.path !== undefined && files.has(lead.path)) ?? [];
      const prePass = ctx.prePass && leads.length ? { ...ctx.prePass, leads, total: leads.length } : undefined;
      const info: BatchPromptInfo = { index: batch.index, total: count, units: batch.units, summary: setup.summaryText };
      const pass = await runPass(ctx, batch.index, { batch: info, budget: batchBudget, prePass });
      ran.set(pass.threadId, pass);
      const hardFailure = pass.done.failed && !pass.budgetExhausted && !pass.timedOut;
      return {
        threadId: pass.threadId, reviewed: !pass.done.failed && !pass.done.claimBlocked && !pass.budgetExhausted && !pass.timedOut,
        ...(pass.costUsd !== undefined ? { costUsd: pass.costUsd } : {}), budgetExhausted: pass.budgetExhausted, timedOut: pass.timedOut, failed: hardFailure || pass.done.claimBlocked,
        ...(pass.done.error ? { error: pass.done.error } : {}),
      };
    },
  });
  const firstError = run.outcomes.map(item => item.outcome.error).find(Boolean);
  if (count && !ran.size && run.outcomes.length) throw new Error(`No batch could run${firstError ? `: ${firstError}` : "."}`);
  for (const item of run.outcomes) if (!item.outcome.reviewed && item.outcome.error && item.outcome.threadId === undefined) deps.err(`batch ${item.batch.index + 1}: ${item.outcome.error}`);

  const units = ledger.units(scan.id);
  const summary = summarizeCoverage(scan.id, units);
  const statement = coverageSentence(summary);
  const failures = run.outcomes.filter(item => !item.outcome.reviewed && item.outcome.failed).map(item => item.outcome.error ?? "no reason given");
  const hint: ResumeHint | undefined = resumeHint(resolved.label, summary, { budgetHit: run.budgetHit, budgetUsd: budget, timedOut: run.timedOut, timeoutSeconds: Number(options.timeout), failures });
  const coverage = { ...coverageReport(summary, statement, units), ...(hint ? { resume: hint.command, stoppedBy: hint.stoppedBy } : {}) };
  // Findings of every thread of this scan, including the threads an earlier run started and partial batches.
  const threadIds = ledger.getScan(scan.id)?.threadIds ?? [...ran.keys()];
  const stored: ScanReport[] = [];
  for (const id of threadIds) {
    const pass = ran.get(id);
    if (pass) { stored.push(pass.stored); continue; }
    try { stored.push(await deps.loadReport(client, id)); }
    catch (error) { deps.err(`could not read the findings of thread ${id} from an earlier run: ${error instanceof Error ? error.message : String(error)}`); }
  }
  // Batches are not passes: the same flaw found from two batches is one finding, with no "found in N passes" note.
  const merged = mergePasses(stored.map(report => report.findings), resolved.roots).map(({ foundInPasses: _ignored, ...finding }) => finding);
  const changedError = await unexpectedChanges(deps, resolved.folder, before);
  if (changedError) deps.err(changedError);

  const customLeads = ctx.prePass?.leads.filter(lead => lead.ruleSource === "custom") ?? [];
  const results = [...ran.values()];
  const cost = results.reduce((sum, result) => sum + (result.costUsd ?? 0), 0);
  const costKnown = results.some(result => result.costUsd !== undefined);
  const failed = (results.length > 0 && results.every(result => (result.done.failed && !result.budgetExhausted && !result.timedOut) || result.done.claimBlocked)) || changedError !== undefined;
  const lead = results.reduce<PassResult | undefined>((best, result) => (!best || result.stored.findings.length > best.stored.findings.length ? result : best), undefined);
  const hardError = results.map(result => (!result.budgetExhausted && !result.timedOut ? result.done.error : undefined)).find(Boolean);
  const outcome: ScanOutcome = {
    target: resolved.reportTarget, roots: resolved.roots, threadId: threadIds[0] ?? "none", startedAt, completedAt: deps.now().toISOString(), budgetUsd: budget,
    ...(costKnown ? { costUsd: cost } : {}), budgetExhausted: run.budgetHit, ...(run.timedOut ? { timedOut: true } : {}), failed, ...(options.allowPartial ? { allowPartial: true } : {}),
    ...(changedError ? { error: changedError } : failed && hardError ? { error: hardError } : {}),
    // The thread's own summary can say it covered everything; the ledger's account comes first.
    summary: `Coverage: ${statement}.${lead?.done.reply ? `\n\n${lead.done.reply}` : ""}`,
    coverage, ...(threadIds.length > 1 ? { threadIds } : {}),
    ...(customLeads.length ? { customLeads } : {}),
  };
  const base = stored[0] ?? emptyStoredReport(startedAt);
  await writeReport(outcome, merged, { ...base, findings: merged }, `0-scan-${threadIds[0] ?? scan.id}`, options, deps);
  deps.err(`${merged.length} finding${merged.length === 1 ? "" : "s"}; ${statement}${hint ? `\n${hint.text}` : ""}\nUsage: ${count} batch${count === 1 ? "" : "es"}, cost ${costKnown ? `$${cost.toFixed(4)}` : "unknown"}`);
  const code = scanExitCode(outcome, merged, options.failOn as typeof SEVERITIES[number] | undefined);
  if (code !== 0) process.exitCode = code;
}

export async function runScan(target: string | undefined, options: ScanOptions, deps: ScanDeps = defaultScanDeps): Promise<void> {
  let resolved: ResolvedTarget | undefined;
  let client: ConsoleClient | undefined;
  let stopConsole: (() => void) | undefined;
  let batched: BatchedSetup | undefined;
  try {
    validate(target, options);
    resolved = await resolveScanTarget(target?.trim() ? target : ".", deps);
    if (options.plan) { await printPlan(resolved, options, deps); return; }
    if (options.coverage !== undefined) { await printCoverage(resolved, options, deps); return; }
    const steering = loadSteering(resolved.folder, options, deps.err);
    if (steering.policies.length && options.skill === "scan") options = { ...options, skill: POLICY_SKILL };
    const budget = Number(options.budget);
    const total = Number(options.passes);
    const startedAt = deps.now().toISOString();
    const before = await deps.changedFiles(resolved.folder);
    let scope: string[] | undefined;
    if (options.diff) {
      try { scope = await deps.diffFiles(resolved.folder, options.diff); }
      catch { throw new UsageError(`'${options.diff}' is not a git ref in ${resolved.label}, or the folder is not a git work tree.`); }
      if (!scope.length) {
        // Nothing changed: a valid, empty report, so a pipeline that reads the file keeps working.
        deps.err(`no files differ from ${options.diff}; nothing to scan`);
        const empty = { target: "", scanDepth: "default", startedAt, completedAt: startedAt, durationMs: 0, summary: { totalAttacks: 0, totalFindings: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 }, findings: [], warnings: [] } as unknown as ScanReport;
        const outcome: ScanOutcome = { target: resolved.reportTarget, roots: resolved.roots, threadId: "none", startedAt, completedAt: startedAt, budgetUsd: budget, budgetExhausted: false, failed: false, summary: `No files differ from ${options.diff}, so nothing was scanned.` };
        await writeReport(outcome, [], empty, "0-scan-empty", options, deps);
        return;
      }
    }
    // A folder with more entry points than one thread takes is reviewed in batches, each with a ledger row (docs: Large repositories).
    batched = await planBatchedScan({
      folder: resolved.folder, label: resolved.label, mode: options.batches ?? "auto", batchSize: Number(options.batchSize ?? DEFAULT_BATCH_SIZE), ...(options.resume !== undefined ? { resume: options.resume } : {}),
      ...(options.force ? { force: true } : {}), budgetUsd: budget, passes: total, singleThread: options.skill !== "scan", ...(scope ? { scope } : {}), ...(options.dbPath ? { dbPath: options.dbPath } : {}),
      openLedger: deps.openLedger ?? defaultScanDeps.openLedger!, gitHead: deps.gitHead ?? defaultScanDeps.gitHead!, err: deps.err,
    });
    ({ client, stop: stopConsole } = await connect(options, deps));
    // --budget is the total: each pass gets an equal share, so the cost stays predictable however many passes run.
    const scanners = parseScannerList(options.scanner);
    const rules = resolveRulePaths(options.rules);
    let prePass = options.prepass === "off" ? undefined : await deps.prePass(resolved.folder, scanners, ...(rules.length ? [rules] : []));
    const customLeads = prePass?.leads.filter(lead => lead.ruleSource === "custom");
    if (prePass && scope) {
      const inScope = new Set(scope);
      const leads = prePass.leads.filter(lead => lead.path !== undefined && inScope.has(lead.path));
      prePass = leads.length ? { ...prePass, leads, total: leads.length } : undefined;
    }
    if (prePass) deps.err(`${prePass.tools.join(", ")} pre-pass: ${prePass.total} lead${prePass.total === 1 ? "" : "s"} for the scan to check`);
    const ctx: PassContext = { steering, ...(prePass ? { prePass } : {}), ...(scope ? { scope } : {}), client, deps, resolved, options, total, budget: budget / total, deadline: Date.now() + Number(options.timeout) * 1000 };
    if (batched) { await runBatchedScan(ctx, batched, before, startedAt, budget); return; }

    const passErrors: string[] = [];
    const results = (await inPool(total, MAX_PARALLEL_PASSES, async (index): Promise<PassResult | undefined> => {
      // The time limit covers all passes: one that has not started when it runs out is not started.
      if (index > 0 && Date.now() > ctx.deadline) { passErrors.push(`pass ${index + 1} did not start before the time limit`); return undefined; }
      try { return await runPass(ctx, index); }
      catch (error) {
        // One scan has nothing else to fall back on. With several, the others still count.
        if (total === 1) throw error;
        passErrors.push(`pass ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
      }
    })).filter((result): result is PassResult => result !== undefined);
    if (!results.length) throw new Error(`No scan pass finished. ${passErrors.join(" ")}`);
    for (const message of passErrors) deps.err(message);

    const failedPasses = total - results.length;
    const merged = mergePasses(results.map(result => result.stored.findings), resolved.roots);
    // The thread has the same tools as any thread, so it could edit the code it reads. Say so if it did.
    const changedError = await unexpectedChanges(deps, resolved.folder, before);
    if (changedError) deps.err(changedError);

    const budgetExhausted = results.some(result => result.budgetExhausted);
    const timedOut = results.some(result => result.timedOut);
    const cost = results.reduce((sum, result) => sum + (result.costUsd ?? 0), 0);
    const costKnown = results.some(result => result.costUsd !== undefined);
    // The summary of the pass that found the most is the best account of what was covered.
    const lead = results.reduce((best, result) => (result.stored.findings.length > best.stored.findings.length ? result : best), results[0]!);
    const failed = results.every(result => (result.done.failed && !result.budgetExhausted && !result.timedOut) || result.done.claimBlocked) || changedError !== undefined;
    const firstError = results.map(result => (!result.budgetExhausted && !result.timedOut ? result.done.error : undefined)).find(Boolean);
    const outcome: ScanOutcome = {
      target: resolved.reportTarget, roots: resolved.roots, threadId: results[0]!.threadId, startedAt, completedAt: deps.now().toISOString(), budgetUsd: budget,
      ...(costKnown ? { costUsd: cost } : {}), budgetExhausted, ...(timedOut ? { timedOut } : {}), failed, ...(options.allowPartial ? { allowPartial: true } : {}),
      ...(changedError ? { error: changedError } : failed && firstError ? { error: firstError } : {}), ...(lead.done.reply ? { summary: lead.done.reply } : {}),
      ...(customLeads?.length ? { customLeads } : {}),
      ...(total > 1 ? { passes: { requested: total, completed: results.length, failed: failedPasses }, threadIds: results.map(result => result.threadId) } : {}),
    };

    await writeReport(outcome, merged, { ...results[0]!.stored, findings: merged }, `0-scan-${results[0]!.threadId}`, options, deps);
    const usage = results.length === 1 ? usageLine(results[0]!.done.usage) : `Usage: ${results.length} passes, cost ${costKnown ? `$${cost.toFixed(4)}` : "unknown"}`;
    deps.err(`${merged.length} finding${merged.length === 1 ? "" : "s"}${total > 1 ? ` from ${results.length} of ${total} passes` : ""}${budgetExhausted ? `, stopped at the $${budget} budget (partial)` : timedOut ? `, stopped at the ${options.timeout}s time limit (partial)` : ""}\n${usage}`);
    const code = scanExitCode(outcome, merged, options.failOn as typeof SEVERITIES[number] | undefined);
    if (code !== 0) process.exitCode = code;
  } catch (error) {
    finishWithError(error, deps, false);
  } finally {
    client?.dispose();
    stopConsole?.();
    batched?.ledger.close();
    resolved?.dispose?.();
  }
}

export function registerScanCommand(program: Command, deps: ScanDeps = defaultScanDeps): void {
  consoleTransportOptions(program.command("scan [target]")
    .description("Scan a folder or git repository for security bugs; prints the findings as a report")
    .option("--budget <usd>", "Stop when the estimated spend reaches this many USD; partial findings are kept", String(DEFAULT_BUDGET_USD))
    .option("--format <format>", `Report format: ${FORMATS.join(", ")}`, "md")
    .option("-o, --output <file>", "Write the report to a file instead of stdout")
    .option("--fail-on <severity>", "Exit 1 when a finding is at or above this severity (critical, high, medium, low, info)")
    .option("--passes <n>", `Scan this many times and merge the findings (a scan misses some issues that another run finds); the budget is split between them, up to ${MAX_PASSES}`, "1")
    .option("--diff <ref>", "Review only the files that differ from this git ref (for example origin/main), and what they connect to; an empty diff scans nothing")
    .option("--prepass <mode>", "auto runs the pattern scanners first when they are installed and gives their hits to the scan as leads; off skips them", "auto")
    .option("--scanner <id>", `Scanner for the pre-pass (${SCANNERS.map(scanner => scanner.id).join(", ")}); repeat or separate with commas to use several (default: foxguard). gitleaks, trivy and osv-scanner must be installed; secret values are redacted`, (value: string, previous: string[] = []) => [...previous, value])
    .option("--rules <file-or-folder>", "Semgrep or OpenGrep rules for the pre-pass (a file or a folder); repeat for several. Replaces the default rules and needs --scanner semgrep or opengrep. Rules are never read from the scanned folder unless you name them", (value: string, previous: string[] = []) => [...previous, value])
    .option("--context <file>", "Give the scan this file (a threat model, notes on who may do what) as lower-priority background; repeat for several. It can steer what the scan weighs but cannot change how it works", (value: string, previous: string[] = []) => [...previous, value])
    .option("--policy <file-or-folder>", "Check the code against these Markdown policies (a file or a folder of .md files) and report pass or fail for each; repeat for several. Runs the policy-check skill", (value: string, previous: string[] = []) => [...previous, value])
    .option("--org-policy <folder>", "An organisation's policy folder: evaluated first, and wins when a --policy says otherwise or uses the same id; repeat for several", (value: string, previous: string[] = []) => [...previous, value])
    .option("--repo-context", "Also read .0/threat-model.md from the scanned folder as context. Off by default: a change under review can edit that file; in CI pass the base branch's copy with --context instead")
    .option("--skill <id>", "Skill that holds the scan method", "scan")
    .option("--model <model>", `Model for the scan thread (${DEFAULT_MODEL_HELP})`)
    .option("--batches <mode>", "auto reviews a large folder in batches, one thread per group of entry points, and records what each batch covered; on always does; off keeps one thread", "auto")
    .option("--batch-size <n>", `Entry points one batch reviews (1 to ${MAX_BATCH_SIZE}); a folder with more than this many is split under --batches auto`, String(DEFAULT_BATCH_SIZE))
    .option("--concurrency <n>", `Batches that run at the same time (1 to ${MAX_PARALLEL_PASSES})`, "1")
    .option("--resume <scan>", "Continue the units an earlier batched scan of this folder did not reach (a scan id from its report, or latest); refuses when the git HEAD changed unless --force")
    .option("--force", "With --resume: continue even though the folder's git HEAD changed")
    .option("--coverage [scan]", "Print the coverage ledger of a batched scan of this folder (the latest, or the id given) and exit; --format json for JSON")
    .option("--allow-partial", "Exit by the findings alone (0, or 1 with --fail-on) when the scan stops before it reviews everything; the report still says it is partial")
    .option("--plan", "List the entry points, the batches and a rough cost range for the folder, then exit; calls no model and writes nothing")
    .option("--timeout <seconds>", "Maximum seconds to wait for the scan", String(DEFAULT_TIMEOUT_SECONDS)))
    .addHelpText("after", "\nExit codes: 0 done, 1 findings at or above --fail-on or the scan failed, 2 usage error, 3 stopped before it reviewed everything (budget, time limit, or entry points not reached): not finished, not failed; --allow-partial exits 0 or 1 instead.\nThe scan is a thread: follow it with `0 threads list`.")
    .action(async (target: string, options: ScanOptions) => { await runScan(target, options, deps); });
}
