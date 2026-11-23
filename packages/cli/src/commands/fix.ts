/**
 * `0 fix <finding>`: a thread that follows the `fix-finding` skill in an isolated git work tree, then a pull request.
 *
 * The thread makes the smallest change it can. This command does the rest, the same way every time: it runs the
 * checks you name, commits on a branch of its own and opens or updates one pull request, a draft when a check
 * fails. It never pushes to the default branch and never merges; a person reviews and merges.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { Command } from "commander";
import { fixPrompt, type FixPolicy, type FixPromptFinding } from "@0/engine/shared";
import { loadFixPolicyFile, type FixPolicyOptions, type LoadedFixPolicy } from "./fix-policy.js";
import { osecDB, resolveOsecDbPath } from "@0/engine/storage";
import { consoleTransportOptions, type ConsoleClient, type ConsoleTransportOptions } from "../console-client.js";
import { connect, DEFAULT_MODEL_HELP, defaultScanDeps, defaultScanModel, waitForThread, type ScanDeps } from "./scan.js";
import { resolveFindingId, shortFindingId } from "../finding-id.js";
import { selectHost } from "../host/index.js";
import { finishWithError, UsageError } from "./output.js";

export { DEFAULT_FIX_POLICY_FILES, parseFixPolicy, loadFixPolicyFile } from "./fix-policy.js";
import { asJson, finishedThread, usageLine } from "./thread-output.js";

const exec = promisify(execFile);
const DEFAULT_BUDGET_USD = 3;
const DEFAULT_TIMEOUT_SECONDS = 1800;
const CHECK_TIMEOUT_MS = 10 * 60 * 1000;
export const BRANCH_PREFIX = "0/fix-";

export interface CheckResult { command: string; code: number; output: string }
export interface FindingToFix extends FixPromptFinding { fingerprint: string }

export interface FixDeps extends Pick<ScanDeps, "open" | "err" | "sleep" | "startConsole"> {
  out(text: string): void;
  git(cwd: string, args: string[]): Promise<string>;
  gh(cwd: string, args: string[]): Promise<string>;
  /** Run one check command in the work tree through the shell. Never throws on a failing command. */
  check(cwd: string, command: string): Promise<CheckResult>;
  loadFinding(id: string, dbPath: string | undefined): FindingToFix;
  loadPolicy(repoRoot: string, options: FixPolicyOptions): LoadedFixPolicy | undefined;
  makeTemp(): string;
  removeTemp(path: string): void;
  writeFile(path: string, text: string): void;
}

function resolveRow(rows: Array<Record<string, unknown>>, id: string): Record<string, unknown> {
  try {
    const row = resolveFindingId(rows as Array<{ id: string } & Record<string, unknown>>, id);
    if (row) return row;
  } catch (error) { throw new UsageError(error instanceof Error ? error.message : String(error)); }
  throw new UsageError(`Finding '${id}' not found.`);
}

const defaults: FixDeps = {
  open: defaultScanDeps.open, err: defaultScanDeps.err, sleep: defaultScanDeps.sleep, startConsole: defaultScanDeps.startConsole,
  out: text => process.stdout.write(`${text}\n`),
  async git(cwd, args) { return (await exec("git", ["-C", cwd, ...args], { maxBuffer: 32 * 1024 * 1024 })).stdout; },
  async gh(cwd, args) { return (await exec("gh", args, { cwd, maxBuffer: 32 * 1024 * 1024 })).stdout; },
  async check(cwd, command) {
    try {
      const { stdout, stderr } = await exec("/bin/sh", ["-c", command], { cwd, timeout: CHECK_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
      return { command, code: 0, output: `${stdout}${stderr}` };
    } catch (error) {
      const failure = error as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean };
      return { command, code: typeof failure.code === "number" ? failure.code : failure.killed ? 124 : 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
    }
  },
  loadFinding(id, dbPath) {
    const db = new osecDB(resolveOsecDbPath(dbPath));
    try {
      const row = resolveRow(db.listFindings({ limit: 5000 }) as unknown as Array<Record<string, unknown>>, id);
      const annotation = db.getFindingReviewFields(String(row.id)).reviewAnnotation;
      return {
        id: String(row.id), title: String(row.title), severity: String(row.severity), category: String(row.category),
        tool: typeof row.tool === "string" ? row.tool : null, description: String(row.description ?? ""),
        fingerprint: String(row.fingerprint ?? row.id),
        ...(annotation ? { path: annotation.path, startLine: annotation.startLine, ...(annotation.endLine ? { endLine: annotation.endLine } : {}) } : {}),
        ...(typeof row.evidenceResponse === "string" && row.evidenceResponse ? { snippet: row.evidenceResponse } : {}),
      };
    } finally { db.close(); }
  },
  loadPolicy: (repoRoot, options) => loadFixPolicyFile(repoRoot, options),
  makeTemp: () => mkdtempSync(join(tmpdir(), "0-fix-")),
  removeTemp: path => rmSync(path, { recursive: true, force: true }),
  writeFile: (path, text) => writeFileSync(path, text, { mode: 0o600 }),
};

export const defaultFixDeps: FixDeps = defaults;

/** The same finding always gets the same branch, so a second run updates the same pull request. */
export function fixBranchName(fingerprint: string): string {
  return `${BRANCH_PREFIX}${createHash("sha256").update(fingerprint).digest("hex").slice(0, 12)}`;
}

/** Report text goes into a pull request body: stop it from notifying people or referencing other issues. */
const inert = (text: string): string => text.replace(/@/g, "@\u200b").replace(/(^|\s)#(\d)/g, "$1#\u200b$2");

/** Text for a table cell or an HTML element: no markup, no pipes, one line. */
const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cell = (text: string): string => inert(escapeHtml(text.replace(/\s+/g, " ").trim())).replace(/\|/g, "\\|").replace(/`/g, "'");

/** The model's own words can claim anything about the checks; leave out any line that is headed "Checks" so the real table stays the only one. */
const withoutCheckHeadings = (text: string): string => {
  let skipping = false;
  return text.split("\n").filter(line => {
    if (/^\s*(?:(?:#{1,6}|[*_]{1,3})\s*checks?\b|checks?\s*:?\s*$)/i.test(line)) { skipping = true; return false; }
    if (skipping && (!line.trim() || /^\s*#{1,6}\s/.test(line))) skipping = false;
    return !skipping;
  }).join("\n").trim();
};

export function pullRequestBody(finding: FindingToFix, summary: string | undefined, checks: CheckResult[]): string {
  const where = finding.path ? `\`${finding.path.replace(/`/g, "'")}${finding.startLine ? `:${finding.startLine}` : ""}\`` : "not given";
  const rows = checks.length ? checks.map(check => `| \`${escapeHtml(check.command.replace(/`/g, "'").replace(/\s+/g, " ")).replace(/\|/g, "\\|")}\` | ${check.code === 0 ? "passed" : `failed (exit ${check.code})`} |`).join("\n") : "| none were run | |";
  const failed = checks.filter(check => check.code !== 0);
  const tails = failed.map(check => `<details><summary>${inert(escapeHtml(check.command.replace(/\s+/g, " ")))}</summary>\n\n\`\`\`\n${check.output.slice(-2000).replace(/```/g, "'''")}\n\`\`\`\n</details>`).join("\n");
  const modelText = withoutCheckHeadings((summary ?? "").slice(0, 5000));
  return [
    `Fixes finding ${shortFindingId(finding.id)}: ${inert(finding.title)}`,
    "",
    `| Severity | Category | Reported by | Where |\n| --- | --- | --- | --- |\n| ${cell(finding.severity)} | ${cell(finding.category)} | ${cell(finding.tool ?? "0")} | ${where} |`,
    "",
    "### Checks",
    `| Command | Result |\n| --- | --- |\n${rows}`,
    ...(tails ? ["", tails] : []),
    "",
    "### What changed",
    "Summary written by the model (not verified). The Checks table above is what 0 ran.",
    "",
    inert(modelText || "The change is in the diff."),
    "",
    failed.length ? "Opened as a draft because a check failed. Review it before it is marked ready." : "A person should review this before merging; 0 does not merge.",
  ].join("\n");
}

export interface FixOptions extends ConsoleTransportOptions {
  repo?: string; base?: string; test?: string[]; budget: string; model?: string; timeout: string; pr: boolean; format?: string; policy?: string; repoPolicy?: boolean;
}

export interface FixOutcome {
  finding: string; branch: string; changed: boolean; committed: boolean; checks: CheckResult[]; verified: boolean;
  pullRequest?: { url: string; created: boolean; draft: boolean }; threadId?: string; costUsd?: number; budgetExhausted?: boolean; timedOut?: boolean; summary?: string;
}

async function defaultBase(deps: FixDeps, repo: string, requested?: string): Promise<{ ref: string; name: string }> {
  if (requested) return { ref: requested, name: requested.replace(/^origin\//, "") };
  try {
    const head = (await deps.git(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).trim();
    if (head) return { ref: head, name: head.replace(/^origin\//, "") };
  } catch { /* no remote HEAD */ }
  const current = (await deps.git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  return { ref: "HEAD", name: current === "HEAD" ? "main" : current };
}

export async function runFix(id: string, options: FixOptions, deps: FixDeps): Promise<FixOutcome | undefined> {
  let stopConsole: (() => void) | undefined;
  let temp: string | undefined;
  let repo = "";
  let tree = "";
  let madeBranch: { repo: string; branch: string; existed: boolean } | undefined;
  let committedBranch = false;
  try {
    const budget = Number(options.budget);
    if (!Number.isFinite(budget) || budget <= 0) throw new UsageError("--budget must be a positive number of USD.");
    if (!Number.isFinite(Number(options.timeout)) || Number(options.timeout) <= 0) throw new UsageError("--timeout must be a positive number of seconds.");
    if (options.computer || options.engineUrl) throw new UsageError("0 fix edits files on this machine; run it against the local console.");
    const finding = deps.loadFinding(id, options.dbPath);
    try { repo = (await deps.git(resolve(options.repo ?? process.cwd()), ["rev-parse", "--show-toplevel"])).trim(); }
    catch { throw new UsageError("Run this inside the git repository the finding is in, or pass --repo."); }
    const base = await defaultBase(deps, repo, options.base);
    const branch = fixBranchName(finding.fingerprint);
    if (branch === base.name || !branch.startsWith(BRANCH_PREFIX)) throw new Error("Refusing to work on the base branch.");

    temp = deps.makeTemp();
    tree = join(temp, "tree");
    const branchExisted = await deps.git(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).then(() => true, () => false);
    await deps.git(repo, ["worktree", "add", "--quiet", "-B", branch, tree, base.ref]);
    madeBranch = { repo, branch, existed: branchExisted };
    deps.err(`fixing ${finding.title} on branch ${branch} (isolated work tree, base ${base.name})`);

    const { client, stop } = await connect(options, deps);
    stopConsole = stop;
    const loaded = deps.loadPolicy(repo, options);
    const policy = loaded?.policy;
    if (loaded) {
      const libs = loaded.policy.approvedLibraries?.length ?? 0;
      const rules = loaded.policy.rules?.length ?? 0;
      deps.err(`applying fix policy from ${loaded.source} (${libs} approved ${libs === 1 ? "library" : "libraries"}, ${rules} ${rules === 1 ? "rule" : "rules"})`);
      if (loaded.fromRepo) deps.err("warning: this policy comes from the repository being fixed, which is untrusted; it is guidance for the model, not a safety control");
    }
    const outcomeBase = { finding: finding.id, branch };
    const thread = await runThread(client, deps, tree, finding, options, budget, policy);
    const status = (await deps.git(tree, ["status", "--porcelain", "--untracked-files=all"])).trim();
    const common = { ...outcomeBase, threadId: thread.id, ...(thread.costUsd !== undefined ? { costUsd: thread.costUsd } : {}), ...(thread.budgetExhausted ? { budgetExhausted: true } : {}), ...(thread.timedOut ? { timedOut: true } : {}), ...(thread.reply ? { summary: thread.reply } : {}) };
    if (!status) {
      deps.err(thread.error ?? "The thread made no change; no pull request was opened.");
      return { ...common, changed: false, committed: false, checks: [], verified: false };
    }

    const checks: CheckResult[] = [];
    for (const command of options.test ?? []) { deps.err(`running: ${command}`); checks.push(await deps.check(tree, command)); }
    const verified = checks.every(check => check.code === 0) && !thread.failed;

    await deps.git(tree, ["add", "-A"]);
    // A clean machine or an Actions runner has no git identity; use a neutral one rather than fail the commit.
    const configured = (await deps.git(tree, ["config", "user.email"]).catch(() => "")).trim();
    const identity = configured ? [] : ["-c", "user.name=0", "-c", "user.email=noreply@0.security"];
    await deps.git(tree, [...identity, "commit", "--quiet", "-m", `fix: ${finding.title.slice(0, 120)}\n\nFinding ${finding.id}`]);
    committedBranch = true;
    const outcome: FixOutcome = { ...common, changed: true, committed: true, checks, verified };
    if (!options.pr) { deps.err(`committed on ${branch}; not pushed (--no-pr).`); return outcome; }

    // The branch is ours and only ours: never the base, always with a lease so a person's later push is not overwritten.
    const host = selectHost({ run: args => deps.gh(tree, args), git: args => deps.git(tree, args) });
    await host.pushBranch(branch);
    const bodyFile = join(temp, "body.md");
    deps.writeFile(bodyFile, pullRequestBody(finding, thread.reply, checks));
    const draft = !verified;
    const existing = await host.findOpenPullRequest(branch);
    let url: string; let created = false;
    if (existing) {
      url = existing.url;
      await host.updatePullRequestBody(existing.number, bodyFile);
      if (existing.isDraft && !draft) await host.setPullRequestReady(existing.number, true);
      if (!existing.isDraft && draft) await host.setPullRequestReady(existing.number, false);
    } else {
      created = true;
      url = await host.createPullRequest({ base: base.name, head: branch, title: `fix: ${finding.title.slice(0, 120)}`, bodyFile, draft });
    }
    return { ...outcome, pullRequest: { url, created, draft } };
  } finally {
    stopConsole?.();
    if (tree && repo) await deps.git(repo, ["worktree", "remove", "--force", tree]).catch(() => undefined);
    // A branch this run made and never committed to is only clutter.
    if (madeBranch && !madeBranch.existed && !committedBranch) await deps.git(madeBranch.repo, ["branch", "-D", madeBranch.branch]).catch(() => undefined);
    if (temp) deps.removeTemp(temp);
  }
}

async function runThread(client: ConsoleClient, deps: FixDeps, folder: string, finding: FindingToFix, options: FixOptions, budget: number, policy?: FixPolicy) {
  const created = asJson(asJson(await client.request("POST", "/api/console/sessions", { runtime: { model: options.model ?? defaultScanModel() }, title: `Fix: ${finding.title}`.slice(0, 120), costCeilingUsd: budget })).session);
  const id = String(created.id);
  const path = `/api/console/sessions/${encodeURIComponent(id)}`;
  await client.request("PATCH", `${path}/configuration`, { workspacePath: folder });
  await client.request("POST", `${path}/messages`, { text: fixPrompt(finding, { tests: options.test ?? [], policy }) });
  deps.err(`working in thread ${id} (budget $${Number(budget.toFixed(4))})`);
  const { snapshot, timedOut } = await waitForThread(client, deps, id, Date.now() + Number(options.timeout) * 1000);
  const done = finishedThread(snapshot);
  const costUsd = typeof done.usage.costUsd === "number" ? done.usage.costUsd : undefined;
  return { id, reply: done.reply, error: done.error, failed: done.failed && !timedOut, timedOut, budgetExhausted: asJson(done.session).costCeilingExceeded === true, usage: usageLine(done.usage), ...(costUsd !== undefined ? { costUsd } : {}) };
}

export function registerFixCommand(program: Command, deps: FixDeps = defaults): void {
  const collect = (value: string, previous: string[] = []) => [...previous, value];
  consoleTransportOptions(program.command("fix <finding>")
    .description("Fix one finding in an isolated git work tree and open a pull request for review")
    .option("--repo <dir>", "Git repository the finding is in (default: the current directory)")
    .option("--base <branch>", "Branch to start from and open the pull request against (default: the remote's default branch)")
    .option("--test <command>", "Check to run after the change; repeat for several. A failing check makes the pull request a draft", collect)
    .option("--policy <file>", "Policy file (.json or .yaml) of approved libraries and fix rules; any path you name, relative to the current directory. Default: ~/.0/fix-policy.json|yaml|yml")
    .option("--repo-policy", "Also read fix-policy.* or .zero/fix-policy.* from the repository being fixed (untrusted content; off by default)")
    .option("--no-pr", "Commit on the fix branch but do not push or open a pull request")
    .option("--budget <usd>", "Stop when the estimated spend reaches this many USD", String(DEFAULT_BUDGET_USD))
    .option("--model <model>", `Model for the fix thread (${DEFAULT_MODEL_HELP})`)
    .option("--timeout <seconds>", "Maximum seconds to wait for the fix", String(DEFAULT_TIMEOUT_SECONDS))
    )
    .addHelpText("after", "\nNothing is pushed to the base branch and nothing is merged: the change goes to a branch named 0/fix-<id>, and running it again updates the same pull request.\nExit codes: 0 a verified change (or committed with --no-pr), 1 no change or a failed check, 2 usage error, 3 stopped at the budget or time limit.")
    .action(async (finding: string, options: FixOptions) => {
      try {
        const outcome = await runFix(finding, options, deps);
        if (!outcome) return;
        if (options.format === "json") deps.out(JSON.stringify(outcome, null, 2));
        else if (outcome.pullRequest) deps.out(`${outcome.pullRequest.created ? "Opened" : "Updated"} ${outcome.pullRequest.draft ? "draft " : ""}pull request: ${outcome.pullRequest.url}`);
        else if (outcome.committed) deps.out(`Committed on ${outcome.branch}.`);
        else deps.out("No change was made.");
        process.exitCode = outcome.budgetExhausted || outcome.timedOut ? 3 : outcome.changed && outcome.verified ? 0 : 1;
      } catch (error) { finishWithError(error, { err: deps.err }, options.format === "json"); }
    });
}
