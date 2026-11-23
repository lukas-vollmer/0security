import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maybeLoadClaudeCode } from "./claude-code-auth.js";
import { DEFAULT_SCAN_MODEL, defaultScanModel } from "./commands/scan.js";

let root: string;
let bin: string;

function install(directory: string): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "claude");
  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  chmodSync(path, 0o755);
  return path;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "0-claude-code-auth-"));
  bin = join(root, "bin");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("maybeLoadClaudeCode", () => {
  it("records an installed Claude Code so the engine detects the subscription", () => {
    const claude = install(bin);
    const env: Record<string, string | undefined> = { PATH: `/nonexistent:${bin}` };
    maybeLoadClaudeCode({ env });
    expect(env["ZERO_CLAUDE_CODE_PATH"]).toBe(claude);
  });

  it("leaves the environment alone without Claude Code, and ignores a non-executable file", () => {
    mkdirSync(bin);
    writeFileSync(join(bin, "claude"), "not executable");
    chmodSync(join(bin, "claude"), 0o644);
    const env: Record<string, string | undefined> = { PATH: bin };
    maybeLoadClaudeCode({ env });
    expect(env["ZERO_CLAUDE_CODE_PATH"]).toBeUndefined();
  });

  it("keeps an operator's explicit path", () => {
    install(bin);
    const env: Record<string, string | undefined> = { PATH: bin, ZERO_CLAUDE_CODE_PATH: "/opt/claude/bin/claude" };
    maybeLoadClaudeCode({ env });
    expect(env["ZERO_CLAUDE_CODE_PATH"]).toBe("/opt/claude/bin/claude");
  });

  it("follows a moved or removed install it detected, and honours ZERO_CLAUDE_CODE=0", () => {
    install(bin);
    const env: Record<string, string | undefined> = { PATH: bin };
    maybeLoadClaudeCode({ env });
    const moved = install(join(root, "other"));
    rmSync(bin, { recursive: true });
    env["PATH"] = join(root, "other");
    maybeLoadClaudeCode({ env });
    expect(env["ZERO_CLAUDE_CODE_PATH"]).toBe(moved);
    env["ZERO_CLAUDE_CODE"] = "0";
    maybeLoadClaudeCode({ env });
    expect(env["ZERO_CLAUDE_CODE_PATH"]).toBeUndefined();
  });
});

describe("defaultScanModel", () => {
  it("runs on the Claude subscription when Claude Code is detected or pinned", () => {
    const claude = install(bin);
    expect(defaultScanModel({ ZERO_CLAUDE_CODE_PATH: claude })).toBe("claude-opus-5-5");
    expect(defaultScanModel({ ZERO_SELECTED_PROVIDER: "claude-code" })).toBe("claude-opus-5-5");
  });

  it("keeps the measured default otherwise", () => {
    const claude = install(bin);
    expect(defaultScanModel({})).toBe(DEFAULT_SCAN_MODEL);
    expect(defaultScanModel({ ZERO_CLAUDE_CODE_PATH: claude, ZERO_CLAUDE_CODE: "0" })).toBe(DEFAULT_SCAN_MODEL);
    expect(defaultScanModel({ ZERO_CLAUDE_CODE_PATH: claude, ZERO_SELECTED_PROVIDER: "openai" })).toBe(DEFAULT_SCAN_MODEL);
  });
});
