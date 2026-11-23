/**
 * `0 threat-model [folder]`: a thread that follows the `threat-model` skill and writes `.0/threat-model.md`.
 *
 * With `--pr` the thread works in a separate git work tree on the branch `0/threat-model`, and the file goes up as a
 * pull request people review and merge. Nothing is pushed to the base branch and nothing is merged. Later scans read
 * the merged file with `--context` (or `--repo-context`; see the scan command for why that is opt-in).
 *
 * The git and gh steps below follow `0 fix` (fix.ts). They are written out here on purpose, because gh access is
 * being moved behind a Host port in fix.ts, burndown.ts and the findings commands; when that lands, `git` and `gh`
 * in ThreatModelDeps should become calls on the port.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { Command } from "commander";
import { THREAT_MODEL_PATH, threatModelPrompt } from "@0/engine/shared";
import { consoleTransportOptions, type ConsoleClient, type ConsoleTransportOptions } from "../console-client.js";
import { connect, DEFAULT_MODEL_HELP, defaultScanDeps, defaultScanModel, waitForThread, type ScanDeps } from "./scan.js";
import { finishWithError, UsageError } from "./output.js";
import { asJson, finishedThread, usageLine } from "./thread-output.js";

const exec = promisify(execFile);
const DEFAULT_BUDGET_USD = 3;
const DEFAULT_TIMEOUT_SECONDS = 1800;
export const THREAT_MODEL_BRANCH = "0/threat-model";
export const REQUIRED_HEADINGS = ["Summary", "What matters most", "Assets", "Actors", "Trust boundaries", "Entry points", "Authorization and business rules", "Data flows", "Open questions"];

export interface ThreatModelDeps extends Pick<ScanDeps, "open" | "err" | "sleep" | "startConsole"> {
  out(text: string): void;
  git(cwd: string, args: string[]): Promise<string>;
  gh(cwd: string, args: string[]): Promise<string>;
  makeTemp(): string;
  removeTemp(path: string): void;
  writeFile(path: string, text: string): void;
  readFile(path: string): string | undefined;
}

export const defaultThreatModelDeps: ThreatModelDeps = {
  open: defaultScanDeps.open, err: defaultScanDeps.err, sleep: defaultScanDeps.sleep, startConsole: defaultScanDeps.startConsole,
  out: text => process.stdout.write(`${text}\n`),
  async git(cwd, args) { return (await exec("git", ["-C", cwd, ...args], { maxBuffer: 32 * 1024 * 1024 })).stdout; },
  async gh(cwd, args) { return (await exec("gh", args, { cwd, maxBuffer: 32 * 1024 * 1024 })).stdout; },
  makeTemp: () => mkdtempSync(join(tmpdir(), "0-threat-model-")),
  removeTemp: path => rmSync(path, { recursive: true, force: true }),
  writeFile: (path, text) => writeFileSync(path, text, { mode: 0o600 }),
  readFile: path => { try { return readFileSync(path, "utf8"); } catch { return undefined; } },
};

export interface ThreatModelOptions extends ConsoleTransportOptions {
  base?: string; budget: string; model?: string; timeout: string; pr?: boolean; format?: string;
}

export interface ThreatModelOutcome {
  file: string; written: boolean; changed: boolean; problems: string[]; humanSectionsKept?: boolean;
  branch?: string; pullRequest?: { url: string; created: boolean }; threadId?: string; costUsd?: number; budgetExhausted?: boolean; timedOut?: boolean; summary?: string;
}

/** What is wrong with a threat-model file the thread wrote, in words a person can act on. Empty when it is fine. */
export function checkThreatModel(text: string | undefined): string[] {
  if (text === undefined) return [`${THREAT_MODEL_PATH} was not written.`];
  const problems: string[] = [];
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!front) problems.push("it has no front matter");
  else for (const key of ["generated", "commit"]) if (!new RegExp(`^${key}:\\s*\\S`, "m").test(front[1]!)) problems.push(`the front matter has no ${key}`);
  const missing = REQUIRED_HEADINGS.filter(heading => !new RegExp(`^##\\s+${heading.replace(/ /g, "\\s+")}\\s*$`, "mi").test(text));
  if (missing.length) problems.push(`missing sections: ${missing.join(", ")}`);
  return problems;
}

/** The human-marked blocks of a file: the lines after each `<!-- human -->` marker, up to the next heading or end marker. */
export function humanBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] | undefined;
  for (const line of text.split("\n")) {
    if (/<!--\s*human\s*-->/.test(line)) { if (current) blocks.push(current.join("\n").trim()); current = []; continue; }
    if (current && (/<!--\s*\/human\s*-->/.test(line) || /^#{1,6}\s/.test(line))) { blocks.push(current.join("\n").trim()); current = undefined; continue; }
    current?.push(line);
  }
  if (current) blocks.push(current.join("\n").trim());
  return blocks.filter(Boolean);
}

/** Text from a model goes into a pull request body: stop it from notifying people or referencing other issues. */
const inert = (text: string): string => text.replace(/@/g, "@​").replace(/(^|\s)#(\d)/g, "$1#​$2");

export function pullRequestBody(summary: string | undefined, problems: string[], humanKept: boolean | undefined): string {
  return [
    `A drafted threat model for this repository: \`${THREAT_MODEL_PATH}\`.`,
    "",
    "It was written by a model from what the code shows, so it can be wrong or incomplete. Review it like any document: correct it, answer the items marked `unknown: confirm with the team` (listed under Open questions), and mark any section you wrote or approved with `<!-- human -->` so later runs keep it unchanged.",
    "",
    "Once merged, scans use it as context: `0 scan . --context .0/threat-model.md`. In CI read it from the base branch, not from the pull request head, so a change under review cannot edit the rules it is checked against.",
    ...(problems.length ? ["", `Checks 0 ran on the file found problems: ${inert(problems.join("; "))}.`] : []),
    ...(humanKept === undefined ? [] : ["", humanKept ? "Sections marked human from the earlier file were kept unchanged." : "Warning: a section marked human in the earlier file differs from the new one. Compare them in the diff before merging."]),
    "",
    "### What the model reports",
    "",
    inert((summary ?? "").slice(0, 4000)) || "No summary.",
    "",
    "0 does not merge this; a person should.",
  ].join("\n");
}

async function defaultBase(deps: ThreatModelDeps, repo: string, requested?: string): Promise<{ ref: string; name: string }> {
  if (requested) return { ref: requested, name: requested.replace(/^origin\//, "") };
  try {
    const head = (await deps.git(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).trim();
    if (head) return { ref: head, name: head.replace(/^origin\//, "") };
  } catch { /* no remote HEAD */ }
  const current = (await deps.git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  return { ref: "HEAD", name: current === "HEAD" ? "main" : current };
}

async function runThread(client: ConsoleClient, deps: ThreatModelDeps, folder: string, label: string, exists: boolean, options: ThreatModelOptions, budget: number) {
  const created = asJson(asJson(await client.request("POST", "/api/console/sessions", { runtime: { model: options.model ?? defaultScanModel() }, title: `Threat model ${label}`.slice(0, 120), costCeilingUsd: budget })).session);
  const id = String(created.id);
  const path = `/api/console/sessions/${encodeURIComponent(id)}`;
  await client.request("PATCH", `${path}/configuration`, { workspacePath: folder });
  await client.request("POST", `${path}/messages`, { text: threatModelPrompt(label, { exists }) });
  deps.err(`drafting the threat model in thread ${id} (budget $${Number(budget.toFixed(4))})`);
  const { snapshot, timedOut } = await waitForThread(client, deps, id, Date.now() + Number(options.timeout) * 1000);
  const done = finishedThread(snapshot);
  const costUsd = typeof done.usage.costUsd === "number" ? done.usage.costUsd : undefined;
  return { id, reply: done.reply, error: done.error, failed: done.failed && !timedOut, timedOut, budgetExhausted: asJson(done.session).costCeilingExceeded === true, usage: usageLine(done.usage), ...(costUsd !== undefined ? { costUsd } : {}) };
}

export async function runThreatModel(folderArg: string | undefined, options: ThreatModelOptions, deps: ThreatModelDeps = defaultThreatModelDeps): Promise<ThreatModelOutcome> {
  let stopConsole: (() => void) | undefined;
  let temp: string | undefined;
  let repo = "";
  let tree = "";
  let madeBranch: { branch: string; existed: boolean } | undefined;
  let committed = false;
  try {
    const budget = Number(options.budget);
    if (!Number.isFinite(budget) || budget <= 0) throw new UsageError("--budget must be a positive number of USD.");
    if (!Number.isFinite(Number(options.timeout)) || Number(options.timeout) <= 0) throw new UsageError("--timeout must be a positive number of seconds.");
    if (options.computer || options.engineUrl) throw new UsageError("0 threat-model writes a file on this machine; run it against the local console.");
    const folder = resolve(folderArg ?? ".");
    if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new UsageError(`${folderArg ?? "."} is not a folder.`);
    const rel = THREAT_MODEL_PATH;
    let workFolder = folder;
    let fileRel = rel;
    let base: { ref: string; name: string } | undefined;
    let startRef = "";

    if (options.pr) {
      try { repo = (await deps.git(folder, ["rev-parse", "--show-toplevel"])).trim(); }
      catch { throw new UsageError("--pr needs a folder inside a git repository."); }
      const sub = relative(repo, folder);
      fileRel = sub ? join(sub, rel) : rel;
      base = await defaultBase(deps, repo, options.base);
      if (THREAT_MODEL_BRANCH === base.name) throw new Error("Refusing to work on the base branch.");
      // Pick up reviewers' commits already on the branch, so running again adds to the pull request instead of replacing it.
      await deps.git(repo, ["fetch", "--quiet", "origin", THREAT_MODEL_BRANCH]).catch(() => undefined);
      const remoteExists = await deps.git(repo, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${THREAT_MODEL_BRANCH}`]).then(() => true, () => false);
      startRef = remoteExists ? `origin/${THREAT_MODEL_BRANCH}` : base.ref;
      temp = deps.makeTemp();
      tree = join(temp, "tree");
      const existed = await deps.git(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${THREAT_MODEL_BRANCH}`]).then(() => true, () => false);
      await deps.git(repo, ["worktree", "add", "--quiet", "-B", THREAT_MODEL_BRANCH, tree, startRef]);
      madeBranch = { branch: THREAT_MODEL_BRANCH, existed };
      workFolder = sub ? join(tree, sub) : tree;
      deps.err(`drafting on branch ${THREAT_MODEL_BRANCH} (isolated work tree, base ${base.name})`);
    }

    const target = join(workFolder, rel);
    const before = deps.readFile(target);
    // Without --pr the thread edits the folder itself, so remember what was already changed there.
    const dirtyBefore = !options.pr ? await deps.git(workFolder, ["status", "--porcelain", "--untracked-files=all"]).catch(() => undefined) : undefined;
    if (!options.pr) mkdirSync(dirname(target), { recursive: true });

    const { client, stop } = await connect(options, deps);
    stopConsole = stop;
    const thread = await runThread(client, deps, workFolder, folder, before !== undefined, options, budget);
    const text = deps.readFile(target);
    const problems = checkThreatModel(text);
    const humanKept = before !== undefined ? humanBlocks(before).every(block => text !== undefined && text.includes(block)) : undefined;
    const common = { file: options.pr ? fileRel : target, written: text !== undefined, problems, ...(humanKept === undefined ? {} : { humanSectionsKept: humanKept }), threadId: thread.id, ...(thread.costUsd !== undefined ? { costUsd: thread.costUsd } : {}), ...(thread.budgetExhausted ? { budgetExhausted: true } : {}), ...(thread.timedOut ? { timedOut: true } : {}), ...(thread.reply ? { summary: thread.reply } : {}) };
    if (humanKept === false) problems.push("a section marked <!-- human --> was changed; compare with the earlier file before keeping this one");

    if (!options.pr) {
      const dirtyAfter = await deps.git(workFolder, ["status", "--porcelain", "--untracked-files=all"]).catch(() => undefined);
      if (dirtyBefore !== undefined && dirtyAfter !== undefined) {
        const before = new Set(dirtyBefore.split("\n"));
        const others = dirtyAfter.split("\n").filter(line => line && !before.has(line) && !line.endsWith(rel));
        if (others.length) problems.push(`the thread also changed ${others.length} other file${others.length === 1 ? "" : "s"}: ${others.slice(0, 5).map(line => line.slice(3)).join(", ")}; review and revert them`);
      }
      return { ...common, changed: text !== undefined && text !== before };
    }

    const status = (await deps.git(tree, ["status", "--porcelain", "--untracked-files=all"])).trim();
    const others = status.split("\n").filter(line => line && !line.endsWith(fileRel));
    if (others.length) problems.push(`the thread also changed ${others.length} other file${others.length === 1 ? "" : "s"}; they were left out of the commit`);
    if (text === undefined || problems.some(problem => problem.startsWith("it has no front matter") || problem.startsWith("missing sections"))) {
      deps.err(`not opening a pull request: ${problems.join("; ")}`);
      return { ...common, changed: false };
    }
    await deps.git(tree, ["add", "--", fileRel]);
    const unchanged = await deps.git(tree, ["diff", "--cached", "--quiet"]).then(() => true, () => false);
    if (unchanged) { deps.err("the threat model is unchanged; no pull request was opened."); return { ...common, changed: false, branch: THREAT_MODEL_BRANCH }; }
    // A clean machine or an Actions runner has no git identity; use a neutral one rather than fail the commit.
    const configured = (await deps.git(tree, ["config", "user.email"]).catch(() => "")).trim();
    const identity = configured ? [] : ["-c", "user.name=0", "-c", "user.email=noreply@0.security"];
    await deps.git(tree, [...identity, "commit", "--quiet", "-m", `docs: ${before === undefined ? "draft" : "update"} the threat model\n\nWritten by 0 threat-model for review.`]);
    committed = true;
    await deps.git(tree, ["push", "--set-upstream", "origin", `${THREAT_MODEL_BRANCH}:${THREAT_MODEL_BRANCH}`]);
    const bodyFile = join(temp!, "body.md");
    deps.writeFile(bodyFile, pullRequestBody(thread.reply, problems, humanKept));
    const existing = JSON.parse((await deps.gh(tree, ["pr", "list", "--head", THREAT_MODEL_BRANCH, "--state", "open", "--json", "number,url"])) || "[]") as Array<{ number: number; url: string }>;
    let url: string; let created = false;
    if (existing[0]) { url = existing[0].url; await deps.gh(tree, ["pr", "edit", String(existing[0].number), "--body-file", bodyFile]); }
    else { created = true; url = (await deps.gh(tree, ["pr", "create", "--base", base!.name, "--head", THREAT_MODEL_BRANCH, "--title", `docs: ${before === undefined ? "draft" : "update"} the threat model (review needed)`, "--body-file", bodyFile])).trim().split("\n").pop() ?? ""; }
    return { ...common, changed: true, branch: THREAT_MODEL_BRANCH, pullRequest: { url, created } };
  } finally {
    stopConsole?.();
    if (tree && repo) await deps.git(repo, ["worktree", "remove", "--force", tree]).catch(() => undefined);
    if (madeBranch && !madeBranch.existed && !committed) await deps.git(repo, ["branch", "-D", madeBranch.branch]).catch(() => undefined);
    if (temp) deps.removeTemp(temp);
  }
}

export function registerThreatModelCommand(program: Command, deps: ThreatModelDeps = defaultThreatModelDeps): void {
  consoleTransportOptions(program.command("threat-model [folder]")
    .description("Draft the repository's threat model as a file for people to review (optionally as a pull request)")
    .option("--pr", "Commit the file on the branch 0/threat-model in a separate git work tree and open or update a pull request")
    .option("--base <branch>", "With --pr: the branch to start from and open the pull request against (default: the remote's default branch)")
    .option("--format <format>", "json prints the outcome as JSON")
    .option("--budget <usd>", "Stop when the estimated spend reaches this many USD", String(DEFAULT_BUDGET_USD))
    .option("--model <model>", `Model for the thread (${DEFAULT_MODEL_HELP})`)
    .option("--timeout <seconds>", "Maximum seconds to wait", String(DEFAULT_TIMEOUT_SECONDS)))
    .addHelpText("after", "\nSections you mark with <!-- human --> are kept unchanged when the file is updated. Later scans take the file with `0 scan --context .0/threat-model.md`.\nExit codes: 0 file written and well formed, 1 not written or malformed, 2 usage error, 3 stopped at the budget or time limit.")
    .action(async (folder: string | undefined, options: ThreatModelOptions) => {
      try {
        const outcome = await runThreatModel(folder, options, deps);
        if (options.format === "json") deps.out(JSON.stringify(outcome, null, 2));
        else {
          if (outcome.pullRequest) deps.out(`${outcome.pullRequest.created ? "Opened" : "Updated"} pull request: ${outcome.pullRequest.url}`);
          else if (outcome.written) deps.out(`Wrote ${outcome.file}${outcome.changed ? "" : " (unchanged)"}. Review it, then commit it.`);
          else deps.out("No threat model was written.");
          for (const problem of outcome.problems) deps.err(`warning: ${problem}`);
        }
        process.exitCode = outcome.budgetExhausted || outcome.timedOut ? 3 : outcome.written && outcome.problems.length === 0 ? 0 : 1;
      } catch (error) { finishWithError(error, { err: deps.err }, options.format === "json"); }
    });
}
