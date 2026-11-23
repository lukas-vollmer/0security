/**
 * Claude subscription (Pro / Max) as a model provider, through the official
 * Claude Code CLI.
 *
 * Anthropic allows subscription credentials to be used only by Claude Code
 * itself, so 0 never reads, stores or sends the subscription's OAuth token.
 * Every model turn is a headless `claude -p` run that the operator's own
 * Claude Code login authenticates; {@link CliNativeRuntime} drives it and
 * exposes 0's tools to it through a loopback MCP bridge, so 0 still executes
 * every tool call (scope checks, evidence, finding state).
 *
 * Each run is isolated from the operator's personal Claude Code setup and
 * from the scanned code:
 *   - `--setting-sources ""` loads no user, project or local settings, so no
 *     hooks, plugins, permission rules or CLAUDE.md files apply;
 *   - `--disable-slash-commands` loads no skills or commands;
 *   - `--tools ""` and `--strict-mcp-config` (set by the bridge) leave only
 *     0's tools; Claude Code cannot read files or run commands itself;
 *   - `--system-prompt` replaces Claude Code's prompt with 0's;
 *   - the working directory is a private folder under `~/.0`, never the
 *     repository under review;
 *   - the child gets an allowlisted environment: no API keys, no other
 *     provider credentials, no `ANTHROPIC_*` overrides that would bill an API
 *     key or redirect the subscription token.
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { homeStateDir } from "../shared/paths.js";
import { CliNativeRuntime } from "./cli-native.js";
import {
  CLAUDE_CODE_BASE_URL, CLAUDE_CODE_DEFAULT_EFFORT, CLAUDE_CODE_DEFAULT_MODEL, CLAUDE_CODE_EFFORTS, CLAUDE_CODE_LABEL,
  CLAUDE_CODE_MODELS, CLAUDE_CODE_PROVIDER, claudeCodeModel, claudeCodeModelId, isClaudeCodeModel, resolveClaudeCodeExecutable,
} from "./claude-code-config.js";
import type { CodexCatalogModel } from "./codex-models.js";
import { parseCodexAzureConfig, type ApiProvider } from "./llm-api/provider-config.js";
import type { ApiRuntimeDiagnostics } from "./llm-api/provider-detect.js";
import type { PrivateWorkerRuntimeBinding } from "./llm-api/runtime.js";
import type { SiwcConnection } from "./siwc-connection.js";
import type {
  CyberAccessProgram, NativeMessage, NativeRuntime, NativeRuntimeResult, NativeStreamCallbacks, NativeToolDef,
  Runtime, RuntimeConfig, RuntimeContext, RuntimeResult, SubagentModelSelection,
} from "./types.js";

/**
 * Longest wait for Claude Code's next tool batch or answer. One turn can hold
 * a long thinking pass plus Claude Code's own rate-limit retries, so shorter
 * HTTP-request timeouts from the console do not apply here.
 */
export const CLAUDE_CODE_TURN_TIMEOUT_MS = 15 * 60_000;

const CYBER_UNAVAILABLE = "Cyber access programs are an OpenAI feature; the Claude subscription does not offer them.";

/** Flags 0 relies on for tool isolation; a Claude Code without them is refused rather than run unisolated. */
const REQUIRED_FLAGS = [
  "--print", "--output-format", "--verbose", "--model", "--resume", "--system-prompt", "--mcp-config",
  "--strict-mcp-config", "--tools", "--allowedTools", "--permission-mode", "--setting-sources", "--disable-slash-commands",
] as const;

/**
 * Host variables Claude Code needs to start, find its login and reach the
 * network. Everything else (API keys, other providers' tokens, `ANTHROPIC_*`
 * overrides, the parent's Claude Code session variables) stays out.
 */
const CHILD_ENV = /^(?:HOME|USER|LOGNAME|SHELL|PATH|Path|TMPDIR|TEMP|TMP|TZ|LANG|LANGUAGE|LC_[A-Z_]+|TERM|COLORTERM|NO_COLOR|XDG_[A-Z_]+|__CF_USER_TEXT_ENCODING|SystemRoot|SYSTEMROOT|windir|WINDIR|ComSpec|COMSPEC|PATHEXT|USERPROFILE|APPDATA|LOCALAPPDATA|ProgramData|PROGRAMDATA|ProgramFiles|PROGRAMFILES|HOMEDRIVE|HOMEPATH|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS|HTTPS?_PROXY|https?_proxy|NO_PROXY|no_proxy|ALL_PROXY|all_proxy|CLAUDE_CONFIG_DIR|CLAUDE_CODE_OAUTH_TOKEN|DISABLE_AUTOUPDATER|DISABLE_TELEMETRY|DISABLE_ERROR_REPORTING|CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC)$/;

/** Variables a host worker needs to rebuild the same connection. */
const BINDING_ENV = /^(?:CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CONFIG_DIR|ZERO_CLAUDE_CODE|ZERO_CLAUDE_CODE_PATH|ZERO_MODEL|ZERO_SELECTED_PROVIDER|ZERO_FORCE_PROVIDER)$/;

/** The environment a `claude` child runs with. Exported for unit testing. */
export function claudeCodeChildEnv(env: Readonly<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) if (value !== undefined && CHILD_ENV.test(name)) out[name] = value;
  return out;
}

/** Private working directory for Claude Code runs: no CLAUDE.md, no repository, no session list shared with the operator's projects. */
export function claudeCodeWorkdir(env: Readonly<NodeJS.ProcessEnv> = process.env): string {
  return join(homeStateDir(env["HOME"] || homedir()), "claude-code");
}

interface Support { flags: ReadonlySet<string>; error?: string }
const supportByExecutable = new Map<string, Promise<Support>>();

function run(executable: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ code: number | null; stdout: string; error?: string }> {
  return new Promise(resolve => {
    let stdout = "";
    let settled = false;
    const finish = (result: { code: number | null; stdout: string; error?: string }) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(executable, args, { env, cwd: env["HOME"] || homedir(), stdio: ["ignore", "pipe", "ignore"] });
    } catch (error) {
      finish({ code: null, stdout, error: error instanceof Error ? error.message : String(error) });
      return;
    }
    const timer = setTimeout(() => { child.kill(); finish({ code: null, stdout, error: "timed out" }); }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => { if (stdout.length < 1_000_000) stdout += chunk.toString("utf-8"); });
    child.on("error", error => finish({ code: null, stdout, error: error.message }));
    child.on("close", code => finish({ code, stdout }));
  });
}

/** Which flags the installed Claude Code accepts, read once per executable from `--help`. */
export function claudeCodeSupport(executable: string, env: Readonly<NodeJS.ProcessEnv>): Promise<Support> {
  let cached = supportByExecutable.get(executable);
  if (!cached) {
    cached = run(executable, ["--help"], claudeCodeChildEnv(env), 15_000).then(({ code, stdout, error }): Support => {
      if (code !== 0) return { flags: new Set(), error: `Claude Code did not start (${error ?? `\`claude --help\` exited ${code}`}). Reinstall it or set ZERO_CLAUDE_CODE_PATH.` };
      const flags = new Set(stdout.match(/--[A-Za-z][A-Za-z-]*/g) ?? []);
      const missing = REQUIRED_FLAGS.filter(flag => !flags.has(flag));
      return missing.length > 0
        ? { flags, error: `This Claude Code version is too old for 0 (missing ${missing.join(", ")}). Update it with \`claude update\`.` }
        : { flags };
    });
    supportByExecutable.set(executable, cached);
    // A failed probe (e.g. a transient spawn error) is retried on the next run.
    void cached.then(support => { if (support.error) supportByExecutable.delete(executable); });
  }
  return cached;
}

/** Test-only. */
export function __resetClaudeCodeSupportForTests(): void { supportByExecutable.clear(); }

export interface ClaudeCodeStatus {
  /** A Claude Code executable was found. */
  installed: boolean;
  executable?: string;
  version?: string;
  /** From `claude auth status`; undefined when it could not be read. */
  loggedIn?: boolean;
  /** "claude.ai" for a subscription login. */
  authMethod?: string;
  /** e.g. "pro", "max". */
  subscriptionType?: string;
  message: string;
}

/**
 * Login state of the operator's Claude Code, for Connections and `0 doctor`.
 * Reads only the non-identifying fields of `claude auth status`: never the
 * email or organization.
 */
export async function claudeCodeStatus(env: Readonly<NodeJS.ProcessEnv> = process.env, timeoutMs = 10_000): Promise<ClaudeCodeStatus> {
  const executable = resolveClaudeCodeExecutable(env, { searchPath: true });
  if (!executable) {
    return { installed: false, message: "Claude Code is not installed on this computer. Install it, run `claude login`, then check again." };
  }
  const childEnv = claudeCodeChildEnv(env);
  const [version, auth] = await Promise.all([
    run(executable, ["--version"], childEnv, timeoutMs),
    run(executable, ["auth", "status"], childEnv, timeoutMs),
  ]);
  const versionText = version.code === 0 ? version.stdout.trim().split(/\s+/)[0] : undefined;
  let parsed: Record<string, unknown> | undefined;
  try { parsed = JSON.parse(auth.stdout) as Record<string, unknown>; } catch { /* older versions print text */ }
  const loggedIn = typeof parsed?.["loggedIn"] === "boolean" ? parsed["loggedIn"] : undefined;
  const authMethod = typeof parsed?.["authMethod"] === "string" ? parsed["authMethod"] : undefined;
  const subscriptionType = typeof parsed?.["subscriptionType"] === "string" ? parsed["subscriptionType"] : undefined;
  const plan = subscriptionType ? `Claude ${subscriptionType.charAt(0).toUpperCase()}${subscriptionType.slice(1)}` : "Claude";
  const message = loggedIn === undefined
    ? "Claude Code is installed. Its sign-in could not be read; the first request verifies it."
    : !loggedIn
      ? "Claude Code is installed but not signed in. Run `claude login` in a terminal on this computer, then check again."
      : authMethod && authMethod !== "claude.ai"
        ? `Claude Code is signed in with ${authMethod}, not a Claude subscription. Run \`claude login\` and choose your Claude account to use your plan.`
        : `Signed in to ${plan} through Claude Code.`;
  return {
    installed: true, executable,
    ...(versionText ? { version: versionText } : {}),
    ...(loggedIn !== undefined ? { loggedIn } : {}),
    ...(authMethod ? { authMethod } : {}),
    ...(subscriptionType ? { subscriptionType } : {}),
    message,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function errorResult(start: number, error: string): NativeRuntimeResult {
  return { content: [{ type: "text", text: "" }], stopReason: "error", durationMs: Date.now() - start, error };
}

/**
 * The Claude subscription runtime. Served through the `ApiRuntime` facade
 * (kind `claude-code`), so it implements the same console surface as the API
 * runtimes: model selection, forks, worker bindings and diagnostics.
 */
export class ClaudeCodeRuntime implements Runtime, NativeRuntime {
  readonly type = "claude" as const;
  #config: RuntimeConfig;
  #env: Readonly<NodeJS.ProcessEnv>;
  #executable: string | undefined;
  #model: string;
  #effort: string = CLAUDE_CODE_DEFAULT_EFFORT;
  #supportsEffort = false;
  #workdirReady: string | undefined;
  #cli: CliNativeRuntime;
  /** Stable per conversation, so a worker checkpoint can be matched to its host runtime. */
  #conversationId = `ses_${randomUUID()}`;

  constructor(config: RuntimeConfig) {
    if (config.provider !== undefined && config.provider !== CLAUDE_CODE_PROVIDER) {
      throw new Error(`ClaudeCodeRuntime serves only the ${CLAUDE_CODE_PROVIDER} provider.`);
    }
    if (config.providerTransport || config.siwcConnection) throw new Error("The Claude subscription cannot use a granted transport or a ChatGPT plan connection.");
    if (config.cyberAccessProgram !== undefined) throw new Error(CYBER_UNAVAILABLE);
    this.#env = Object.freeze({ ...process.env, ...config.env });
    this.#executable = resolveClaudeCodeExecutable(this.#env, { searchPath: true });
    this.#model = claudeCodeModelId(config.model ?? this.#env["ZERO_MODEL"] ?? CLAUDE_CODE_DEFAULT_MODEL);
    this.#config = {
      ...config, type: "api", provider: CLAUDE_CODE_PROVIDER, model: this.#model,
      ...(config.agentModels ? { agentModels: Object.freeze({ ...config.agentModels }) } : {}),
    };
    this.#cli = this.#newCli();
  }

  #newCli(): CliNativeRuntime {
    return new CliNativeRuntime(
      { type: "claude", timeout: Math.max(this.#config.timeout || 0, CLAUDE_CODE_TURN_TIMEOUT_MS), cwd: claudeCodeWorkdir(this.#env) },
      {
        command: () => this.#executable ?? "claude",
        promptOnStdin: true,
        env: () => claudeCodeChildEnv(this.#env),
        args: () => [
          "--model", this.#model,
          ...(this.#supportsEffort ? ["--effort", this.#effort] : []),
          "--setting-sources", "",
          "--disable-slash-commands",
          "--strict-mcp-config",
          "--tools", "",
        ],
      },
    );
  }

  /** Why a run cannot start, or undefined when it can. */
  async #prepare(): Promise<string | undefined> {
    if (!this.#executable) return this.getConfigurationDiagnostics().fatalError;
    const support = await claudeCodeSupport(this.#executable, this.#env);
    if (support.error) return support.error;
    this.#supportsEffort = support.flags.has("--effort");
    const workdir = claudeCodeWorkdir(this.#env);
    if (workdir !== this.#workdirReady) {
      try {
        mkdirSync(workdir, { recursive: true, mode: 0o700 });
        chmodSync(workdir, 0o700);
      } catch (error) {
        return `Could not create the Claude Code working folder ${workdir}: ${error instanceof Error ? error.message : String(error)}`;
      }
      this.#workdirReady = workdir;
    }
    return undefined;
  }

  // ── NativeRuntime / Runtime ──

  /** Claude Code chooses its own output limit; 0 cannot bound the next response. */
  get outputTokenLimit(): number | undefined { return undefined; }

  async executeNative(system: string, messages: NativeMessage[], tools: NativeToolDef[], callbacks?: NativeStreamCallbacks, signal?: AbortSignal): Promise<NativeRuntimeResult> {
    const start = Date.now();
    if (signal?.aborted) return { content: [], stopReason: "error", durationMs: 0, cancelled: true, error: "CLI execution cancelled." };
    const problem = await this.#prepare();
    if (problem) return errorResult(start, problem);
    return this.#cli.executeNative(system, messages, tools, callbacks, signal);
  }

  /** Single prompt, run in its own Claude Code session so it never joins the conversation's. */
  async execute(prompt: string, context?: RuntimeContext): Promise<RuntimeResult> {
    const start = Date.now();
    const problem = await this.#prepare();
    const result = problem
      ? errorResult(start, problem)
      : await this.#newCli().executeNative(context?.systemPrompt ?? "", [{ role: "user", content: [{ type: "text", text: prompt }] }], []);
    const output = result.content.flatMap(block => block.type === "text" ? [block.text] : []).join("");
    return {
      output, exitCode: result.stopReason === "error" ? 1 : 0, timedOut: /timed out/.test(result.error ?? ""), durationMs: result.durationMs,
      ...(result.usage ? { usage: result.usage } : {}), ...(result.error ? { error: result.error } : {}),
    };
  }

  isAvailable(): Promise<boolean> {
    return this.#executable ? this.#cli.isAvailable() : Promise.resolve(false);
  }

  finishInvocation(): Promise<void> { return this.#cli.finishInvocation(); }

  async forkForSubagent(timeoutMs: number, selection?: SubagentModelSelection): Promise<ClaudeCodeRuntime> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Subagent timeout must be a positive finite number");
    const agentModels = this.#config.agentModels ?? {};
    const roleModel = selection?.role !== undefined && Object.hasOwn(agentModels, selection.role) ? agentModels[selection.role] : undefined;
    const autoInEffect = roleModel === "auto" || (this.#config.autoRoute === true && roleModel === undefined);
    const selected = this.#config.singleModel ? this.#model : selection?.model ?? (roleModel === "auto" ? undefined : roleModel) ?? this.#model;
    if (typeof selected !== "string" || !selected.trim()) throw new Error("Subagent model must be a non-empty model ID");
    const model = claudeCodeModelId(selected);
    const approved = model === this.#model ||
      Object.values(agentModels).some(id => id !== "auto" && claudeCodeModelId(id) === model) ||
      (autoInEffect && isClaudeCodeModel(model));
    if (!approved) {
      throw new Error(autoInEffect
        ? `Subagent model "${selected}" is not reachable through the Claude subscription.`
        : `Subagent model "${selected}" is not operator-approved. Configure agentModels before selecting it.`);
    }
    const child = new ClaudeCodeRuntime({ ...this.#config, timeout: timeoutMs, model, env: this.#bindingEnv() });
    child.#env = this.#env;
    child.#executable = this.#executable;
    child.#effort = this.#effort;
    child.#cli = child.#newCli();
    return child;
  }

  accessibleModels(): string[] {
    return [...new Set([this.#model, ...CLAUDE_CODE_MODELS.map(model => model.id)])];
  }

  resolvedModel(): string { return this.#model; }
  resolvedProvider(): string { return CLAUDE_CODE_PROVIDER; }
  /** Notional API-rate estimate for budgets and usage views; the subscription itself is not billed per token. */
  resolvedPricingModel(): string { return `anthropic/${this.#model}`; }
  modelSelection(): { agentModels: Record<string, string>; singleModel: boolean; autoRoute: boolean } {
    return { agentModels: { ...this.#config.agentModels }, singleModel: this.#config.singleModel === true, autoRoute: this.#config.autoRoute === true };
  }

  reconfigure(sel: {
    cyberAccessProgram?: CyberAccessProgram | null;
    siwcConnection?: SiwcConnection;
    model?: string;
    provider?: string;
    agentModels?: Record<string, string>;
    singleModel?: boolean;
    autoRoute?: boolean;
    env?: NodeJS.ProcessEnv;
  }): void {
    if (sel.provider !== undefined && sel.provider !== CLAUDE_CODE_PROVIDER) throw new Error("Changing the provider requires a new runtime.");
    if (sel.siwcConnection !== undefined) throw new Error("The Claude subscription does not use a ChatGPT plan connection.");
    if ((sel.cyberAccessProgram ?? null) !== null) throw new Error(CYBER_UNAVAILABLE);
    if (sel.env !== undefined) this.refreshConnection(sel.env);
    if (sel.agentModels !== undefined) this.#config = { ...this.#config, agentModels: Object.freeze({ ...sel.agentModels }) };
    if (sel.singleModel !== undefined) this.#config = { ...this.#config, singleModel: sel.singleModel };
    if (sel.autoRoute !== undefined) this.#config = { ...this.#config, autoRoute: sel.autoRoute };
    // The next Claude Code run picks the model up, resuming the same conversation.
    if (sel.model !== undefined) { this.#model = claudeCodeModelId(sel.model); this.#config = { ...this.#config, model: this.#model }; }
  }

  // ── console surface ──

  /** Non-secret identity of the Claude Code login this runtime uses (its config folder, or a long-lived token). */
  connectionIdentity(): string | undefined {
    if (!this.#executable) return undefined;
    const configDir = this.#env["CLAUDE_CONFIG_DIR"]?.trim() || join(this.#env["HOME"] || homedir(), ".claude");
    const token = this.#env["CLAUDE_CODE_OAUTH_TOKEN"]?.trim();
    return sha256(JSON.stringify([CLAUDE_CODE_PROVIDER, configDir, token ? sha256(token) : null]));
  }

  reasoningConfiguration(): { effort: string; options: string[] } | null {
    return { effort: this.#effort, options: [...CLAUDE_CODE_EFFORTS] };
  }

  setReasoningEffort(effort: string): void {
    if (!(CLAUDE_CODE_EFFORTS as readonly string[]).includes(effort)) throw new Error("This reasoning effort is not supported by the selected model and connection.");
    this.#effort = effort;
  }

  async codexModelCatalog(_signal?: AbortSignal): Promise<CodexCatalogModel[]> {
    throw new Error("No active Codex subscription");
  }

  async availableModelCatalog(signal?: AbortSignal): Promise<Array<{ id: string; contextTokens?: number; source?: "catalog" }>> {
    signal?.throwIfAborted();
    return CLAUDE_CODE_MODELS.map(model => ({ id: model.id, contextTokens: model.contextTokens }));
  }

  publishedContextWindowTokens(): number | undefined { return claudeCodeModel(this.#model)?.contextTokens; }

  accessibleProviders(): ApiProvider[] { return [CLAUDE_CODE_PROVIDER]; }

  /** Re-read the environment (a new login or a changed `CLAUDE_CONFIG_DIR`) at an idle boundary. */
  refreshConnection(env: NodeJS.ProcessEnv): void {
    const before = this.connectionIdentity();
    this.#env = Object.freeze({ ...process.env, ...env });
    this.#executable = resolveClaudeCodeExecutable(this.#env, { searchPath: true });
    // Another account's Claude Code cannot resume this account's session. The
    // same login keeps the conversation; a moved executable is read per run.
    if (this.connectionIdentity() !== before) { void this.#cli.finishInvocation(); this.#cli = this.#newCli(); }
  }

  getConfigurationDiagnostics(): ApiRuntimeDiagnostics {
    if (this.#executable) return { valid: true, provider: CLAUDE_CODE_PROVIDER, providerLabel: CLAUDE_CODE_LABEL };
    const explicit = this.#env["ZERO_CLAUDE_CODE_PATH"]?.trim();
    return {
      valid: false, provider: CLAUDE_CODE_PROVIDER, providerLabel: CLAUDE_CODE_LABEL, reason: "missing_key",
      fatalError: /^(?:0|false|off|no)$/i.test(this.#env["ZERO_CLAUDE_CODE"]?.trim() ?? "")
        ? "The Claude subscription is turned off (ZERO_CLAUDE_CODE). Unset it to use Claude Code."
        : explicit
          ? `ZERO_CLAUDE_CODE_PATH does not name an executable Claude Code (${explicit}).`
          : "Claude Code is not installed or not on PATH. Install Claude Code and run `claude login`, or set ZERO_CLAUDE_CODE_PATH.",
    };
  }

  workbenchCredentialResolver(): () => Promise<{ accessToken: string; accountId?: string }> {
    throw new Error("Host workbench credential broker requires a captured chatgpt-codex account");
  }

  useGrantedProviderTransport(_transport: NonNullable<RuntimeConfig["providerTransport"]>, _selection: { model?: string; agentModels?: Record<string, string>; singleModel?: boolean; autoRoute?: boolean } = {}): void {
    throw new Error("The Claude subscription cannot use a granted provider transport.");
  }

  setCyberAccessProgram(value: CyberAccessProgram | null): void {
    if (value !== null) throw new Error(CYBER_UNAVAILABLE);
  }

  getCyberAccessProgram(): CyberAccessProgram | undefined { return undefined; }

  cyberAccessProgramConfiguration(): { confirmed?: CyberAccessProgram; requested?: CyberAccessProgram; options: CyberAccessProgram[]; unavailableReason?: string } {
    return { options: [], unavailableReason: CYBER_UNAVAILABLE };
  }

  #bindingEnv(): Record<string, string> {
    return Object.fromEntries(Object.entries(this.#env).filter((entry): entry is [string, string] => entry[1] !== undefined && BINDING_ENV.test(entry[0])));
  }

  /**
   * Host-only binding for a private worker pipe. It carries no credential of
   * 0's: the worker's Claude Code reads the same operator login. The Claude
   * Code session id stays behind; a worker's first run replays the
   * conversation instead of racing the host for the same session.
   */
  exportPrivateWorkerBinding(): PrivateWorkerRuntimeBinding {
    const identity = this.connectionIdentity();
    if (!identity) throw new Error("The selected runtime has no captured connection identity.");
    const config: RuntimeConfig = { type: "api", timeout: this.#config.timeout, provider: CLAUDE_CODE_PROVIDER, model: this.#model, ...this.modelSelection() };
    return structuredClone({
      config, env: this.#bindingEnv(), provider: CLAUDE_CODE_PROVIDER, apiKey: "", baseUrl: CLAUDE_CODE_BASE_URL, model: this.#model,
      wireApi: "chat_completions" as const, reasoningEffort: this.#effort, azureConfig: parseCodexAzureConfig({}),
      fallbackChain: [], fallbackIndex: 0, identity, opencodeConversationId: this.#conversationId, runtimeKind: CLAUDE_CODE_PROVIDER,
    }) as PrivateWorkerRuntimeBinding;
  }

  static fromPrivateWorkerBinding(binding: PrivateWorkerRuntimeBinding): ClaudeCodeRuntime {
    const sealed = structuredClone(binding);
    if (sealed.runtimeKind !== CLAUDE_CODE_PROVIDER || sealed.provider !== CLAUDE_CODE_PROVIDER || sealed.config.provider !== CLAUDE_CODE_PROVIDER ||
      sealed.config.model !== sealed.model || !sealed.identity || !Number.isFinite(sealed.config.timeout) || sealed.config.timeout <= 0 ||
      !/^ses_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(sealed.opencodeConversationId)) {
      throw new Error("Invalid host worker runtime binding.");
    }
    const runtime = new ClaudeCodeRuntime({ ...sealed.config, env: sealed.env });
    if (sealed.reasoningEffort !== undefined) runtime.setReasoningEffort(sealed.reasoningEffort);
    runtime.#conversationId = sealed.opencodeConversationId;
    if (runtime.connectionIdentity() !== sealed.identity) throw new Error("Host worker connection identity does not match the captured session.");
    return runtime;
  }

  applyPrivateWorkerBinding(binding: PrivateWorkerRuntimeBinding, options?: { replaceSelection: true }): void {
    const candidate = ClaudeCodeRuntime.fromPrivateWorkerBinding(binding);
    if (!options?.replaceSelection && (candidate.connectionIdentity() !== this.connectionIdentity() || candidate.#model !== this.#model || candidate.#conversationId !== this.#conversationId)) {
      throw new Error("Worker checkpoint does not match the current session connection and model.");
    }
    if (options?.replaceSelection) {
      this.#conversationId = candidate.#conversationId;
      this.#config = candidate.#config;
      this.#model = candidate.#model;
    }
    this.#effort = candidate.#effort;
  }
}
