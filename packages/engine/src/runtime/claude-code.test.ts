import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock child_process.spawn before importing the modules under test so both the
// Claude Code runtime and the CLI adapter it drives pick up the mock.
const spawnMock = vi.fn();
vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { ClaudeCodeRuntime, CLAUDE_CODE_TURN_TIMEOUT_MS, __resetClaudeCodeSupportForTests, claudeCodeChildEnv, claudeCodeWorkdir } from "./claude-code.js";
import { CLAUDE_CODE_DEFAULT_MODEL, claudeCodeModelId, isClaudeCodeModel, resolveClaudeCodeExecutable } from "./claude-code-config.js";
import { renderConversationHistory } from "./cli-native.js";
import { ApiRuntime, createNativeApiRuntime, selectRuntimeKind } from "./native-api.js";
import { detectProvider, providerForModel } from "./llm-api/provider-detect.js";
import type { NativeMessage } from "./types.js";

const HELP = [
  "Usage: claude [options] [command] [prompt]",
  "  -p, --print  --output-format <format>  --verbose  --model <model>  -r, --resume [value]",
  "  --system-prompt <prompt>  --mcp-config <configs...>  --strict-mcp-config  --tools <tools...>",
  "  --allowedTools, --allowed-tools <tools...>  --permission-mode <mode>  --setting-sources <sources>",
  "  --disable-slash-commands  --effort <level>",
].join("\n");

let home: string;
let claudePath: string;

/** A spawned process stand-in: replays stdout lines, records stdin, closes with `exitCode`. */
function fakeProcess(opts: { stdout?: string[]; stdoutText?: string; exitCode?: number }) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter; stderr: EventEmitter; stdin: { written: string; end(data?: string): void; on(): void };
    kill: (signal?: string) => void; pid?: number;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { written: "", end(data?: string) { this.written += data ?? ""; }, on() {} };
  child.kill = vi.fn();
  Promise.resolve().then(() => {
    if (opts.stdoutText) child.stdout.emit("data", Buffer.from(opts.stdoutText));
    for (const line of opts.stdout ?? []) child.stdout.emit("data", Buffer.from(`${line}\n`));
    child.emit("close", opts.exitCode ?? 0);
  });
  return child;
}

/** Answers `--help` with a modern flag list and every model run with `runs.shift()`. */
function installClaude(runs: Array<Parameters<typeof fakeProcess>[0]>): Array<ReturnType<typeof fakeProcess>> {
  const children: Array<ReturnType<typeof fakeProcess>> = [];
  spawnMock.mockImplementation((_command: string, args: string[]) => {
    if (args[0] === "--help") return fakeProcess({ stdoutText: HELP });
    const child = fakeProcess(runs.shift() ?? { stdout: [JSON.stringify({ type: "result", subtype: "success", stop_reason: "end_turn" })] });
    children.push(child);
    return child;
  });
  return children;
}

function env(extra: Record<string, string> = {}): Record<string, string> {
  return { HOME: home, PATH: "/usr/bin:/bin", ZERO_CLAUDE_CODE_PATH: claudePath, ...extra };
}

function runtime(extra: Record<string, string> = {}, model?: string): ClaudeCodeRuntime {
  return new ClaudeCodeRuntime({ type: "api", timeout: 120_000, provider: "claude-code", env: env(extra), ...(model ? { model } : {}) });
}

const answer = (text: string, sessionId = "session-1") => [
  JSON.stringify({ type: "system", subtype: "init", session_id: sessionId }),
  JSON.stringify({ type: "assistant", session_id: sessionId, message: { id: "m1", model: "claude-opus-5-5", content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 2 } } }),
  JSON.stringify({ type: "result", subtype: "success", stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 2 } }),
];

const user = (text: string): NativeMessage => ({ role: "user", content: [{ type: "text", text }] });

beforeEach(() => {
  spawnMock.mockReset();
  __resetClaudeCodeSupportForTests();
  home = mkdtempSync(join(tmpdir(), "0-claude-code-test-"));
  claudePath = join(home, "bin", "claude");
  mkdirSync(join(home, "bin"));
  writeFileSync(claudePath, "#!/bin/sh\nexit 0\n");
  chmodSync(claudePath, 0o755);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("Claude Code model ids", () => {
  it("normalizes routing prefixes, aliases and dotted versions", () => {
    expect(claudeCodeModelId("claude-code/claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
    expect(claudeCodeModelId("anthropic/claude-sonnet-5.5")).toBe("claude-sonnet-5-5");
    expect(claudeCodeModelId("opus")).toBe("claude-opus-5-5");
    expect(claudeCodeModelId("claude-fable-5-2")).toBe("claude-fable-5-2");
    expect(isClaudeCodeModel("haiku")).toBe(true);
    expect(isClaudeCodeModel("gpt-6-luna")).toBe(false);
  });
});

describe("Claude Code detection", () => {
  it("finds an explicit executable, refuses a bad one, and honours ZERO_CLAUDE_CODE=0", () => {
    expect(resolveClaudeCodeExecutable(env())).toBe(claudePath);
    expect(resolveClaudeCodeExecutable(env({ ZERO_CLAUDE_CODE_PATH: join(home, "missing") }))).toBeUndefined();
    expect(resolveClaudeCodeExecutable(env({ ZERO_CLAUDE_CODE_PATH: "relative/claude" }))).toBeUndefined();
    expect(resolveClaudeCodeExecutable(env({ ZERO_CLAUDE_CODE: "0" }))).toBeUndefined();
  });

  it("searches PATH only when asked", () => {
    const pathOnly = { HOME: home, PATH: `/nonexistent:${join(home, "bin")}` };
    expect(resolveClaudeCodeExecutable(pathOnly)).toBeUndefined();
    expect(resolveClaudeCodeExecutable(pathOnly, { searchPath: true })).toBe(claudePath);
  });

  it("prefers the subscription for Claude models and as the first auto-detected provider", () => {
    expect(providerForModel("claude-opus-5-5", env({ ANTHROPIC_API_KEY: "sk-ant-x" }))).toBe("claude-code");
    expect(providerForModel("claude-opus-5-5", env({ ANTHROPIC_API_KEY: "sk-ant-x", ZERO_CLAUDE_CODE: "0" }))).toBe("anthropic");
    expect(providerForModel("gpt-6-luna", env({ ZERO_CHATGPT_ACCESS_TOKEN: "t" }))).toBe("chatgpt-codex");
    expect(detectProvider(undefined, undefined, env({ ZERO_CHATGPT_ACCESS_TOKEN: "t", OPENAI_API_KEY: "sk" })).provider).toBe("claude-code");
    expect(detectProvider(undefined, undefined, env()).defaultModel).toBe(CLAUDE_CODE_DEFAULT_MODEL);
    // Without the startup signal nothing changes for existing setups.
    expect(detectProvider(undefined, undefined, { HOME: home, OPENAI_API_KEY: "sk" }).provider).toBe("openai");
  });

  it("lets an explicit provider pin choose the subscription without the startup signal", () => {
    const detected = detectProvider(undefined, undefined, { HOME: home, ZERO_SELECTED_PROVIDER: "claude-code" });
    expect(detected).toMatchObject({ provider: "claude-code", defaultModel: CLAUDE_CODE_DEFAULT_MODEL });
    expect(() => detectProvider("sk-ant-x", undefined, { ZERO_SELECTED_PROVIDER: "claude-code" })).toThrow(/Claude Code login/);
  });

  it("routes the runtime factory to the Claude Code implementation", () => {
    expect(selectRuntimeKind({ type: "api", timeout: 1, provider: "claude-code" }, {})).toBe("claude-code");
    expect(selectRuntimeKind({ type: "api", timeout: 1, env: env() }, {})).toBe("claude-code");
    expect(selectRuntimeKind({ type: "api", timeout: 1, env: env({ ZERO_CLAUDE_CODE: "0", ANTHROPIC_API_KEY: "sk-ant-x" }) }, {})).not.toBe("claude-code");
    expect(selectRuntimeKind({ type: "api", timeout: 1, provider: "anthropic", env: env({ ANTHROPIC_API_KEY: "sk-ant-x" }) }, {})).not.toBe("claude-code");

    const facade = createNativeApiRuntime({ type: "api", timeout: 1_000, env: env() });
    expect(facade).toBeInstanceOf(ApiRuntime);
    expect(facade.implementation).toBe("claude-code");
    expect(facade.resolvedProvider()).toBe("claude-code");
    expect(facade.resolvedModel()).toBe(CLAUDE_CODE_DEFAULT_MODEL);
    expect(facade.resolvedPricingModel()).toBe(`anthropic/${CLAUDE_CODE_DEFAULT_MODEL}`);
    expect(facade.getConfigurationDiagnostics()).toMatchObject({ valid: true, provider: "claude-code" });
  });

  it("reports a missing Claude Code instead of failing at construction", () => {
    const missing = createNativeApiRuntime({ type: "api", timeout: 1_000, provider: "claude-code", model: "probe", env: { HOME: home, PATH: "/nonexistent" } });
    const diagnostics = missing.getConfigurationDiagnostics();
    expect(diagnostics.valid).toBe(false);
    expect(diagnostics.fatalError).toMatch(/Claude Code is not installed/);
    expect(missing.connectionIdentity()).toBeUndefined();
  });
});

describe("ClaudeCodeRuntime runs", () => {
  it("isolates the claude process: flags, working folder, environment and stdin prompt", async () => {
    const children = installClaude([{ stdout: answer("hello") }]);
    const rt = runtime({ ANTHROPIC_API_KEY: "sk-ant-secret", ANTHROPIC_BASE_URL: "https://proxy.invalid", ANTHROPIC_AUTH_TOKEN: "proxy-token",
      OPENAI_API_KEY: "sk-openai", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "parent", CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-subscription" });
    const result = await rt.executeNative("you are 0", [user("--looks like a flag")], []);

    expect(result.stopReason).toBe("end_turn");
    expect(result.content).toEqual([{ type: "text", text: "hello" }]);
    const run = spawnMock.mock.calls.find(call => (call[1] as string[])[0] === "-p")!;
    const [command, args, options] = run as [string, string[], { cwd: string; env: NodeJS.ProcessEnv }];
    expect(command).toBe(claudePath);
    expect(args.slice(0, 4)).toEqual(["-p", "--verbose", "--output-format", "stream-json"]);
    const flag = (name: string) => args[args.indexOf(name) + 1];
    expect(flag("--model")).toBe("claude-opus-5-5");
    expect(flag("--effort")).toBe("high");
    expect(flag("--setting-sources")).toBe("");
    expect(flag("--tools")).toBe("");
    expect(args).toContain("--disable-slash-commands");
    expect(args).toContain("--strict-mcp-config");
    expect(flag("--system-prompt")).toBe("you are 0");
    expect(args).not.toContain("--looks like a flag");
    expect(children[0]!.stdin.written).toBe("--looks like a flag");
    expect(options.cwd).toBe(claudeCodeWorkdir({ HOME: home }));
    expect(options.env).toMatchObject({ HOME: home, PATH: "/usr/bin:/bin", CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-subscription" });
    for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "ZERO_CLAUDE_CODE_PATH"]) {
      expect(options.env[name]).toBeUndefined();
    }
  });

  it("refuses a Claude Code without the isolation flags rather than running it unisolated", async () => {
    spawnMock.mockImplementation((_command: string, args: string[]) => fakeProcess(args[0] === "--help" ? { stdoutText: "Usage: claude -p --model --resume" } : { stdout: answer("never") }));
    const result = await runtime().executeNative("sys", [user("go")], []);
    expect(result.stopReason).toBe("error");
    expect(result.error).toMatch(/too old for 0.*--setting-sources/);
    expect(spawnMock.mock.calls.every(call => (call[1] as string[])[0] === "--help")).toBe(true);
  });

  it("replays earlier turns when no Claude Code session holds them", async () => {
    const children = installClaude([{ stdout: answer("continuing") }]);
    const messages: NativeMessage[] = [
      user("scan the repo"),
      { role: "assistant", content: [{ type: "text", text: "Reading the entry points." }, { type: "tool_use", id: "tu_1", name: "read_file", input: { path: "a.ts" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "export const a = 1;" }] },
      { role: "assistant", content: [{ type: "text", text: "Nothing yet." }] },
      user("keep going"),
    ];
    await runtime().executeNative("you are 0", messages, []);
    const prompt = children[0]!.stdin.written;
    expect(prompt.startsWith("[0:conversation_history]")).toBe(true);
    expect(prompt).toContain("### user\nscan the repo");
    expect(prompt).toContain('[tool call tu_1: read_file {"path":"a.ts"}]');
    expect(prompt).toContain("[tool result tu_1]\nexport const a = 1;");
    expect(prompt.trimEnd().endsWith("keep going")).toBe(true);
  });

  it("keeps a differently-prompted call (title, summary) out of the conversation's session", async () => {
    const children = installClaude([{ stdout: answer("title", "title-session") }, { stdout: answer("main", "main-session") }, { stdout: answer("main again", "main-session") }]);
    const rt = runtime();
    await rt.executeNative("write a title", [user("scan the repo")], []);
    await rt.executeNative("you are 0", [user("scan the repo")], []);
    await rt.executeNative("you are 0", [user("scan the repo"), { role: "assistant", content: [{ type: "text", text: "main" }] }, user("more")], []);
    const argsOf = (index: number) => spawnMock.mock.calls.filter(call => (call[1] as string[])[0] === "-p")[index]![1] as string[];
    // The main conversation never resumes the title call's session; it replays instead.
    expect(argsOf(1)).not.toContain("--resume");
    expect(argsOf(2)).not.toContain("title-session");
    expect(children[2]!.stdin.written).toContain("[0:conversation_history]");
  });

  it("maps effort and model changes onto the next run", async () => {
    installClaude([{ stdout: answer("a") }]);
    const rt = runtime();
    expect(rt.reasoningConfiguration()).toEqual({ effort: "high", options: ["low", "medium", "high", "xhigh", "max"] });
    rt.setReasoningEffort("max");
    rt.reconfigure({ model: "sonnet" });
    expect(() => rt.setReasoningEffort("none")).toThrow();
    await rt.executeNative("sys", [user("go")], []);
    const args = spawnMock.mock.calls.find(call => (call[1] as string[])[0] === "-p")![1] as string[];
    expect(args[args.indexOf("--model") + 1]).toBe("claude-sonnet-5-5");
    expect(args[args.indexOf("--effort") + 1]).toBe("max");
    expect(rt.resolvedModel()).toBe("claude-sonnet-5-5");
  });

  it("gives Claude Code turns the long turn timeout", () => {
    expect(CLAUDE_CODE_TURN_TIMEOUT_MS).toBeGreaterThanOrEqual(10 * 60_000);
  });
});

describe("ClaudeCodeRuntime console surface", () => {
  it("approves subagent models like the API runtimes", async () => {
    const rt = new ClaudeCodeRuntime({ type: "api", timeout: 60_000, provider: "claude-code", env: env(), agentModels: { reviewer: "claude-haiku-5-5", scout: "auto" } });
    expect((await rt.forkForSubagent(30_000)).resolvedModel()).toBe("claude-opus-5-5");
    expect((await rt.forkForSubagent(30_000, { role: "reviewer" })).resolvedModel()).toBe("claude-haiku-5-5");
    expect((await rt.forkForSubagent(30_000, { role: "scout", model: "sonnet" })).resolvedModel()).toBe("claude-sonnet-5-5");
    await expect(rt.forkForSubagent(30_000, { role: "scout", model: "gpt-6-luna" })).rejects.toThrow(/not reachable/);
    await expect(rt.forkForSubagent(30_000, { model: "claude-fable-5-2" })).rejects.toThrow(/not operator-approved/);
    const single = new ClaudeCodeRuntime({ type: "api", timeout: 60_000, provider: "claude-code", env: env(), singleModel: true });
    expect((await single.forkForSubagent(30_000, { model: "claude-fable-5-2" })).resolvedModel()).toBe("claude-opus-5-5");
  });

  it("round-trips a worker binding without carrying 0's credentials", () => {
    // A host worker shares the host's HOME (host variables never cross the binding), so leave HOME unset on both sides.
    const hostEnv = { PATH: "/usr/bin:/bin", ZERO_CLAUDE_CODE_PATH: claudePath, OPENAI_API_KEY: "sk-openai", CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat" };
    const facade = createNativeApiRuntime({ type: "api", timeout: 60_000, provider: "claude-code", model: "claude-sonnet-5-5", env: hostEnv });
    facade.setReasoningEffort("xhigh");
    const binding = facade.exportPrivateWorkerBinding();
    expect(binding.runtimeKind).toBe("claude-code");
    expect(binding.env).toEqual({ ZERO_CLAUDE_CODE_PATH: claudePath, CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat" });
    expect(JSON.stringify(binding)).not.toContain("sk-openai");

    const worker = ApiRuntime.fromPrivateWorkerBinding(binding);
    expect(worker.implementation).toBe("claude-code");
    expect(worker.resolvedModel()).toBe("claude-sonnet-5-5");
    expect(worker.reasoningConfiguration()?.effort).toBe("xhigh");
    expect(worker.connectionIdentity()).toBe(facade.connectionIdentity());
    expect(() => facade.applyPrivateWorkerBinding(worker.exportPrivateWorkerBinding())).not.toThrow();
    expect(() => ApiRuntime.fromPrivateWorkerBinding({ ...binding, identity: "forged" })).toThrow(/identity/);
  });

  it("switches between the subscription and an API provider through the facade", () => {
    const facade = createNativeApiRuntime({ type: "api", timeout: 60_000, env: env({ ANTHROPIC_API_KEY: "sk-ant-x" }) });
    expect(facade.implementation).toBe("claude-code");
    facade.reconfigure({ provider: "anthropic", model: "claude-sonnet-5-5" });
    expect(facade.implementation).not.toBe("claude-code");
    expect(facade.resolvedProvider()).toBe("anthropic");
    facade.reconfigure({ provider: "claude-code", model: "opus" });
    expect(facade.implementation).toBe("claude-code");
    expect(facade.resolvedModel()).toBe("claude-opus-5-5");
  });

  it("lists the subscription's models and refuses OpenAI-only features", async () => {
    const rt = runtime();
    expect((await rt.availableModelCatalog()).map(model => model.id)).toEqual(["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-2", "claude-haiku-5-5"]);
    expect(rt.publishedContextWindowTokens()).toBe(1_000_000);
    expect(() => rt.setCyberAccessProgram("standard")).toThrow(/Cyber access program/);
    expect(() => rt.setCyberAccessProgram(null)).not.toThrow();
    await expect(rt.codexModelCatalog()).rejects.toThrow(/Codex/);
  });

  it("allowlists the child environment", () => {
    expect(claudeCodeChildEnv({ HOME: "/h", PATH: "/p", LC_ALL: "C", HTTPS_PROXY: "http://proxy", ANTHROPIC_API_KEY: "x", GITHUB_TOKEN: "y", ZERO_CHATGPT_ACCESS_TOKEN: "z" }))
      .toEqual({ HOME: "/h", PATH: "/p", LC_ALL: "C", HTTPS_PROXY: "http://proxy" });
  });
});

describe("renderConversationHistory", () => {
  it("returns nothing for an empty history", () => {
    expect(renderConversationHistory([])).toBe("");
  });

  it("marks tool errors and omitted images", () => {
    const text = renderConversationHistory([
      { role: "user", content: [{ type: "image", mediaType: "image/png", data: "AAAA", name: "shot.png" }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "denied", is_error: true }] },
    ]);
    expect(text).toContain("[image shot.png omitted]");
    expect(text).toContain("[tool result t (error)]\ndenied");
  });
});
