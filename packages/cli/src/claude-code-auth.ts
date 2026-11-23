import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

// Values this module placed into a given environment object, so a later call
// can follow a moved install without ever overriding an operator's own export.
const detected = new WeakMap<Record<string, string | undefined>, string>();

/**
 * Make the operator's Claude subscription an auto-detected provider: when
 * Claude Code is installed (`claude` on PATH), record its path in
 * `ZERO_CLAUDE_CODE_PATH`, which the engine's provider detection reads.
 *
 * Nothing about the login is read here (Claude Code keeps it in the OS
 * keychain or its own config folder, and 0 never touches it); a signed-out
 * Claude Code is reported by the first run and by Connections.
 *
 * An explicit `ZERO_CLAUDE_CODE_PATH` export is kept as is.
 * `ZERO_CLAUDE_CODE=0` (or false/off/no) turns detection off.
 *
 * Like `codex-auth.ts`, this runs at startup for every command, so it depends
 * on Node only, never on the engine. Keep the PATH search in step with
 * `findClaudeOnPath` in packages/engine/src/runtime/claude-code-config.ts.
 */
export function maybeLoadClaudeCode(options: { env?: Record<string, string | undefined> } = {}): void {
  const env = options.env ?? process.env;
  const prior = detected.get(env);
  const ours = prior !== undefined && env["ZERO_CLAUDE_CODE_PATH"] === prior;
  if (/^(?:0|false|off|no)$/i.test(env["ZERO_CLAUDE_CODE"]?.trim() ?? "")) {
    if (ours) delete env["ZERO_CLAUDE_CODE_PATH"];
    detected.delete(env);
    return;
  }
  if (env["ZERO_CLAUDE_CODE_PATH"]?.trim() && !ours) return;
  const path = findClaude(env);
  if (path) {
    env["ZERO_CLAUDE_CODE_PATH"] = path;
    detected.set(env, path);
  } else if (ours) {
    delete env["ZERO_CLAUDE_CODE_PATH"];
    detected.delete(env);
  }
}

function findClaude(env: Record<string, string | undefined>): string | undefined {
  const extensions = process.platform === "win32"
    ? [".exe", ...(env["PATHEXT"] ?? ".EXE;.CMD;.BAT").split(";").map(ext => ext.toLowerCase()).filter(ext => ext && ext !== ".exe")]
    : [""];
  for (const directory of (env["PATH"] ?? env["Path"] ?? "").split(delimiter)) {
    if (!directory || !isAbsolute(directory)) continue;
    for (const extension of extensions) {
      const candidate = join(directory, `claude${extension}`);
      try {
        if (!statSync(candidate).isFile()) continue;
        if (process.platform !== "win32") accessSync(candidate, constants.X_OK);
        return candidate;
      } catch { /* not here */ }
    }
  }
  return undefined;
}
