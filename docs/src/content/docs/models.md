---
title: Models
description: Connect a model provider, choose models per role and control how 0 routes model calls.
---

0 runs on your own model provider. Connect one in the browser or with an environment variable, then pick a model.

## Connect in the browser

1. Run `0` and open **Settings → Models**.
2. Pick a provider. Paste an API key or follow its sign-in flow.
3. Pick a **Default model**, or keep the one 0 chooses for a new connection.

The model list comes from your connections. It flags a connection that needs attention. Under **Providers**, you can turn off single models of a connection. Public catalogs add price and context data but do not grant access, so a listed model can still be unavailable to your account.

## Connect from a shell

Export a provider key, then run any command:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
0 -p "Review ./your-repo for injection bugs"
```

| Provider | Environment |
| --- | --- |
| Claude subscription (Pro, Max) | Install Claude Code and run `claude login` ([details](#claude-subscription)) |
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| ChatGPT Codex | `codex login`, or `ZERO_CHATGPT_ACCESS_TOKEN` / `ZERO_CHATGPT_OAUTH_REFRESH_TOKEN` |
| OpenRouter | `OPENROUTER_API_KEY` |
| Azure OpenAI | `AZURE_OPENAI_API_KEY`, plus endpoint and deployment ([details](#azure-openai)) |
| DeepSeek | `DEEPSEEK_API_KEY` |
| Z.ai GLM | `Z_AI_API_KEY` |
| Moonshot Kimi | `KIMI_API_KEY` |
| Alibaba Qwen | `QWEN_API_KEY` and `QWEN_BASE_URL` |
| xAI Grok | `XAI_API_KEY` |
| OpenCode Zen | `OPENCODE_API_KEY` (`OPENCODE_BASE_URL` to change the endpoint) |
| Together AI | `TOGETHER_API_KEY` ([details](#together-ai)) |
| Amazon Bedrock | AWS credential chain, pinned with `ZERO_SELECTED_PROVIDER=bedrock` ([details](#amazon-bedrock)) |

Check what 0 found:

```bash
0 config doctor
```

It prints the CLI version, runtime and Node.js check, then the status of each API provider: `configured`, `bad` (found but unusable, with the reason) or `missing`. It also lists any `claude`, `codex` and `gemini` CLIs on your `PATH`. A provider marked configured has a key, but 0 does not test it until the first request.

## Choose a model

In the browser, the model picker in a thread changes that thread's model while it is idle. **Settings → Models → Default model** sets the default for new threads.

In the CLI, pass `--model <id>` or set `ZERO_MODEL`. `--model` wins. Use an exact model ID your account supports:

```bash
env ZERO_SELECTED_PROVIDER=openai ZERO_MODEL=<model-id> \
  0 -p "Review ./authorized-repo"
```

Choose a model that supports tool calling. Agents need it.

## Custom and local providers

Any OpenAI-compatible Chat Completions server works, local or remote. The model does not need to be in a catalog.

In the browser, open **Providers** on the Models page and choose **OpenAI / Custom AI Provider**. Enter the base URL with its version path (for example `http://localhost:20128/v1`), the **Custom model ID** and the API key. HTTP and HTTPS both work.

In a shell:

```bash
export OPENAI_API_KEY="your-provider-key"
export OPENAI_BASE_URL="http://localhost:20128/v1"
export OPENAI_MODEL="your-provider/model-id"
export ZERO_SELECTED_PROVIDER="openai"
0
```

0 appends `/chat/completions` to the base URL. Set `OPENAI_WIRE_API=responses` for servers that need the Responses API. Exported values override saved connection settings. An explicit model choice overrides `OPENAI_MODEL`.

For OpenCode Go, use its published base URL, such as `https://opencode.ai/inference/go/openai/v1`.

### Ollama

Ollama serves an OpenAI-compatible endpoint. Connect it as a custom provider:

```bash
OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_API_KEY=ollama \
  0 -p "Review ./authorized-repo" --model gemma4:27b
```

Pull a model that supports tool calling first. A remote Ollama server receives your source context.

### Enterprise gateway: Bedrock through LiteLLM

To run models in your own AWS account, put a [LiteLLM](https://docs.litellm.ai) proxy in front of Amazon Bedrock. 0 treats the proxy as a custom OpenAI-compatible provider. The proxy holds the AWS credentials, so 0 never sees them.

A LiteLLM configuration file that exposes one Bedrock model:

```yaml
model_list:
  - model_name: claude-bedrock
    litellm_params:
      model: bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0
      aws_region_name: eu-central-1
general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
```

Start the proxy with `litellm --config config.yaml`. It uses the AWS credential chain of its host, such as an instance role or `AWS_*` variables. Then point 0 at it:

```bash
export OPENAI_BASE_URL="https://litellm.internal.example/v1"
export OPENAI_API_KEY="your-litellm-key"
export ZERO_SELECTED_PROVIDER="openai"
export ZERO_MODEL="claude-bedrock"
export ZERO_NO_TELEMETRY=1
0 -p "Review ./authorized-repo"
```

- Set `ZERO_MODEL` to the proxy's `model_name`, not the Bedrock ID.
- Any other OpenAI-compatible gateway (vLLM, an API management layer, a vendor proxy) uses the same variables.
- The Bedrock model must support tool use. 0 sends standard OpenAI `tools` definitions, and LiteLLM translates them for Bedrock.
- Leave `ZERO_LLM_FALLBACK` unset and do not export other provider keys, so no request can route elsewhere. See [Keep model traffic in one region](#keep-model-traffic-in-one-region).
- To check the route without a scan, run `ZERO_RUNTIME_TRACE=1 0 -p "reply with ok"`. It prints the chosen provider and model on stderr.

With `ZERO_NO_TELEMETRY=1`, `DO_NOT_TRACK=1` or `ZERO_OFFLINE=1`, 0 sends no usage counts or crash reports. It also skips the public price and model-catalog lookups, so prices for gateway models show as unknown. Model requests go only to `OPENAI_BASE_URL`.

Some traffic stays under your control. The `web_search` tool is off unless you set `ZERO_FEATURE_WEB_SEARCH=1`. Scan targets are contacted because you point 0 at them. GitHub is contacted only when you scan a GitHub repository.

## Claude subscription

0 runs on a Claude Pro or Max plan through [Claude Code](https://code.claude.com/docs), using Claude Code's own sign-in.

1. Install Claude Code and run `claude login` with your Claude account.
2. Run `0`. At startup 0 finds `claude` on your `PATH` and makes the subscription its first choice. In the browser it is listed under **Subscriptions** as **Claude**; **Check sign-in** reads the login again.

```bash
claude login
0 scan ./your-repo                            # claude-opus-5-5 on your plan
0 scan ./your-repo --model claude-sonnet-5-5
```

How it works:

- Anthropic allows a subscription login only inside Claude Code, so 0 never reads, stores or sends it. Each model turn is a headless `claude -p` run. 0's tools reach Claude Code through a local MCP bridge, and 0 still executes every tool call.
- Each run is isolated from your own Claude Code setup and from the code under review. No settings, hooks, plugins, skills, `CLAUDE.md` files or other MCP servers load, Claude Code's built-in tools are off, it runs in `~/.0/claude-code`, and it receives no API keys or other credentials from 0's environment.
- Models: `claude-opus-5-5` (default), `claude-sonnet-5-5`, `claude-fable-5-2` and `claude-haiku-5-5`, or the aliases `opus`, `sonnet`, `fable` and `haiku`. The thinking-effort control sets `claude --effort` (default `high`).
- Requests count against your plan's usage limits. Costs and `--budget` use the API-equivalent price as an estimate; the plan is not billed per token.
- Claude Code keeps its session transcripts under `~/.claude/projects/`, in the project for `~/.0/claude-code`.

| Variable | Use |
| --- | --- |
| `ZERO_CLAUDE_CODE=0` | Turn the Claude subscription off, including detection. |
| `ZERO_CLAUDE_CODE_PATH` | Use this Claude Code executable instead of the one on `PATH`. |
| `CLAUDE_CODE_OAUTH_TOKEN` | Headless hosts and CI: a long-lived token from `claude setup-token`. Claude Code reads it; 0 only passes it through. |
| `ZERO_SELECTED_PROVIDER=claude-code` | Pin the subscription. |

Claude models route to the subscription before an `ANTHROPIC_API_KEY`. To use the API key instead, choose **Anthropic** in Connections, set `ZERO_SELECTED_PROVIDER=anthropic`, or set `ZERO_CLAUDE_CODE=0`. Cyber access programs are an OpenAI feature and are not available on the Claude subscription.

## ChatGPT Codex

In the browser, open **Providers** on the Models page, select **ChatGPT Codex** and follow the device sign-in.

From a shell, run `codex login`. At startup, 0 reads tokens from `~/.codex/auth.json` when no `ZERO_CHATGPT_*` token is set. A signed-in Codex session takes priority over stale `OPENAI_API_KEY` or `AZURE_OPENAI_API_KEY` values in your shell.

| Variable | Use |
| --- | --- |
| `ZERO_CODEX_AUTH_JSON_PATH` | Read a different auth file. |
| `ZERO_CHATGPT_ACCESS_TOKEN`, `ZERO_CHATGPT_OAUTH_REFRESH_TOKEN` | Supply tokens directly. The access token is read first. |
| `ZERO_CHATGPT_ACCOUNT_ID` | Set the account ID. Otherwise it comes from the auth file. |

Codex uses its own auth file, not 0's credential store, and rejects a generic `--api-key`. Choose **OpenAI** for an API-key connection.

## Provider notes

### Azure OpenAI

Supply the key, the endpoint and the deployment ID, and pin the provider:

```bash
export AZURE_OPENAI_API_KEY="your-azure-key"
export AZURE_OPENAI_BASE_URL="https://your-resource.openai.azure.com/openai/v1"
export AZURE_OPENAI_WIRE_API="responses"
env ZERO_SELECTED_PROVIDER=azure ZERO_MODEL="your-deployment-id" \
  0 -p "Review ./authorized-repo"
```

| Setting | Resolution |
| --- | --- |
| Endpoint | `AZURE_OPENAI_BASE_URL`, then `OPENAI_BASE_URL`, then the Azure section of `~/.codex/config.toml` |
| Model | `--model`, then `ZERO_MODEL`. Without a pin, `AZURE_OPENAI_MODEL` or an Azure-backed Codex config model also works. |
| Wire | `AZURE_OPENAI_WIRE_API`: `chat_completions` (default) or `responses` |

Include `/openai/v1` in a Responses base URL. With an existing Azure CLI sign-in, the model picker lists the deployments of your resource. It never starts a login. With a key alone, enter the deployment ID by hand.

0 probes the endpoint once to learn its region. That is a diagnostic, not a residency guarantee.

### Amazon Bedrock

0 calls Bedrock directly with the AWS SDK, with no proxy in between. Authentication uses the standard AWS credential chain: environment keys, `AWS_PROFILE` (including SSO), an ECS task role, a web identity token or an instance role. You can also set `AWS_BEARER_TOKEN_BEDROCK` for a Bedrock API key. 0 stores no AWS secret.

0 never picks Bedrock from ambient AWS variables. Pin it and name the model:

```bash
export AWS_PROFILE="audit-prod"
export AWS_REGION="eu-central-1"
env ZERO_SELECTED_PROVIDER=bedrock \
  ZERO_MODEL="eu.anthropic.claude-sonnet-4-5-20250929-v1:0" \
  0 -p "Review ./authorized-repo"
```

| Setting | Resolution |
| --- | --- |
| Credentials | The AWS SDK chain. `AWS_BEARER_TOKEN_BEDROCK` wins when set. |
| Region | `AWS_REGION`, then `AWS_DEFAULT_REGION`, then the profile's region, then `us-east-1`. |
| Endpoint | `BEDROCK_BASE_URL` for a VPC endpoint or an internal proxy. Otherwise the regional `bedrock-runtime` endpoint. |
| Model | A Bedrock model ID or cross-region inference profile ID your account can invoke. The default is `global.anthropic.claude-sonnet-4-5-20250929-v1:0`. |

The model must support tool use through the Converse API. Prices for Bedrock models show as unknown. The model picker does not list Bedrock models, so pass the ID with `--model` or `ZERO_MODEL`. You can use `bedrock:<model>` in [`ZERO_LLM_FALLBACK`](#failover) when AWS credentials are set. To reach Bedrock through a LiteLLM proxy instead, use an [OpenAI-compatible gateway](#custom-and-local-providers).

### Together AI

Connect **Together AI** or export `TOGETHER_API_KEY`. The default endpoint is `https://api.together.ai/v1`. Set `TOGETHER_BASE_URL` to change it.

Together model IDs look like other providers' IDs (`Qwen/...`, `deepseek-ai/...`), so 0 never routes to Together by model name. Select it explicitly:

```bash
env ZERO_SELECTED_PROVIDER=together ZERO_MODEL=openai/gpt-oss-120b \
  0 -p "Review ./authorized-repo"
# or, with no provider pin:
0 -p "Review ./authorized-repo" --model together/openai/gpt-oss-120b
```

0 removes the `together/` prefix before the request. The default model is `openai/gpt-oss-120b`. The picker lists chat models with published prices. Set `TOGETHER_MODEL_LIST=all` to list every chat model your key can see. Unlisted IDs, including dedicated endpoints, still work with `--model`.

### Alibaba Qwen

Set `QWEN_API_KEY` and `QWEN_BASE_URL` for the product and region shown in your account. QwenCloud, Model Studio, Coding Plan and Token Plan keys are not interchangeable, and 0 does not infer the region. Qwen OAuth is discontinued upstream.

### OpenRouter, xAI and Kimi sign-in

- OpenRouter: browser sign-in creates an API key for you. When OpenRouter is the selected provider, `--model free` maps to `nvidia/nemotron-3-super-120b-a12b:free`.
- xAI and Kimi: browser sign-in needs a client registered for 0. Set `ZERO_XAI_OAUTH_CLIENT_ID` or `ZERO_KIMI_OAUTH_CLIENT_ID` before the app starts, or use an API key.

OpenAI, OpenRouter, xAI and Azure accept `OPENAI_WIRE_API`, `OPENROUTER_WIRE_API`, `XAI_WIRE_API` and `AZURE_OPENAI_WIRE_API`, set to `chat_completions` or `responses`.

## How 0 picks a provider

With several keys set, 0 resolves the provider in this order:

1. A pin. `ZERO_SELECTED_PROVIDER` selects the provider outright. Set `ZERO_MODEL` with it.
2. The model name. `--model` or `ZERO_MODEL` routes by prefix when that provider has a key.
3. Ambient priority. Otherwise the first configured key in the [priority list](#ambient-priority) wins.

### Pin a provider

`ZERO_SELECTED_PROVIDER` accepts `claude-code`, `openrouter`, `anthropic`, `openai`, `azure`, `deepseek`, `chatgpt-codex`, `z-ai`, `kimi`, `qwen`, `xai`, `opencode`, `together` and `bedrock`.

```bash
env ZERO_SELECTED_PROVIDER=deepseek ZERO_MODEL=deepseek-flash \
  0 -p "Review https://example.com"
```

Pin a provider when you need a predictable bill, especially with Azure deployment names.

### Routing by model name

| Model ID | Provider |
| --- | --- |
| `together/<org>/<model>` | Together AI (prefix removed) |
| `openrouter/*` | OpenRouter |
| `glm-*`, `z-ai/*`, IDs containing `glm` | Z.ai GLM |
| `qwen*` | Alibaba Qwen |
| `k3*`, `kimi*` | Moonshot Kimi |
| `grok*`, `xai/*`, `x-ai/*` | xAI Grok |
| `opencode/*`, `muse-spark*`, `mimo*`, `ling*`, `big-pickle`, `nemotron*`, `minimax*` | OpenCode Zen |
| `gpt-*`, `o1` to `o4` | ChatGPT Codex when signed in, else OpenAI |
| `claude-code/*` | Claude subscription |
| `claude*`, `anthropic/*`, IDs containing `sonnet`, `opus`, `haiku` or `fable` | Claude subscription when Claude Code is installed, else Anthropic, else OpenRouter |
| Exact `deepseek-flash`, `deepseek-v4-flash` | DeepSeek |
| Known Azure Foundry deployment IDs | Azure |

A match without that provider's key falls through to ambient priority. These rules route. They do not check availability.

### Ambient priority

1. Claude subscription (Claude Code installed; `ZERO_CLAUDE_CODE=0` skips it)
2. ChatGPT Codex (`ZERO_CHATGPT_*` tokens or `~/.codex/auth.json`)
3. DeepSeek
4. OpenRouter
5. Azure OpenAI
6. OpenAI
7. Z.ai GLM
8. Moonshot Kimi
9. Alibaba Qwen
10. xAI Grok
11. OpenCode Zen
12. Anthropic
13. Together AI

An explicit `--api-key` without a pin picks by shape. `sk-or-` selects OpenRouter, `sk-ant-` selects Anthropic, and anything else selects OpenAI-compatible access. Prefer environment variables, because command-line secrets end up in shell history and process lists.

## Connection health

A connection shows **Connected** (green) only after the provider accepts its key. 0 checks each connection with a short request when you open **Connections** or **Models** and when you start a thread. It reuses the answer for about five minutes.

| Badge | Meaning |
| --- | --- |
| **Connected** | The provider accepted the key. |
| **Key rejected** | The provider answered 401 or 403. The row tells you which variable to set, or to update the saved key. |
| **Signed out** | Claude subscription only: Claude Code is missing or not signed in to a Claude account. Run `claude login`, then **Check sign-in**. |
| **Can't reach** | The provider did not answer in time. Check your network or the API endpoint. |
| **Connected** (grey) | A key is present, but the provider has no cheap check (for example Azure OpenAI), so 0 has not verified it. |

0 never picks a rejected or unreachable provider as the default for new threads. If a message fails with a rejected key, the thread names the provider and model. It offers **Switch to** a model on a working connection, which resends your message, or **Manage connection**. **Settings → Diagnostics** shows the same states.

## Failover

`ZERO_LLM_FALLBACK` lists backup routes for when the primary runs out of retries or hits a plan quota:

```bash
env ZERO_LLM_FALLBACK=deepseek:deepseek-flash,azure:gpt-5-deployment \
  0 -p "Review ./authorized-repo"
```

Each entry is `<provider>:<model>`. Entries are comma-separated and tried in order. 0 skips entries without credentials, or for Azure without an endpoint. Failover changes who receives your context and who bills you. A cyber access program request disables failover.

## Advanced settings

| Variable | Default | Effect |
| --- | --- | --- |
| `ZERO_RUNTIME` | `auto` | Provider client. `auto` picks the right client per route, `legacy` always uses the built-in client, and `pi-ai` forces the pi-ai client and fails on routes it cannot serve. |
| `ZERO_RUNTIME_TRACE` | unset | `1` prints the chosen client, provider and model to stderr. |
| `ZERO_MAX_COMPLETION_TOKENS` | `8192` | Completion tokens requested per call. Positive integer, clamped to `131072`. Very small values truncate tool calls. |

If a provider misbehaves under `auto`, set `ZERO_RUNTIME=legacy` and report it. Bedrock ignores `legacy`.

## Cyber access programs

OpenAI's Daybreak programs need an explicit request. A model name alone does not select one. In the browser, use the **Daybreak** control beside the model settings. **Automatic** clears the request.

The control requests access. It does not grant it. Reports keep the requested program separate from what the provider confirmed. Program-bound calls never fall back to another provider. Do not pass `--api-key` with ChatGPT sign-in.

## Keep model traffic in one region

Pin the provider and its endpoint with `ZERO_SELECTED_PROVIDER` and `ZERO_MODEL`, as in the [Azure OpenAI](#azure-openai) example. Leave `ZERO_LLM_FALLBACK` unset.

Setting a provider's variables alone does not send all traffic there, because ambient priority and [failover](#failover) can pick other routes. The GitHub API and web search still leave the region.

## Manage connections from a shell

These commands do what **Settings → Connections** and **Models** do. Keys come from an environment variable or stdin, never from an argument.

```bash
0 models connect openai --key-env MY_OPENAI_KEY
0 models connect openai --test
0 models list --provider openai
0 models set --provider openai gpt-5.4-mini
0 models connect openai --remove --yes
```

## Where credentials live

Keys saved under **Providers** on the Models page are stored in plaintext at `~/.0/credentials.json`, with `0600` file and `0700` folder permissions. Keep that file out of source control and bug reports.

A nonblank environment variable wins over the saved key for that provider. Connections marks such a row **From environment** and the saved key **Not in use**. In CI and other automation, pass credentials in the environment.

## Limits

- Billing, model access and rate limits belong to your provider account.
- Shown prices are estimates. Unknown prices are unknown, not zero.
- A model connection does not authorize a target.
