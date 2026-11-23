/**
 * `0 findings verify`: a second look at findings, one fresh thread each (or a few findings in one file).
 *
 * Experimental. The thread gets only the finding's own text, not the scan that produced it, reads the code itself and
 * answers true-positive, false-positive, fixed, uncertain or duplicate. The answer is stored next to the finding as an
 * advisory record: the finding's severity and status do not change. Only `--apply` acts on it, and only for a
 * false-positive verdict that cites a concrete control.
 */
import { existsSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { Option, type Command } from "commander";
import { attackerImpactSentence, firstCitation, MAX_VERIFY_FINDINGS_PER_PROMPT, parseVerdicts, verifyPrompt, type VerifyPromptFinding } from "@0/engine/shared";
import { listOsecRunDatabasePaths, osecDB, resolveOsecDbPath, type FindingModelVerification, type ModelVerdict } from "@0/engine/storage";
import { consoleTransportOptions, type ConsoleClient, type ConsoleTransportOptions } from "../console-client.js";
import { resolveFindingId, shortFindingId } from "../finding-id.js";
import { connect, DEFAULT_MODEL_HELP, defaultScanDeps, defaultScanModel, waitForThread, type ScanDeps } from "./scan.js";
import { finishWithError, UsageError } from "./output.js";
import { asJson, finishedThread } from "./thread-output.js";

const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const SKIP_STATUS = new Set(["fixed", "false-positive"]);
const SKIP_TRIAGE = new Set(["suppressed"]);
export const MAX_VERIFY_CONCURRENCY = 3;
const BUDGET_SPENT = "the total budget is spent";
/** `--apply` does not suppress a finding at or above this severity: a person decides those. Set from the measurement in docs/design/benchmark.md. */
const APPLY_BLOCKED_SEVERITIES: ReadonlySet<string> = new Set<string>(["critical", "high"]);

export interface VerifyCandidate {
  id: string; dbPath: string; fingerprint: string; title: string; severity: string; category: string; tool: string | null; description: string;
  scanId: string; status: string; triage: string; timestamp: number;
  path?: string; startLine?: number; endLine?: number; impact?: string;
  verification?: FindingModelVerification;
}

export interface VerifyDeps extends Pick<ScanDeps, "open" | "err" | "sleep" | "startConsole"> {
  out(text: string): void;
  loadCandidates(dbPath: string | undefined): VerifyCandidate[];
  save(candidate: VerifyCandidate, record: FindingModelVerification): void;
  /** Suppress the finding's family with a note, the way `0 findings suppress` does. */
  suppress(candidate: VerifyCandidate, note: string): void;
  /** Is there a file or folder at this path inside the folder? Never follows the path out of it. */
  exists(folder: string, relative: string): boolean;
  now(): Date;
}

export interface VerifyOptions extends ConsoleTransportOptions {
  folder?: string; severity?: string; category?: string; tool?: string; scan?: string; limit?: string; force?: boolean; apply?: boolean; dryRun?: boolean;
  budget: string; perFinding: string; concurrency: string; batch: string; maxConsecutiveFailures: string; timeout: string; model?: string; format?: string;
}

export interface VerifyItem {
  finding: string; title: string; severity: string; result: "verified" | "failed" | "skipped" | "planned";
  verdict?: ModelVerdict; advisorySeverity?: string; reasoning?: string; duplicateOf?: string; control?: string; threadId?: string; costUsd?: number;
  applied?: boolean; applyRefused?: string; reason?: string;
}

export interface VerifyReport {
  folder: string; dryRun: boolean; selected: number; verified: number; failed: number; skipped: number;
  counts: Record<ModelVerdict, number>; applied: number; costUsd: number; stoppedReason?: string; items: VerifyItem[];
}

const parseNumber = (name: string, text: string, rule: (n: number) => boolean, expected: string): number => {
  const value = Number(text);
  if (!Number.isFinite(value) || !rule(value)) throw new UsageError(`${name} must be ${expected}.`);
  return value;
};

/** Where verification looks for findings: the one database named, or the shared one and every scan's. */
function databasePaths(dbPath: string | undefined): string[] {
  if (dbPath) return [resolveOsecDbPath(dbPath)];
  return [...new Set([...listOsecRunDatabasePaths(), resolveOsecDbPath()])];
}

function readCandidates(dbPath: string | undefined): VerifyCandidate[] {
  const out: VerifyCandidate[] = [];
  for (const path of databasePaths(dbPath)) {
    if (!existsSync(path)) continue;
    const db = new osecDB(path);
    try {
      for (const row of db.listFindings({ limit: 5000 }) as unknown as Array<Record<string, unknown>>) {
        const id = String(row.id);
        const annotation = db.getFindingReviewFields(id).reviewAnnotation;
        let impact: string | undefined;
        try { impact = row.impactAssessment ? attackerImpactSentence({ impactAssessment: JSON.parse(String(row.impactAssessment)), category: String(row.category) }) : undefined; } catch { /* unreadable assessment: no impact text */ }
        const verification = db.getFindingModelVerification(id);
        out.push({
          id, dbPath: path, fingerprint: String(row.fingerprint ?? id), title: String(row.title), severity: String(row.severity), category: String(row.category),
          tool: typeof row.tool === "string" ? row.tool : null, description: String(row.description ?? ""), scanId: String(row.scanId), status: String(row.status),
          triage: String(row.triageStatus ?? "new"), timestamp: Number(row.timestamp ?? 0),
          ...(annotation && typeof annotation.path === "string" && annotation.path ? { path: annotation.path, ...(typeof annotation.startLine === "number" ? { startLine: annotation.startLine } : {}), ...(typeof annotation.endLine === "number" ? { endLine: annotation.endLine } : {}) } : {}),
          ...(impact ? { impact } : {}),
          ...(verification ? { verification } : {}),
        });
      }
    } finally { db.close(); }
  }
  return out;
}

export const defaultVerifyDeps: VerifyDeps = {
  open: defaultScanDeps.open, err: defaultScanDeps.err, sleep: defaultScanDeps.sleep, startConsole: defaultScanDeps.startConsole,
  out: text => process.stdout.write(`${text}\n`),
  loadCandidates: readCandidates,
  save(candidate, record) {
    const db = new osecDB(candidate.dbPath);
    try { db.setFindingModelVerification(candidate.id, record); } finally { db.close(); }
  },
  suppress(candidate, note) {
    const db = new osecDB(candidate.dbPath);
    try { db.updateFindingTriage(candidate.id, "suppressed", note); } finally { db.close(); }
  },
  exists(folder, relative) {
    const root = resolve(folder);
    const full = resolve(root, relative);
    if (full !== root && !full.startsWith(root + sep)) return false;
    try { return statSync(join(root, relative)) !== undefined; } catch { return false; }
  },
  now: () => new Date(),
};

const emptyCounts = (): Record<ModelVerdict, number> => ({ "true-positive": 0, "false-positive": 0, fixed: 0, uncertain: 0, duplicate: 0 });
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The first sentence of a reasoning, for a note. */
export function firstSentence(text: string, max = 200): string {
  const flat = oneLine(text);
  const end = /[.!?](?=\s|$)/.exec(flat);
  const sentence = end ? flat.slice(0, end.index + 1) : flat;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

/** Why `--apply` may not suppress this finding on this verdict, or undefined when it may. */
export function applyRefusal(candidate: Pick<VerifyCandidate, "severity">, record: Pick<FindingModelVerification, "verdict" | "reasoning" | "control">, folder: string, exists: VerifyDeps["exists"]): string | undefined {
  if (record.verdict !== "false-positive") return "the verdict is not false-positive";
  const control = firstCitation(record.control);
  if (!control) return "no control is cited at path:line";
  if (!firstCitation(record.reasoning)) return "the reasoning cites no path:line";
  if (!exists(folder, control.path)) return `the cited control ${control.path} is not in the folder`;
  if (APPLY_BLOCKED_SEVERITIES.has(candidate.severity.toLowerCase())) return `the finding is ${candidate.severity}; a person decides that`;
  return undefined;
}

function select(all: VerifyCandidate[], ids: string[], options: VerifyOptions): { run: VerifyCandidate[]; skipped: VerifyItem[] } {
  const skipped: VerifyItem[] = [];
  const base = (c: VerifyCandidate) => ({ finding: c.id, title: c.title, severity: c.severity });
  let pool: VerifyCandidate[];
  const explicit = ids.length > 0;
  if (explicit) {
    pool = [];
    for (const id of ids) {
      let row: VerifyCandidate | undefined;
      try { row = resolveFindingId(all, id); } catch (error) { throw new UsageError(error instanceof Error ? error.message : String(error)); }
      if (!row) throw new UsageError(`Finding '${id}' not found.`);
      if (!pool.includes(row)) pool.push(row);
    }
  } else {
    const severities = options.severity ? options.severity.split(",").map(s => s.trim().toLowerCase()).filter(Boolean) : undefined;
    for (const s of severities ?? []) if (!(SEVERITIES as readonly string[]).includes(s)) throw new UsageError(`--severity must be one of ${SEVERITIES.join(", ")} (comma-separated for several).`);
    const tool = options.tool?.toLowerCase();
    const category = options.category?.toLowerCase();
    // The newest row of each fingerprint: a finding seen by several scans is checked once.
    const latest = new Map<string, VerifyCandidate>();
    for (const c of all) { const seen = latest.get(c.fingerprint); if (!seen || seen.timestamp < c.timestamp) latest.set(c.fingerprint, c); }
    pool = [...latest.values()].filter(c => (!severities || severities.includes(c.severity.toLowerCase())) && (!category || c.category.toLowerCase() === category)
      && (!tool || (c.tool ?? "").toLowerCase() === tool) && (!options.scan || c.scanId.startsWith(options.scan)));
  }
  const run: VerifyCandidate[] = [];
  for (const c of pool.sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || (a.path ?? "").localeCompare(b.path ?? "") || a.id.localeCompare(b.id))) {
    const reason = SKIP_STATUS.has(c.status) ? `already ${c.status}` : SKIP_TRIAGE.has(c.triage) ? "suppressed" : c.verification && !options.force ? `already verified (${c.verification.verdict}); use --force to check again` : undefined;
    if (reason) { if (explicit || c.verification) skipped.push({ ...base(c), result: "skipped", reason }); continue; }
    run.push(c);
  }
  return { run, skipped };
}

/** Findings in one file go to one thread, up to `size`; the rest go alone. */
export function groupFindings(findings: VerifyCandidate[], size: number): VerifyCandidate[][] {
  const groups: VerifyCandidate[][] = [];
  const open = new Map<string, VerifyCandidate[]>();
  for (const c of findings) {
    const key = c.path && size > 1 ? c.path : undefined;
    const group = key ? open.get(key) : undefined;
    if (group && group.length < size) { group.push(c); continue; }
    const fresh = [c];
    groups.push(fresh);
    if (key) open.set(key, fresh);
  }
  return groups;
}

interface ThreadOutcome { id?: string; reply?: string; error?: string; costUsd?: number; budgetExhausted?: boolean; timedOut?: boolean }

async function runThread(client: ConsoleClient, deps: VerifyDeps, folder: string, group: VerifyCandidate[], options: VerifyOptions, budget: number): Promise<ThreadOutcome> {
  const title = group.length === 1 ? `Verify: ${group[0]!.title}` : `Verify ${group.length} findings in ${group[0]!.path}`;
  const created = asJson(asJson(await client.request("POST", "/api/console/sessions", { runtime: { model: options.model ?? defaultScanModel() }, title: title.slice(0, 120), costCeilingUsd: budget })).session);
  const id = String(created.id);
  const path = `/api/console/sessions/${encodeURIComponent(id)}`;
  await client.request("PATCH", `${path}/configuration`, { workspacePath: folder });
  const prompt: VerifyPromptFinding[] = group.map(c => ({ id: c.id, title: c.title, category: c.category, description: c.description, ...(c.path ? { path: c.path } : {}), ...(c.startLine ? { startLine: c.startLine } : {}), ...(c.endLine ? { endLine: c.endLine } : {}), ...(c.impact ? { impact: c.impact } : {}) }));
  await client.request("POST", `${path}/messages`, { text: verifyPrompt(prompt) });
  const { snapshot, timedOut } = await waitForThread(client, deps, id, Date.now() + Number(options.timeout) * 1000);
  const done = finishedThread(snapshot);
  const costUsd = typeof done.usage.costUsd === "number" ? done.usage.costUsd : undefined;
  return { id, ...(done.reply ? { reply: done.reply } : {}), ...(done.error ? { error: done.error } : {}), ...(costUsd !== undefined ? { costUsd } : {}), budgetExhausted: asJson(done.session).costCeilingExceeded === true, timedOut };
}

export async function runVerify(ids: string[], options: VerifyOptions, deps: VerifyDeps, preset?: { client: ConsoleClient }): Promise<VerifyReport> {
  const concurrency = parseNumber("--concurrency", options.concurrency, n => Number.isInteger(n) && n >= 1 && n <= MAX_VERIFY_CONCURRENCY, `a whole number from 1 to ${MAX_VERIFY_CONCURRENCY}`);
  const total = parseNumber("--budget", options.budget, n => n > 0, "a positive number of USD");
  const perFinding = parseNumber("--per-finding", options.perFinding, n => n > 0, "a positive number of USD");
  const batch = parseNumber("--batch", options.batch, n => Number.isInteger(n) && n >= 1 && n <= MAX_VERIFY_FINDINGS_PER_PROMPT, `a whole number from 1 to ${MAX_VERIFY_FINDINGS_PER_PROMPT}`);
  const maxConsecutive = parseNumber("--max-consecutive-failures", options.maxConsecutiveFailures, n => Number.isInteger(n) && n >= 1, "a whole number of at least 1");
  const limit = options.limit === undefined ? Infinity : parseNumber("--limit", options.limit, n => Number.isInteger(n) && n >= 1, "a whole number of at least 1");
  parseNumber("--timeout", options.timeout, n => n > 0, "a positive number of seconds");
  if (options.computer || options.engineUrl) throw new UsageError("0 findings verify reads files on this machine; run it against the local console.");
  const folder = resolve(options.folder ?? process.cwd());
  if (!deps.exists(folder, ".")) throw new UsageError(`The folder ${folder} does not exist. Pass the folder that was scanned with --folder.`);

  const { run: selectedAll, skipped } = select(deps.loadCandidates(options.dbPath), ids, options);
  const items = new Map<string, VerifyItem>();
  const base = (c: VerifyCandidate) => ({ finding: c.id, title: c.title, severity: c.severity });
  const queue: VerifyCandidate[] = [];
  for (const c of selectedAll) {
    if (c.path && !deps.exists(folder, c.path)) { items.set(c.id, { ...base(c), result: "skipped", reason: `${c.path} is not in ${folder}; pass the scanned folder with --folder` }); continue; }
    if (queue.length >= limit) { items.set(c.id, { ...base(c), result: "skipped", reason: "beyond --limit; the next run continues here" }); continue; }
    queue.push(c);
  }
  const groups = groupFindings(queue, batch);

  let client = preset?.client;
  let stop: (() => void) | undefined;
  if (!options.dryRun && groups.length && !client) { const connection = await connect(options, deps); client = connection.client; stop = connection.stop; }

  let stoppedReason: string | undefined;
  let spent = 0, reserved = 0, next = 0, consecutive = 0, finished = 0;
  const waiting: Array<() => void> = [];

  const record = (c: VerifyCandidate, group: VerifyCandidate[], thread: ThreadOutcome, parsed: ReturnType<typeof parseVerdicts>): { item: VerifyItem; failed: boolean } => {
    const share = thread.costUsd !== undefined ? Number((thread.costUsd / group.length).toFixed(6)) : undefined;
    const got = parsed.get(c.id);
    let verdict: ModelVerdict; let reasoning: string; let failed = false;
    let duplicateOf: string | undefined; let control: string | undefined; let advisory: string | undefined;
    if (!got) {
      verdict = "uncertain"; reasoning = `no verdict returned${thread.budgetExhausted ? " (the thread stopped at its budget)" : thread.timedOut ? " (the thread timed out)" : ""}`; failed = true;
    } else {
      verdict = got.verdict; reasoning = got.reasoning; control = got.control; advisory = got.severity;
      if (verdict === "duplicate") {
        const target = got.duplicateOf ? group.find(other => other.id !== c.id && (other.id === got.duplicateOf || shortFindingId(other.id) === got.duplicateOf || other.id.startsWith(got.duplicateOf!))) : undefined;
        if (target) duplicateOf = target.id;
        else { verdict = "uncertain"; reasoning = `the thread called this a duplicate of a finding that is not in the same batch (${got.duplicateOf ?? "none named"}). ${reasoning}`; }
      }
    }
    const stored: FindingModelVerification = {
      verdict, reasoning, verifiedAt: deps.now().toISOString(), model: options.model ?? defaultScanModel(),
      ...(duplicateOf ? { duplicateOf } : {}), ...(control ? { control } : {}), ...(advisory ? { advisorySeverity: advisory } : {}),
      ...(thread.id ? { threadId: thread.id } : {}), ...(share !== undefined ? { costUsd: share } : {}),
    };
    let applied = false; let applyRefused: string | undefined;
    if (options.apply && verdict === "false-positive") {
      applyRefused = applyRefusal(c, stored, folder, deps.exists);
      if (!applyRefused) {
        deps.suppress(c, `False positive (model-verified): ${firstSentence(reasoning)}`);
        applied = true; stored.applied = true;
      }
    }
    deps.save(c, stored);
    return { failed, item: { ...base(c), result: "verified", verdict, reasoning, ...(advisory ? { advisorySeverity: advisory } : {}), ...(duplicateOf ? { duplicateOf } : {}), ...(control ? { control } : {}), ...(thread.id ? { threadId: thread.id } : {}), ...(share !== undefined ? { costUsd: share } : {}), ...(applied ? { applied } : {}), ...(applyRefused ? { applyRefused } : {}) } };
  };

  const work = async () => {
    while (!options.dryRun && client) {
      const group = groups[next];
      if (!group || stoppedReason) return;
      const allowance = Math.min(perFinding * group.length, total - spent - reserved);
      if (allowance < 0.01) {
        if (reserved === 0) { stoppedReason ??= BUDGET_SPENT; return; }
        await new Promise<void>(resolveWait => waiting.push(resolveWait));
        continue;
      }
      next++; reserved += allowance;
      let thread: ThreadOutcome = {};
      let failure: string | undefined;
      try { thread = await runThread(client, deps, folder, group, options, Number(allowance.toFixed(4))); }
      catch (error) { failure = error instanceof Error ? error.message.split("\n")[0]! : String(error); }
      reserved -= allowance; spent += thread.costUsd ?? 0;
      let failed = false;
      if (failure || !thread.reply) {
        // The thread itself did not run to an answer: nothing is stored, so the next run tries again.
        failed = true;
        for (const c of group) items.set(c.id, { ...base(c), result: "failed", reason: failure ?? thread.error ?? "the thread returned no answer", ...(thread.id ? { threadId: thread.id } : {}) });
      } else {
        const parsed = parseVerdicts(thread.reply, group.map(c => c.id));
        for (const c of group) {
          const outcome = record(c, group, thread, parsed);
          items.set(c.id, outcome.item);
          if (outcome.failed) failed = true;
        }
      }
      if (failed) consecutive++; else consecutive = 0;
      if (!stoppedReason && consecutive >= maxConsecutive) stoppedReason = `${consecutive} checks in a row returned no verdict`;
      for (const wake of waiting.splice(0)) wake();
      finished++;
      deps.err(`${finished}/${groups.length} ${group.map(c => items.get(c.id)!.verdict ?? items.get(c.id)!.result).join(", ")}: ${group[0]!.title}${group.length > 1 ? ` (+${group.length - 1})` : ""}`);
    }
  };
  try { await Promise.all(Array.from({ length: concurrency }, work)); } finally { stop?.(); }

  for (const group of groups) for (const c of group) {
    if (items.has(c.id)) continue;
    items.set(c.id, { ...base(c), result: options.dryRun ? "planned" : "skipped", ...(options.dryRun ? {} : { reason: `not attempted: ${stoppedReason ?? "stopped"}` }) });
  }
  const ordered = [...selectedAll.map(c => items.get(c.id)!).filter(Boolean), ...skipped];
  const counts = emptyCounts();
  for (const item of ordered) if (item.verdict) counts[item.verdict]++;
  return {
    folder, dryRun: Boolean(options.dryRun), selected: selectedAll.length,
    verified: ordered.filter(i => i.result === "verified").length, failed: ordered.filter(i => i.result === "failed").length,
    skipped: ordered.filter(i => i.result === "skipped").length, counts, applied: ordered.filter(i => i.applied).length,
    costUsd: Number(spent.toFixed(6)), ...(stoppedReason ? { stoppedReason } : {}), items: ordered,
  };
}

export function renderVerifyReport(report: VerifyReport): string {
  const c = report.counts;
  const lines = [
    `${report.dryRun ? "Verification plan" : "Verification report"} for ${report.folder} (experimental, advisory)`,
    `Selected ${report.selected}, verified ${report.verified}, failed ${report.failed}, skipped ${report.skipped}`,
    `true-positive ${c["true-positive"]}, false-positive ${c["false-positive"]}, fixed ${c.fixed}, uncertain ${c.uncertain}, duplicate ${c.duplicate}${report.applied ? `, suppressed by --apply ${report.applied}` : ""}`,
    `Cost $${report.costUsd.toFixed(4)}${report.stoppedReason ? `, stopped: ${report.stoppedReason}` : ""}`,
  ];
  if (report.items.length) lines.push("");
  for (const i of report.items) {
    const label = i.verdict ?? i.result;
    const detail = [i.advisorySeverity && i.advisorySeverity !== i.severity ? `advisory severity ${i.advisorySeverity}` : undefined, i.applied ? "suppressed" : undefined, i.applyRefused ? `not suppressed: ${i.applyRefused}` : undefined, i.reason].filter(Boolean).join("; ");
    lines.push(`  ${label.padEnd(14)} ${i.severity.padEnd(8)} ${shortFindingId(i.finding)} ${i.title.slice(0, 70)}${detail ? `  [${detail}]` : ""}`);
  }
  return lines.join("\n");
}

export function registerVerifyCommand(program: Command, deps: VerifyDeps = defaultVerifyDeps): void {
  consoleTransportOptions(program.command("verify [finding...]")
    .description("Experimental: re-check findings with a fresh thread each and record a verdict next to them")
    .option("--folder <dir>", "The folder that was scanned; the threads read the code there (default: the current directory)")
    .option("--severity <levels>", "Only these severities (critical, high, medium, low, info; comma-separated)")
    .option("--category <category>", "Only this category")
    .option("--tool <name>", "Only findings reported by this tool")
    .option("--scan <id>", "Only findings of this scan (id prefix)")
    .option("--limit <n>", "Check at most this many findings in this run; the next run continues with the rest")
    .option("--force", "Check findings again that already have a verdict")
    .option("--apply", "Suppress findings called false-positive when the verdict cites a control at path:line (default: never change a status)")
    .option("--batch <n>", `Findings in one file that share a thread (1 to ${MAX_VERIFY_FINDINGS_PER_PROMPT})`, "1")
    .option("--concurrency <n>", `Threads at the same time (1 to ${MAX_VERIFY_CONCURRENCY})`, "1")
    .option("--budget <usd>", "Total spend for this run in USD; no new thread starts once it is used", "2")
    .option("--per-finding <usd>", "Spend cap for one finding, in USD", "0.3")
    .option("--max-consecutive-failures <n>", "Stop after this many checks in a row that return no verdict", "3")
    .option("--model <model>", `Model for the threads (${DEFAULT_MODEL_HELP})`)
    .option("--timeout <seconds>", "Maximum seconds to wait for one thread", "600")
    .option("--dry-run", "List what would be checked and skipped; change nothing")
    .addOption(new Option("--format <format>", "Output: text or json").choices(["text", "json"])))
    .addHelpText("after", "\nA verdict is advice stored next to the finding: severity and status stay as they were. With --apply only a false-positive verdict that cites a control at path:line suppresses a finding, with a note you can read in `0 findings show`. Running it again skips findings that already have a verdict.\nExit codes: 0 done, 1 a check returned no verdict or the run stopped on failures, 2 usage error, 3 the total budget ran out.")
    .action(async (findings: string[], options: VerifyOptions) => {
      const json = options.format === "json";
      const err = (text: string) => process.stderr.write(`${text}\n`);
      try {
        const report = await runVerify(findings ?? [], options, { ...deps, err: json ? err : deps.err });
        deps.out(json ? JSON.stringify(report, null, 2) : renderVerifyReport(report));
        process.exitCode = report.stoppedReason === BUDGET_SPENT ? 3 : report.failed > 0 || report.stoppedReason || report.items.some(i => i.result === "verified" && i.reasoning?.startsWith("no verdict returned")) ? 1 : 0;
      } catch (error) { finishWithError(error, { err }, json); }
    });
}
