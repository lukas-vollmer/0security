/**
 * `0 findings burndown`: work through open findings in batches, one `0 findings fix` each, and report.
 *
 * Every finding goes through the same fix flow as `0 findings fix` (its own git work tree, a branch named
 * `0/fix-<id>`, one pull request, a draft when a check fails). Nothing is pushed to the base branch and nothing is
 * merged. The outcome per finding is kept in a small state file under the home state dir, so a second run skips what
 * is finished and continues with the rest; one metrics row per run is kept there too (`--history`).
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { Command } from "commander";
import { homeStateDir } from "@0/engine/shared";
import { osecDB, resolveOsecDbPath } from "@0/engine/storage";
import { consoleTransportOptions, type ConsoleTransportOptions } from "../console-client.js";
import { connect, DEFAULT_MODEL_HELP, defaultScanModel } from "./scan.js";
import { defaultFixDeps, runFix, type FixDeps, type FixOptions, type FixOutcome } from "./fix.js";
import { shortFindingId } from "../finding-id.js";
import { finishWithError, UsageError } from "./output.js";

const exec = promisify(execFile);
const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const DONE_STATUSES = new Set(["fixed", "false-positive"]);
const DONE_TRIAGE = new Set(["accepted", "suppressed"]);
const MAX_HISTORY = 500;
const BUDGET_SPENT = "the total budget is spent";
export const MAX_CONCURRENCY = 4;

export interface Candidate { id: string; fingerprint: string; title: string; severity: string; category: string; tool: string | null; scanId: string; status: string; triage: string; timestamp: number;
  /** Where the finding is, when known; findings at one place in one category are fixed once. */
  path?: string; startLine?: number }

export type ItemResult = "planned" | "pr-opened" | "pr-updated" | "committed" | "no-change" | "failed" | "skipped";
export interface BurndownItem {
  finding: string; fingerprint: string; title: string; severity: string; result: ItemResult; branch?: string; pullRequestUrl?: string;
  draft?: boolean; checksPassing?: boolean; costUsd?: number; reason?: string;
}

/** What is remembered per finding, per repository. */
export interface FindingRecord { finding: string; branch?: string; result: ItemResult; pullRequestUrl?: string; draft?: boolean; checksPassing?: boolean; costUsd?: number; runId: string; updatedAt: string }

/** One row per run (issue: per-run metrics). Tokens are null: the fix flow reports cost, not tokens. */
export interface RunMetrics {
  runId: string; startedAt: string; durationSeconds: number; repo: string; selected: number; attempted: number; proposed: number; committed: number;
  prsOpened: number; prsUpdated: number; checksPassing: number; drafts: number; failed: number; skipped: number; costUsd: number;
  tokens: number | null; ciResult: "passing" | "failing" | "none"; stoppedReason?: string; model: string; noPr: boolean;
}

export interface BurndownState { version: 1; findings: Record<string, FindingRecord>; runs: RunMetrics[] }
export interface StateStore { load(): BurndownState; save(state: BurndownState): void }

export interface BurndownDeps {
  listCandidates(dbPath: string | undefined): Candidate[];
  repoRoot(dir: string): Promise<string>;
  fix(id: string, options: FixOptions): Promise<FixOutcome | undefined>;
  store: StateStore;
  now(): number;
  err(text: string): void;
}

export interface BurndownOptions extends ConsoleTransportOptions {
  repo?: string; base?: string; test?: string[]; pr: boolean; model?: string; timeout: string; format?: string;
  severity?: string; category?: string; tool?: string; source?: string; scan?: string; limit?: string; fingerprint?: string;
  concurrency: string; budget: string; perFix: string; maxConsecutiveFailures: string; maxFailureRate: string; minAttempts?: string;
  dryRun?: boolean; history?: boolean; retry?: boolean;
}

export interface BurndownReport {
  runId: string; repo: string; dryRun: boolean; selected: number; attempted: number; stoppedReason?: string; items: BurndownItem[];
  totals: { proposed: number; committed: number; prsOpened: number; prsUpdated: number; checksPassing: number; drafts: number; failed: number; skipped: number };
  costUsd: number; durationSeconds: number;
}

const emptyState = (): BurndownState => ({ version: 1, findings: {}, runs: [] });
const recordKey = (repo: string, fingerprint: string) => `${repo}\u0000${fingerprint}`;

function parseNumber(name: string, text: string, rule: (n: number) => boolean, expected: string): number {
  const value = Number(text);
  if (!Number.isFinite(value) || !rule(value)) throw new UsageError(`${name} must be ${expected}.`);
  return value;
}

export function fileStore(path: string = join(homeStateDir(), "burndown.json")): StateStore {
  return {
    load() {
      if (!existsSync(path)) return emptyState();
      try {
        const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<BurndownState>;
        return { version: 1, findings: parsed.findings && typeof parsed.findings === "object" ? parsed.findings : {}, runs: Array.isArray(parsed.runs) ? parsed.runs : [] };
      } catch { throw new Error(`The burn-down state file ${path} is not valid JSON; move it aside to start over.`); }
    },
    save(state) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const temp = `${path}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
      renameSync(temp, path);
    },
  };
}

/** The newest row of each fingerprint, so a finding seen by several scans is worked on once. */
export function listOpenCandidates(dbPath: string | undefined): Candidate[] {
  const db = new osecDB(resolveOsecDbPath(dbPath));
  try {
    const rows = db.listFindings({ limit: 5000 }) as unknown as Array<Record<string, unknown>>;
    const latest = new Map<string, Candidate>();
    for (const row of rows) {
      const id = String(row.id);
      const candidate: Candidate = {
        id, fingerprint: String(row.fingerprint ?? id), title: String(row.title), severity: String(row.severity), category: String(row.category),
        tool: typeof row.tool === "string" ? row.tool : null, scanId: String(row.scanId), status: String(row.status), triage: String(row.triageStatus ?? "new"), timestamp: Number(row.timestamp ?? 0),
      };
      const annotation = db.getFindingReviewFields(id).reviewAnnotation;
      if (annotation && typeof annotation.path === "string" && annotation.path) { candidate.path = annotation.path; if (typeof annotation.startLine === "number") candidate.startLine = annotation.startLine; }
      const seen = latest.get(candidate.fingerprint);
      if (!seen || seen.timestamp < candidate.timestamp) latest.set(candidate.fingerprint, candidate);
    }
    return [...latest.values()];
  } finally { db.close(); }
}

/** Open (not fixed, false positive, accepted or suppressed) findings that match the filters, worst first. */
export function selectCandidates(all: Candidate[], options: Pick<BurndownOptions, "severity" | "category" | "tool" | "source" | "scan" | "fingerprint">): Candidate[] {
  const severities = options.severity ? options.severity.split(",").map(s => s.trim().toLowerCase()).filter(Boolean) : undefined;
  for (const s of severities ?? []) if (!(SEVERITIES as readonly string[]).includes(s)) throw new UsageError(`--severity must be one of ${SEVERITIES.join(", ")} (comma-separated for several).`);
  const tool = (options.tool ?? options.source)?.toLowerCase();
  const category = options.category?.toLowerCase();
  return all.filter(c => !DONE_STATUSES.has(c.status) && !DONE_TRIAGE.has(c.triage)
    && (!severities || severities.includes(c.severity.toLowerCase()))
    && (!category || c.category.toLowerCase() === category)
    && (!tool || (c.tool ?? "").toLowerCase() === tool)
    && (!options.scan || c.scanId.startsWith(options.scan))
    && (!options.fingerprint || c.fingerprint.startsWith(options.fingerprint) || c.id.startsWith(options.fingerprint)))
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || a.id.localeCompare(b.id));
}

function describe(outcome: FixOutcome | undefined): Partial<BurndownItem> & { result: ItemResult } {
  if (!outcome) return { result: "failed", reason: "the fix flow returned nothing" };
  const base: Partial<BurndownItem> = { branch: outcome.branch, ...(outcome.costUsd !== undefined ? { costUsd: outcome.costUsd } : {}) };
  if (!outcome.committed) return { ...base, result: "no-change", reason: outcome.budgetExhausted ? "stopped at the per-fix budget" : outcome.timedOut ? "timed out" : "the thread made no change" };
  const checks = { checksPassing: outcome.verified, ...(outcome.verified ? {} : { reason: "a check failed or the thread reported an error" }) };
  if (outcome.pullRequest) return { ...base, ...checks, result: outcome.pullRequest.created ? "pr-opened" : "pr-updated", pullRequestUrl: outcome.pullRequest.url, draft: outcome.pullRequest.draft };
  return { ...base, ...checks, result: "committed" };
}

/** A finding with a pull request is not worked on again. A change committed under `--no-pr` is picked up again when pull requests are on. */
function skipReason(record: FindingRecord | undefined, options: BurndownOptions): string | undefined {
  if (!record || options.retry) return undefined;
  if (record.result === "pr-opened" || record.result === "pr-updated") return `a pull request is already open${record.pullRequestUrl ? ` (${record.pullRequestUrl})` : ""}`;
  if (record.result === "committed" && !options.pr) return `already committed on ${record.branch}`;
  return undefined;
}

const isSuccess = (i: BurndownItem) => i.result === "pr-opened" || i.result === "pr-updated" || i.result === "committed";

export async function runBurndown(options: BurndownOptions, deps: BurndownDeps): Promise<BurndownReport> {
  const concurrency = parseNumber("--concurrency", options.concurrency, n => Number.isInteger(n) && n >= 1 && n <= MAX_CONCURRENCY, `a whole number from 1 to ${MAX_CONCURRENCY}`);
  const total = parseNumber("--budget", options.budget, n => n > 0, "a positive number of USD");
  const perFix = parseNumber("--per-fix", options.perFix, n => n > 0, "a positive number of USD");
  const maxConsecutive = parseNumber("--max-consecutive-failures", options.maxConsecutiveFailures, n => Number.isInteger(n) && n >= 1, "a whole number of at least 1");
  const maxRate = parseNumber("--max-failure-rate", options.maxFailureRate, n => n > 0 && n <= 1, "a fraction above 0 and at most 1");
  const minAttempts = parseNumber("--min-attempts", options.minAttempts ?? "4", n => Number.isInteger(n) && n >= 1, "a whole number of at least 1");
  const limit = options.limit === undefined ? Infinity : parseNumber("--limit", options.limit, n => Number.isInteger(n) && n >= 1, "a whole number of at least 1");
  parseNumber("--timeout", options.timeout, n => n > 0, "a positive number of seconds");
  if (options.computer || options.engineUrl) throw new UsageError("0 findings burndown edits files on this machine; run it against the local console.");

  let repo: string;
  try { repo = await deps.repoRoot(resolve(options.repo ?? process.cwd())); }
  catch { throw new UsageError("Run this inside the git repository the findings are in, or pass --repo."); }
  const selected = selectCandidates(deps.listCandidates(options.dbPath), options);
  const state = deps.store.load();
  const started = deps.now();
  const runId = randomUUID();
  const model = options.model ?? defaultScanModel();

  const items = new Map<string, BurndownItem>();
  const queue: Candidate[] = [];
  // The same defect reported twice (a pattern rule and a taint rule, say) gets one fix: the worst of them, which comes first.
  const firstAt = new Map<string, Candidate>();
  for (const c of selected) {
    const place = c.path && c.startLine !== undefined ? `${c.path}\u0000${c.startLine}\u0000${c.category.toLowerCase()}` : undefined;
    const covering = place ? firstAt.get(place) : undefined;
    if (place && !covering) firstAt.set(place, c);
    const base = { finding: c.id, fingerprint: c.fingerprint, title: c.title, severity: c.severity };
    if (covering) { items.set(c.id, { ...base, result: "skipped", reason: `same location as ${covering.id}` }); continue; }
    const reason = skipReason(state.findings[recordKey(repo, c.fingerprint)], options);
    if (reason) items.set(c.id, { ...base, result: "skipped", reason });
    else if (queue.length < limit) queue.push(c);
    else items.set(c.id, { ...base, result: "skipped", reason: "beyond --limit; the next run continues here" });
  }

  let stoppedReason: string | undefined;
  let finished = 0, attempted = 0, failures = 0, consecutive = 0, spent = 0, reserved = 0, next = 0;
  const settle = (failed: boolean) => {
    if (failed) { failures++; consecutive++; } else consecutive = 0;
    if (stoppedReason) return;
    if (consecutive >= maxConsecutive) stoppedReason = `${consecutive} fixes failed in a row`;
    else if (attempted >= minAttempts && failures / attempted > maxRate) stoppedReason = `failure share ${Math.round(100 * failures / attempted)}% is above ${Math.round(100 * maxRate)}%`;
  };

  const waiting: Array<() => void> = [];
  const work = async () => {
    while (!options.dryRun) {
      const c = queue[next];
      if (!c || stoppedReason) return;
      const allowance = Math.min(perFix, total - spent - reserved);
      if (allowance < 0.01) {
        if (reserved === 0) { stoppedReason ??= BUDGET_SPENT; return; }
        // Other fixes hold the rest of the budget; what they do not spend is available again when they finish.
        await new Promise<void>(resolve => waiting.push(resolve));
        continue;
      }
      next++; attempted++; reserved += allowance;
      const base = { finding: c.id, fingerprint: c.fingerprint, title: c.title, severity: c.severity };
      let item: BurndownItem;
      try {
        const fixOptions: FixOptions = { ...options, repo, budget: String(Number(allowance.toFixed(4))), timeout: options.timeout, pr: options.pr };
        item = { ...base, ...describe(await deps.fix(c.id, fixOptions)) };
      } catch (error) {
        item = { ...base, result: "failed", reason: error instanceof Error ? error.message : String(error) };
      }
      reserved -= allowance; spent += item.costUsd ?? 0;
      items.set(c.id, item);
      settle(item.result === "failed" || item.result === "no-change" || item.checksPassing === false);
      state.findings[recordKey(repo, c.fingerprint)] = {
        finding: c.id, result: item.result, runId, updatedAt: new Date(deps.now()).toISOString(),
        ...(item.branch ? { branch: item.branch } : {}), ...(item.pullRequestUrl ? { pullRequestUrl: item.pullRequestUrl } : {}),
        ...(item.draft !== undefined ? { draft: item.draft } : {}), ...(item.checksPassing !== undefined ? { checksPassing: item.checksPassing } : {}), ...(item.costUsd !== undefined ? { costUsd: item.costUsd } : {}),
      };
      deps.store.save(state);
      for (const wake of waiting.splice(0)) wake();
      finished++;
      deps.err(`${finished}/${queue.length} ${item.result}: ${c.title}${item.reason ? ` (${item.reason})` : ""}`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, work));

  for (const c of queue.slice(next)) items.set(c.id, { finding: c.id, fingerprint: c.fingerprint, title: c.title, severity: c.severity, result: options.dryRun ? "planned" : "skipped", ...(options.dryRun ? {} : { reason: `not attempted: ${stoppedReason ?? "stopped"}` }) });
  const ordered = selected.map(c => items.get(c.id)!);
  const count = (pick: (i: BurndownItem) => boolean) => ordered.filter(pick).length;
  const totals = {
    proposed: count(isSuccess), committed: count(isSuccess),
    prsOpened: count(i => i.result === "pr-opened"), prsUpdated: count(i => i.result === "pr-updated"),
    checksPassing: count(i => i.checksPassing === true), drafts: count(i => i.draft === true),
    failed: count(i => i.result === "failed" || i.result === "no-change"), skipped: count(i => i.result === "skipped"),
  };
  const costUsd = Number(spent.toFixed(6));
  const durationSeconds = Math.round((deps.now() - started) / 1000);
  const report: BurndownReport = { runId, repo, dryRun: Boolean(options.dryRun), selected: selected.length, attempted, ...(stoppedReason ? { stoppedReason } : {}), items: ordered, totals, costUsd, durationSeconds };

  if (!options.dryRun && attempted > 0) {
    const checked = ordered.filter(i => i.checksPassing !== undefined);
    const row: RunMetrics = {
      runId, startedAt: new Date(started).toISOString(), durationSeconds, repo, selected: selected.length, attempted, proposed: totals.proposed, committed: totals.committed,
      prsOpened: totals.prsOpened, prsUpdated: totals.prsUpdated, checksPassing: totals.checksPassing, drafts: totals.drafts, failed: totals.failed, skipped: totals.skipped, costUsd,
      tokens: null, ciResult: !checked.length ? "none" : checked.every(i => i.checksPassing) ? "passing" : "failing", ...(stoppedReason ? { stoppedReason } : {}), model, noPr: !options.pr,
    };
    state.runs = [...state.runs, row].slice(-MAX_HISTORY);
    deps.store.save(state);
  }
  return report;
}

export function renderReport(report: BurndownReport): string {
  const t = report.totals;
  const lines = [
    `${report.dryRun ? "Burn-down plan" : "Burn-down report"} for ${report.repo}`,
    `Selected ${report.selected}, attempted ${report.attempted}, proposed ${t.proposed}, committed ${t.committed}, pull requests opened ${t.prsOpened} / updated ${t.prsUpdated}`,
    `Checks passing ${t.checksPassing}, draft because a check failed ${t.drafts}, failed or no change ${t.failed}, skipped ${t.skipped}`,
    `Cost $${report.costUsd.toFixed(4)}, time ${report.durationSeconds}s${report.stoppedReason ? `, stopped: ${report.stoppedReason}` : ""}`,
  ];
  if (report.items.length) lines.push("");
  for (const i of report.items) {
    const detail = [i.pullRequestUrl, i.draft ? "draft" : undefined, i.branch && !i.pullRequestUrl ? i.branch : undefined, i.reason].filter(Boolean).join("; ");
    lines.push(`  ${i.result.padEnd(10)} ${i.severity.padEnd(8)} ${shortFindingId(i.finding)} ${i.title.slice(0, 70)}${detail ? `  [${detail}]` : ""}`);
  }
  return lines.join("\n");
}

export function renderHistory(runs: RunMetrics[]): string {
  if (!runs.length) return "No burn-down runs yet.";
  return ["started              attempted proposed prs checks  drafts failed cost       time  repo",
    ...runs.map(r => `${r.startedAt.slice(0, 19)}Z ${String(r.attempted).padStart(9)} ${String(r.proposed).padStart(8)} ${String(r.prsOpened + r.prsUpdated).padStart(3)} ${r.ciResult.padEnd(7)} ${String(r.drafts).padStart(6)} ${String(r.failed).padStart(6)} $${r.costUsd.toFixed(4).padEnd(9)} ${String(r.durationSeconds).padStart(4)}s  ${r.repo}`)].join("\n");
}

async function gitRoot(dir: string): Promise<string> { return (await exec("git", ["-C", dir, "rev-parse", "--show-toplevel"])).stdout.trim(); }

export function registerBurndownCommand(program: Command, fixDeps: FixDeps = defaultFixDeps, store: StateStore = fileStore()): void {
  const collect = (value: string, previous: string[] = []) => [...previous, value];
  consoleTransportOptions(program.command("burndown")
    .description("Work through open findings in batches: one fix branch and pull request each, then a report")
    .option("--severity <levels>", "Only these severities (critical, high, medium, low, info; comma-separated)")
    .option("--category <category>", "Only this category")
    .option("--tool <name>", "Only findings reported by this tool")
    .option("--source <name>", "Alias of --tool")
    .option("--scan <id>", "Only findings of this scan (id prefix)")
    .option("--fingerprint <prefix>", "Only findings whose fingerprint or id starts with this")
    .option("--limit <n>", "Attempt at most this many findings in this run; the next run continues with the rest")
    .option("--repo <dir>", "Git repository the findings are in (default: the current directory)")
    .option("--base <branch>", "Branch to start from and open pull requests against (default: the remote's default branch)")
    .option("--test <command>", "Check to run after each change; repeat for several. A failing check makes the pull request a draft", collect)
    .option("--no-pr", "Commit on the fix branches but do not push or open pull requests")
    .option("--concurrency <n>", `Fixes at the same time, each in its own work tree (1 to ${MAX_CONCURRENCY})`, "1")
    .option("--budget <usd>", "Total spend for this run in USD; no new fix starts once it is used", "10")
    .option("--per-fix <usd>", "Spend cap for one fix, in USD", "3")
    .option("--max-consecutive-failures <n>", "Stop after this many failed fixes in a row", "3")
    .option("--max-failure-rate <fraction>", "Stop when the share of failed fixes is above this (after --min-attempts)", "0.5")
    .option("--min-attempts <n>", "Fixes to attempt before the failure share can stop the run", "4")
    .option("--model <model>", `Model for the fix threads (${DEFAULT_MODEL_HELP})`)
    .option("--timeout <seconds>", "Maximum seconds to wait for one fix", "1800")
    .option("--retry", "Work again on findings that already have a fix branch or pull request")
    .option("--dry-run", "List what would be attempted and skipped; change nothing")
    .option("--history", "List the metrics row of each earlier run and exit"))
    .addHelpText("after", "\nNothing is pushed to the base branch and nothing is merged. The outcome per finding is kept in ~/.0/burndown.json: running it again skips findings that already have a pull request and continues with the rest.\nExit codes: 0 every attempted fix is verified (or nothing to do), 1 a fix failed or the run stopped on failures, 2 usage error, 3 the total budget ran out.")
    .action(async (options: BurndownOptions) => {
      const json = options.format === "json";
      const err = (text: string) => process.stderr.write(`${text}\n`);
      try {
        if (options.history) {
          const runs = store.load().runs;
          process.stdout.write(`${json ? JSON.stringify(runs, null, 2) : renderHistory(runs)}\n`);
          return;
        }
        // One console for the whole run, not one per fix.
        let stop: (() => void) | undefined;
        let shared: FixDeps = fixDeps;
        if (!options.dryRun) {
          const connection = await connect(options, fixDeps);
          stop = connection.stop;
          shared = { ...fixDeps, open: async () => connection.client, startConsole: async () => () => {}, err: json ? err : fixDeps.err };
        }
        try {
          const report = await runBurndown(options, { listCandidates: listOpenCandidates, repoRoot: gitRoot, fix: (id, fixOptions) => runFix(id, fixOptions, shared), store, now: Date.now, err });
          process.stdout.write(`${json ? JSON.stringify(report, null, 2) : renderReport(report)}\n`);
          process.exitCode = report.stoppedReason === BUDGET_SPENT ? 3 : report.totals.failed > 0 || report.stoppedReason || report.items.some(i => i.checksPassing === false) ? 1 : 0;
        } finally { stop?.(); }
      } catch (error) { finishWithError(error, { err }, json); }
    });
}
