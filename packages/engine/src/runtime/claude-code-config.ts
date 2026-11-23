/**
 * Static configuration for the Claude subscription provider (`claude-code`).
 *
 * Kept free of runtime imports so provider detection can read it without a
 * cycle; the runtime itself lives in `claude-code.ts`.
 */
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

export const CLAUDE_CODE_PROVIDER = "claude-code" as const;
export const CLAUDE_CODE_LABEL = "Claude subscription";
/** Not an HTTP endpoint: requests go through the local Claude Code CLI. */
export const CLAUDE_CODE_BASE_URL = "claude-code://local";

export interface ClaudeCodeModel {
  id: string;
  label: string;
  /** Claude Code `--model` alias that names the same model. */
  alias: string;
  contextTokens: number;
}

/**
 * Models a Claude subscription reaches through Claude Code. Ids are the
 * first-party API ids, which `claude --model` accepts; the aliases resolve to
 * the same models today. Context windows are the published 1M windows.
 */
export const CLAUDE_CODE_MODELS: readonly ClaudeCodeModel[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", alias: "opus", contextTokens: 1_000_000 },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", alias: "sonnet", contextTokens: 1_000_000 },
  { id: "claude-fable-5-2", label: "Claude Fable 5.2", alias: "fable", contextTokens: 1_000_000 },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", alias: "haiku", contextTokens: 1_000_000 },
];

export const CLAUDE_CODE_DEFAULT_MODEL = "claude-opus-5-5";

/** `claude --effort` levels. Every model above accepts all five. */
export const CLAUDE_CODE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
/** Security review is intelligence-sensitive work; `high` is the floor Anthropic recommends for it. */
export const CLAUDE_CODE_DEFAULT_EFFORT = "high";

/**
 * Canonical id for a model routed to Claude Code: strips the `claude-code/`
 * and `anthropic/` routing prefixes, maps Claude Code aliases to their ids and
 * OpenRouter's dotted versions (`claude-sonnet-5.5`) to the hyphenated API id.
 */
export function claudeCodeModelId(model: string): string {
  let id = model.trim().replace(/^claude-code\//i, "").replace(/^anthropic\//i, "");
  const alias = CLAUDE_CODE_MODELS.find(entry => entry.alias === id.toLowerCase());
  if (alias) return alias.id;
  if (/^claude-[a-z]+-\d+\.\d+$/i.test(id)) id = id.replace(/\.(\d+)$/, "-$1");
  return id;
}

/** Whether a model id names a Claude model Claude Code can serve. */
export function isClaudeCodeModel(model: string): boolean {
  return /^claude-[a-z]/i.test(claudeCodeModelId(model));
}

export function claudeCodeModel(model: string): ClaudeCodeModel | undefined {
  const id = claudeCodeModelId(model);
  return CLAUDE_CODE_MODELS.find(entry => entry.id === id);
}

/** `ZERO_CLAUDE_CODE=0` (or false/off/no) turns the provider off, including auto-detection. */
export function claudeCodeDisabled(env: Readonly<NodeJS.ProcessEnv>): boolean {
  return /^(?:0|false|off|no)$/i.test(env["ZERO_CLAUDE_CODE"]?.trim() ?? "");
}

/**
 * The Claude Code executable for this environment.
 *
 * `ZERO_CLAUDE_CODE_PATH` names it explicitly; the CLI sets it at startup when
 * `claude` is on PATH, which is what makes the subscription an auto-detected
 * provider. `searchPath` additionally looks on PATH, for an explicitly
 * selected provider. Never spawns anything.
 */
export function resolveClaudeCodeExecutable(env: Readonly<NodeJS.ProcessEnv>, options: { searchPath?: boolean } = {}): string | undefined {
  if (claudeCodeDisabled(env)) return undefined;
  const explicit = env["ZERO_CLAUDE_CODE_PATH"]?.trim();
  if (explicit) return isAbsolute(explicit) && isExecutableFile(explicit) ? explicit : undefined;
  return options.searchPath ? findClaudeOnPath(env) : undefined;
}

/** Auto-detection signal: an explicit or startup-detected executable, without a PATH search. */
export function claudeCodeConfigured(env: Readonly<NodeJS.ProcessEnv>): boolean {
  return resolveClaudeCodeExecutable(env) !== undefined;
}

export function findClaudeOnPath(env: Readonly<NodeJS.ProcessEnv>): string | undefined {
  const path = env["PATH"] ?? env["Path"] ?? "";
  const extensions = process.platform === "win32"
    ? [".exe", ...(env["PATHEXT"] ?? ".EXE;.CMD;.BAT").split(";").map(ext => ext.toLowerCase()).filter(ext => ext && ext !== ".exe")]
    : [""];
  for (const directory of path.split(delimiter)) {
    if (!directory || !isAbsolute(directory)) continue;
    for (const extension of extensions) {
      const candidate = join(directory, `claude${extension}`);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return undefined;
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (process.platform !== "win32") accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
