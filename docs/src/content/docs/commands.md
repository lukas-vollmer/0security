---
title: CLI reference
description: 0 CLI commands, arguments, options, aliases, and registered defaults.
tableOfContents:
  minHeadingLevel: 2
  maxHeadingLevel: 2
---

Pick your task below, or search for a command name.

New to 0? Read the [Quickstart](/) first. Settings and environment variables are on [Configuration](/configuration/).

## Start by task

| Task | Commands | Guide |
| --- | --- | --- |
| Scan code | [scan](#scan) | [Findings](/findings/) |
| Review findings and threads | [findings](#findings) · [findings update](#findings-update) · [threads](#threads) | [Findings](/findings/), [Threads](/threads/) |
| Automate | [sentinels](#sentinels) · [api](#api) | [Sentinels](/sentinels/) |
| Set up and extend | [config](#config) · [config doctor](#config-doctor) · [models](#models) · [models connect](#models-connect) · [skills](#skills) · [computers](#computers) | [Models](/models/), [Extensions](/extensions/), [Computers](/computers/) |

## The eleven commands

`0` with no arguments opens the web console. Everything else is one of eleven commands.

| Command | What it does | Subcommands |
| --- | --- | --- |
| `0 scan` | Scan a folder or git repository for security bugs; prints the findings as a report. | none |
| `0 threat-model` | Draft the repository's threat model as a file for people to review (optionally as a pull request). | none |
| `0 probe` | Send adversarial messages to a live model or agent endpoint and report the ones it obeys. | none |
| `0 sbom` | Generate an SBOM from lockfiles, check one against known advisories, and check its licenses against a policy. | `generate`, `check`, `licenses` |
| `0 findings` | Browse findings and change their status. `--format` exports, `--import` loads a report. | `list`, `show`, `update`, `import`, `fix` |
| `0 threads` | Start, follow and stop threads. | `list`, `show`, `send`, `start`, `stop` |
| `0 sentinels` | Create, run and change Sentinels. | `list`, `run`, `set` |
| `0 skills` | Skills and extensions: list, add. | `list`, `add` |
| `0 models` | Models and provider connections. | `list`, `set`, `connect` |
| `0 computers` | Remote computers that run 0. | `list`, `add` (alias `deploy`), `stop` |
| `0 config` | Settings, API keys, team setup and `config doctor`. | `get`, `set`, `doctor` |

## Invocation and safety

Run commands as `0 <command>`. Run `0 --version` for your release and `0 <command> --help` for a command's flags.

The browser app's chat uses the same words as slash commands: `/threads list`,
`/findings list`, `/models default` and `/config get` mirror `0 threads list`,
`0 findings list`, `0 models set` and `0 config get`. See [Slash commands](/threads/#slash-commands).

Option tables show the default each flag is registered with. A dash means no default is registered: the command may read it from configuration or require a value. A `--no-*` option shows the default of the positive flag. See [Configuration](/configuration/) for environment variables.

- With no arguments, `0` opens the browser app. No account is needed. See [Browser app](/threads/).
- `0 -p "<prompt>"` runs one headless chat prompt. `0 -c` continues the last chat and `0 --resume <id>` a saved one.
- `0 --help` lists the eleven commands.
- Use explicit commands in automation. 0 routes a recognizable bare target to a command and refuses ambiguous input.
- With the SmolVM workbench profile on, the whole CLI runs inside an online Kali guest. `workbench` and `config` stay on the host, and a failure never falls back to host execution.

## Shortcut commands

These forms run the commands documented in the sections below.

### findings update

Change a finding's status to `accepted`, `suppressed`, `open` or `false-positive`. A false positive needs `--reason`, which is saved as its note.

```text
0 findings update [options] <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--status <status>` | — | accepted \| suppressed \| open \| false-positive |
| `--note <text>` | — | Why (optional) |
| `--reason <text>` | — | Why; required with false-positive |
| `--db-path <path>` | — | Path to SQLite database |

### models set

Show or choose the default model. It takes the same arguments as `models default`.

```text
0 models set [options] [model]
```

| Argument | Required | Description |
| --- | --- | --- |
| `model` | No |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--provider <provider>` | — | Provider of the model |

### models connect

Add a provider connection, or list, test or remove one with `--list`, `--test` and `--remove`. These run `models connections add`, `list`, `test` and `remove`.

```text
0 models connect [options] [provider]
```

| Argument | Required | Description |
| --- | --- | --- |
| `provider` | No |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--key-env <VAR>` | — | Add: read the API key from this environment variable |
| `--stdin` | — | Add: read the API key from stdin |
| `--list` | — | List connections (the default with no provider) |
| `--test` | — | Test a connection |
| `--remove` | — | Remove a connection (with --yes) |

### config doctor

Check this machine and the engine. `--fix` repairs the local database. The subcommands of `doctor` also work here: `config doctor upgrade`, `config doctor workbench` and `config doctor checks`.

```text
0 config doctor [options] [checks...]
```

| Argument | Required | Description |
| --- | --- | --- |
| `checks` | No |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--fix` | — | Repair the local database |
| `--json` | — | Print JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

## Interactive & setup

### scan

Scan a folder or git repository for security bugs and print the findings as a report.

```text
0 scan [options] [target]
```

Run it on a folder or a git URL:

```bash
0 scan ~/code/app --format sarif -o scan.sarif --fail-on high
```

A scan is a thread that follows the `scan` skill, so it appears in `0 threads` and in the web app. Findings are stored under the thread id, and `0 findings export --scan <thread id>` gives the same report later.

The scan uses the running console, or the engine named by `--engine-url` or `--computer`. With none running, it starts a headless console and stops it afterwards.

Exit codes:

- 0: done
- 1: a finding at or above `--fail-on`, or the scan failed
- 2: usage error
- 3: not finished. The scan stopped at the budget or the time limit, or entry points were not reached, so the report is partial. This is not a failure. Findings so far are kept, and `--resume` continues the scan

Add `--allow-partial` when a partial scan should not fail the job. The exit code then follows the findings alone: 0, or 1 with `--fail-on`. The report still says it is partial.

To see what a scan involves before you run it, use `--plan`. It lists the entry points, the batches and a rough cost, and calls no model:

```bash
0 scan ~/code/app --plan
```

To review a change instead of the whole folder, pass `--diff <ref>`, for example in a pull request job:

```bash
0 scan . --diff origin/main --format sarif -o scan.sarif
```

0 reviews the files that differ from the ref (committed or not) and the code they connect to. The folder must be a git work tree. An empty diff starts no thread and writes an empty report.

If FoxGuard is installed, the scan runs it first. It takes seconds and costs nothing. The thread treats its hits as leads, checks each against the code, records only the real ones and says which it rejected. A pattern scanner cannot see logic bugs such as a missing ownership check, so the thread still reviews the entry points itself.

FoxGuard ships next to `0`; set `ZERO_FOXGUARD_PATH` to use another copy. Pass `--prepass off` to skip it. `--scanner` chooses the scanners (`foxguard`, `semgrep`, `opengrep`, `gitleaks`, `trivy`, `osv-scanner`); repeat the flag or separate ids with commas to run several. A scanner that is not installed is skipped, and 0 says how to install it. A Semgrep rule pack such as `p/default` is downloaded when it runs.

```bash
0 scan ~/code/app --scanner foxguard,gitleaks,trivy
```

The default stays FoxGuard alone. The other scanners are not installed with 0. Set `ZERO_GITLEAKS_PATH`, `ZERO_TRIVY_PATH` or `ZERO_OSV_SCANNER_PATH` to use a binary outside your path.

| Scanner | Finds | Reaches the network |
| --- | --- | --- |
| `gitleaks` | Secrets in the files of the folder | No |
| `trivy` | Vulnerable dependencies, misconfigurations such as Terraform and Kubernetes, and secrets | Downloads its databases on first run |
| `osv-scanner` | Vulnerable dependencies in lockfiles | Sends package names and versions to osv.dev and deps.dev |

Each scanner runs without a shell, on the folder as an absolute path, with a time limit (2 minutes; 5 for trivy, 3 for osv-scanner). One that fails or runs out of time is skipped with a note. A `.gitleaks.toml` or `.trivyignore` inside the folder is honored by the tool, so a repository can hide its own secrets from them.

Secret values stay out of the prompt and the findings. gitleaks runs with `--redact`, and trivy masks values by default. 0 also drops the snippet and any `Match:` line from a secret lead, so the thread sees the rule, the file and the line. The thread can still read the file itself, as it reads any file in the folder. `0 findings import` is unchanged.
FoxGuard ships next to `0`; set `ZERO_FOXGUARD_PATH` to use another copy. Pass `--prepass off` to skip it. `--scanner` adds or replaces scanners (`foxguard`, `semgrep`, `opengrep`, `checkov`); repeat the flag for several. A scanner that is not installed is skipped. A Semgrep rule pack such as `p/default` is downloaded when it runs.

`--rules <file-or-folder>` gives Semgrep or OpenGrep your own rules for the pre-pass. Repeat it for several. The scanner runs only those rules, not its default pack, so add `--scanner semgrep` or `--scanner opengrep`. FoxGuard has its own rule format and does not read them, so `--rules` alone is a usage error.

A rule file is standard Semgrep YAML:

```yaml
rules:
  - id: no-debug-backdoor
    languages: [javascript]
    severity: ERROR
    message: debugBackdoor skips the login check.
    pattern: debugBackdoor(...)
```

```bash
0 scan ~/code/app --scanner semgrep --rules ~/rules/company.yml
```

A hit from your rules is a lead like any other. The scan checks it against the code and records it only when it is real. A finding at the rule's lines gets `ruleSource: "custom"` in JSON and in the SARIF properties, and its description names the rule id. Semgrep prefixes the id with the rule file's folder.

0 never looks for rules in the scanned folder. A `.semgrep` folder there is ignored unless you name it with `--rules`. See [Add your own rules](/ci/#add-your-own-rules) for CI.

| Argument | Required | Description |
| --- | --- | --- |
| `target` | No |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--budget <usd>` | `5` | Stop when the estimated spend reaches this many USD; partial findings are kept |
| `--format <format>` | `md` | Report format: json, md, sarif, html, pdf |
| `-o, --output <file>` | — | Write the report to a file instead of stdout |
| `--fail-on <severity>` | — | Exit 1 when a finding is at or above this severity (critical, high, medium, low, info) |
| `--passes <n>` | `1` | Scan this many times and merge the findings (a scan misses some issues that another run finds); the budget is split between them, up to 5 |
| `--diff <ref>` | — | Review only the files that differ from this git ref (for example origin/main), and what they connect to; an empty diff scans nothing |
| `--prepass <mode>` | `auto` | auto runs the pattern scanners first when they are installed and gives their hits to the scan as leads; off skips them |
| `--scanner <id>` | — | Scanner for the pre-pass (foxguard, semgrep, opengrep, gitleaks, trivy, osv-scanner, checkov); repeat or separate with commas to use several (default: foxguard). gitleaks, trivy and osv-scanner must be installed; secret values are redacted |
| `--rules <file-or-folder>` | — | Semgrep or OpenGrep rules for the pre-pass (a file or a folder); repeat for several. Replaces the default rules and needs --scanner semgrep or opengrep. Rules are never read from the scanned folder unless you name them |
| `--context <file>` | — | Give the scan this file (a threat model, notes on who may do what) as lower-priority background; repeat for several. It can steer what the scan weighs but cannot change how it works |
| `--policy <file-or-folder>` | — | Check the code against these Markdown policies (a file or a folder of .md files) and report pass or fail for each; repeat for several. Runs the policy-check skill |
| `--org-policy <folder>` | — | An organisation's policy folder: evaluated first, and wins when a --policy says otherwise or uses the same id; repeat for several |
| `--repo-context` | — | Also read .0/threat-model.md from the scanned folder as context. Off by default: a change under review can edit that file; in CI pass the base branch's copy with --context instead |
| `--skill <id>` | `scan` | Skill that holds the scan method |
| `--model <model>` | — | Model for the scan thread (default: claude-opus-5-5 with a Claude subscription, otherwise gpt-6-luna) |
| `--batches <mode>` | `auto` | auto reviews a large folder in batches, one thread per group of entry points, and records what each batch covered; on always does; off keeps one thread |
| `--batch-size <n>` | `8` | Entry points one batch reviews (1 to 50); a folder with more than this many is split under --batches auto |
| `--concurrency <n>` | `1` | Batches that run at the same time (1 to 3) |
| `--resume <scan>` | — | Continue the units an earlier batched scan of this folder did not reach (a scan id from its report, or latest); refuses when the git HEAD changed unless --force |
| `--force` | — | With --resume: continue even though the folder's git HEAD changed |
| `--coverage [scan]` | — | Print the coverage ledger of a batched scan of this folder (the latest, or the id given) and exit; --format json for JSON |
| `--allow-partial` | — | Exit by the findings alone (0, or 1 with --fail-on) when the scan stops before it reviews everything; the report still says it is partial |
| `--plan` | — | List the entry points, the batches and a rough cost range for the folder, then exit; calls no model and writes nothing |
| `--timeout <seconds>` | `3600` | Maximum seconds to wait for the scan |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--computer <id>` | — | Use a registered remote computer |
| `--engine <id>` | — |  |
| `--computers-config <path>` | — | Operator computer connection registry JSON file |
| `--engines-config <path>` | — |  |
| `--db-path <path>` | — | Control database of the local engine to attach to |

#### Infrastructure as code

To review Terraform, CloudFormation, Kubernetes manifests, Dockerfiles and GitHub Actions workflows, run Checkov as the pre-pass and load the `iac-review` skill:

```bash
0 scan ~/code/infra --scanner checkov --skill iac-review
```

Checkov flags single settings, such as an open port. The skill follows references between resources: a subnet named private whose route table reaches an internet gateway, a database group that trusts an open group, an `iam:PassRole` on `*`, a workflow that runs pull request code with secrets. Checkov hits are leads, and the thread keeps one only when it can show how it is exploitable.

Install Checkov with `brew install checkov` or `pipx install checkov`, or set `ZERO_CHECKOV_PATH`. Checkov runs with `--skip-download`, so it needs no network. The `iac-review` skill is experimental: on one small benchmark fixture it is not yet shown to beat the plain scan (see the [benchmark](https://github.com/0sec-labs/0security/blob/main/docs/design/benchmark.md)).

`--context <file>` gives the scan a file as lower-priority background, usually the repository's threat model (see [Threat model and policy checks](/threat-model-and-policy/)). The scan checks the rules it states.

0 never reads that file from the scanned folder on its own, because a pull request could edit it to blind the scan. In CI, pass a copy from the base branch. `--repo-context` reads `.0/threat-model.md` from the folder anyway and prints a warning.

`--policy <file-or-folder>` checks the code against Markdown policies with the `policy-check` skill and answers pass, fail or not-applicable for each. `--org-policy <folder>` is an organisation's policy folder. It is evaluated first and wins over `--policy` on the same id or a conflicting rule.

A folder with more than 8 entry points, or more than 150 source files, is reviewed in batches: one thread per group of entry points, each recorded in a coverage ledger. The report states what was reviewed, for example `reviewed 41 of 57 entry points; 16 not reached (budget)`, and the exit code is 3 while anything is not reached. When a scan stops early, it prints what stopped it, how much is left and the command that continues it:

```text
Stopped by the $5 budget; 16 of 57 entry points not reached.
Continue with: 0 scan /home/you/code/app --resume scan-1f3a9c
```

Run that command, or read the ledger with `--coverage`:

```bash
0 scan ~/code/app --resume latest
0 scan ~/code/app --coverage
```

`--batches off` keeps one thread. See [Large repositories](/findings/#large-repositories).

| Argument | Required | Description |
| --- | --- | --- |
| `target` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--budget <usd>` | `5` | Stop when the estimated spend reaches this many USD; partial findings are kept |
| `--format <format>` | `md` | Report format: json, md, sarif, html, pdf |
| `-o, --output <file>` | — | Write the report to a file instead of stdout |
| `--fail-on <severity>` | — | Exit 1 when a finding is at or above this severity (critical, high, medium, low, info) |
| `--passes <n>` | `1` | Scan this many times and merge the findings (a scan misses some issues that another run finds); the budget is split between them, up to 5 |
| `--diff <ref>` | — | Review only the files that differ from this git ref (for example origin/main), and what they connect to; an empty diff scans nothing |
| `--prepass <mode>` | `auto` | auto runs the pattern scanners first when they are installed and gives their hits to the scan as leads; off skips them |
| `--scanner <id>` | — | Scanner for the pre-pass (foxguard, semgrep, opengrep, gitleaks, trivy, osv-scanner); repeat or separate with commas to use several (default: foxguard). gitleaks, trivy and osv-scanner must be installed; secret values are redacted |
| `--rules <file-or-folder>` | — | Semgrep or OpenGrep rules for the pre-pass (a file or a folder); repeat for several. Replaces the default rules and needs --scanner semgrep or opengrep. Rules are never read from the scanned folder unless you name them |
| `--context <file>` | — | Give the scan this file (a threat model, notes on who may do what) as lower-priority background; repeat for several. It can steer what the scan weighs but cannot change how it works |
| `--policy <file-or-folder>` | — | Check the code against these Markdown policies (a file or a folder of .md files) and report pass or fail for each; repeat for several. Runs the policy-check skill |
| `--org-policy <folder>` | — | An organisation's policy folder: evaluated first, and wins when a --policy says otherwise or uses the same id; repeat for several |
| `--repo-context` | — | Also read .0/threat-model.md from the scanned folder as context. Off by default: a change under review can edit that file; in CI pass the base branch's copy with --context instead |
| `--skill <id>` | `scan` | Skill that holds the scan method |
| `--model <model>` | — | Model for the scan thread (default: gpt-6-luna) |
| `--batches <mode>` | `auto` | auto reviews a large folder in batches, one thread per group of entry points, and records what each batch covered; on always does; off keeps one thread |
| `--batch-size <n>` | `8` | Entry points one batch reviews (1 to 50); a folder with more than this many is split under --batches auto |
| `--concurrency <n>` | `1` | Batches that run at the same time (1 to 3) |
| `--resume <scan>` | — | Continue the units an earlier batched scan of this folder did not reach (a scan id from its report, or latest); refuses when the git HEAD changed unless --force |
| `--force` | — | With --resume: continue even though the folder's git HEAD changed |
| `--coverage [scan]` | — | Print the coverage ledger of a batched scan of this folder (the latest, or the id given) and exit; --format json for JSON |
| `--timeout <seconds>` | `3600` | Maximum seconds to wait for the scan |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--computer <id>` | — | Use a registered remote computer |
| `--engine <id>` | — |  |
| `--computers-config <path>` | — | Operator computer connection registry JSON file |
| `--engines-config <path>` | — |  |
| `--db-path <path>` | — | Control database of the local engine to attach to |

### threat-model

Draft the repository's threat model as a file for people to review.

```text
0 threat-model [options] [folder]
```

A thread follows the `threat-model` skill and writes `.0/threat-model.md` in the folder. The file has a summary, what matters most, assets, actors, trust boundaries, entry points, authorization and business rules, data flows and open questions. Front matter holds the date and the commit.

```bash
0 threat-model
0 threat-model ~/code/app --pr
```

The file names only what the thread saw and marks the rest `unknown: confirm with the team`. Running it again updates the file and keeps every section marked `<!-- human -->`.

With `--pr`, the file is committed alone on the branch `0/threat-model` in a separate git work tree, and `gh` opens or updates a pull request. Nothing is merged.

It writes files on this machine, so it needs the local console and rejects `--computer` and `--engine-url`. See [Threat model and policy checks](/threat-model-and-policy/).

| Argument | Required | Description |
| --- | --- | --- |
| `folder` | No |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--pr` | — | Commit the file on the branch 0/threat-model in a separate git work tree and open or update a pull request |
| `--base <branch>` | — | With --pr: the branch to start from and open the pull request against (default: the remote's default branch) |
| `--format <format>` | — | json prints the outcome as JSON |
| `--budget <usd>` | `3` | Stop when the estimated spend reaches this many USD |
| `--model <model>` | — | Model for the thread (default: claude-opus-5-5 with a Claude subscription, otherwise gpt-6-luna) |
| `--timeout <seconds>` | `1800` | Maximum seconds to wait |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--computer <id>` | — | Use a registered remote computer |
| `--engine <id>` | — |  |
| `--computers-config <path>` | — | Operator computer connection registry JSON file |
| `--engines-config <path>` | — |  |
| `--db-path <path>` | — | Control database of the local engine to attach to |

### web

Open the local browser workspace for threads and findings.

```text
0 web [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--db-path <path>` | — | Path to SQLite database |
| `--port <port>` | `48123` | Port to bind; 0 chooses a free loopback port |
| `--host <host>` | `127.0.0.1` | Loopback host to bind (127.0.0.0/8 or ::1) |
| `--asset-dir <path>` | — | Path to the built web app |
| `--dev-url <url>` | — | Loopback Vite server for authenticated frontend hot reload |
| `--team-config <path>` | — | Enable workspace accounts, roles, and shared conversation controls |
| `--engine-token-env <name>` | — | Environment variable holding the engine bearer credential (32–4096 characters) |
| `--engine-workspace <path>` | — | Engine-owned authorized workspace for persistent workflow calls |
| `--engine-allow-apply` | — | Admit explicitly approved patch application in persistent workflow calls |
| `--engine-time-cap <ms>` | — | Server workflow deadline ceiling (default 600000 ms) |
| `--engine-cost-cap <usd>` | — | Server workflow estimated cost ceiling (default $5) |
| `--server-mode` | — | Serve the console to a network behind a TLS proxy: requires sign-in, an allowed-host list and a single node (off by default) |
| `--allowed-host <host...>` | — | Server mode: accepted Host header names (default: only the bind host); also ZERO_ALLOWED_HOSTS |
| `--trusted-proxy <cidr...>` | — | Server mode: proxy addresses or CIDRs whose X-Forwarded-* headers are trusted; also ZERO_TRUSTED_PROXY |
| `--public-url <url>` | — | Server mode: the public https URL of this console (sign-in cookies, single sign-on); also ZERO_PUBLIC_URL |
| `--access-token-env <name>` | — | Server mode: environment variable holding the access token (32+ characters); default ZERO_ACCESS_TOKEN, else one is generated |
| `--shutdown-timeout <seconds>` | — | Server mode: seconds to finish in-flight requests on SIGTERM (default 20) |
| `--ready-json` | — | Emit the bound console URL as machine-readable JSON |
| `--no-open` | — | Do not auto-open a browser |
| `--headless` | — | Serve the API only: no browser, and no web app files needed (use with `0 threads`) |
| `--engines-config <path>` | — | Trusted engine connection registry JSON (default ~/.0/engines.json) |

### api

Call an admitted HTTP API on a running engine without sending a model prompt.

```text
0 api [options] [path]
```

Pick the engine with `--engine <id>` from an operator-managed registry, or with both `--engine-url <url>` and `--engine-token-env <name>`. The path defaults to `/api/backend/handshake` and must be an admitted `/api/` route.

```bash
0 api /api/backend/handshake --engine-url http://127.0.0.1:48123 --engine-token-env ZERO_ENGINE_TOKEN
```

Before it sends the request, 0 checks the engine's identity and advertised capabilities. A missing credential, an unsupported route, a redirect or a capability mismatch fails. It never falls back to local execution.

The default method is GET. For a change, set an explicit method and `--data`. JSON can be inline or `@file`; files and serialized bodies are limited to 1 MB, and GET and HEAD reject bodies. Pass the name of an environment variable for the bearer credential, never the credential itself. The server's authentication and approval checks still apply.

Responses are JSON envelopes with `ok`, HTTP `status` and `data`. Text exports appear as strings. An error exits nonzero and prints a JSON diagnostic on stderr.

A successful request does not mean queued work has finished. Keep the returned resource ID, check its status, and cancel explicitly if needed. The command does not download binaries, stream events or complete browser OAuth consent.

| Argument | Required | Description |
| --- | --- | --- |
| `path` | No | Admitted /api/ route; defaults to /api/backend/handshake. |

| Option | Registered default | Description |
| --- | --- | --- |
| `--method <method>` | `GET` | GET, POST, PATCH, PUT, DELETE or HEAD. Mutations require an explicit method and remain subject to engine authorization and approvals. |
| `--data <json-or-@file>` | — | JSON body, or @regular-file containing JSON (at most 1 MB) |
| `--engine-url <url>` | — | Attach directly to a trusted HTTP engine; requires --engine-token-env and cannot be combined with registered-engine options. |
| `--engine-token-env <name>` | — | Name of the environment variable holding the engine bearer credential, not the credential itself. Required with --engine-url. |
| `--engine <id>` | — | Select an operator-registered HTTP engine; cannot be combined with --engine-url. |
| `--engines-config <path>` | — | Operator engine registry JSON file |

### findings reports

Import retained CI artifacts into a local browser workspace without starting an assessment.

```text
0 findings reports
```

Subcommands: [import](#findings-reports-import) · [export](#findings-reports-export).

#### findings reports import

Read a JSON report and an optional `run.json`, validate them, and keep a passive snapshot in the database you select. Stop any engine using that database first, then open `0 web --db-path <same-path>`. The same report and metadata import once.

Imported findings stay discovered and unverified. Importing does not restore execution state or authorize fixes.

```text
0 findings reports import [options] <report>
```

| Argument | Required | Description |
| --- | --- | --- |
| `report` | Yes | JSON report produced by 0; importing executes no report commands |

| Option | Registered default | Description |
| --- | --- | --- |
| `--metadata <path>` | — | Optional run.json invocation and revision metadata |
| `--db-path <path>` **required** | — | Destination engine database; stop its browser engine before importing |

#### findings reports export

Write a share-safe copy of a JSON report. The copy keeps the target, summary and, for each finding, the id, title, severity, category, status, fingerprint, CVSS, confidence and source location. It drops evidence, PoC steps, agent transcripts, triage notes, suggested code and local absolute paths, and strips credentials, query strings and fragments from URL targets.

Free-text descriptions are left out unless you pass `--include-description`. The command only writes the copy; it sends nothing.

```text
0 findings reports export [options] <report>
```

| Argument | Required | Description |
| --- | --- | --- |
| `report` | Yes | JSON report produced by 0 |

| Option | Registered default | Description |
| --- | --- | --- |
| `--include-description` | — | Include each finding's free-text description (can quote code or secrets) |
| `--output <path>` | — | Write the share-safe report to a file instead of stdout |

### doctor

Check local runtime prerequisites and suggest the next command

```text
0 doctor [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--discard-reports` | — | Delete crash reports waiting for review on this computer |
| `--json` | — | Print JSON |

Subcommands: [upgrade](#doctor-upgrade) · [workbench](#doctor-workbench).

### config

Inspect, export, and import the two-level console configuration

```text
0 config
```

Subcommands: [get](#config-get) · [set](#config-set) · [doctor](#config-doctor) · [show](#config-show) · [list](#config-list) · [reset](#config-reset) · [export](#config-export) · [import](#config-import) · [audit-log](#config-audit-log) · [team](#config-team) · [db](#config-db) · [github](#config-github).

#### config show

Show each setting's effective value and source: default, global, or project.

```text
0 config show [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### config list

Same as `config show`. Add `--json` for each key's value and source layer.

```text
0 config list [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### config get

Print one setting's effective value. `--json` adds the layer it comes from.

```text
0 config get [options] [key]
```

| Argument | Required | Description |
| --- | --- | --- |
| `key` | No |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print JSON with the source layer |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### config set

Change one setting, with the same validation as the Settings page. It writes the global layer unless `--project` is given; operator-global settings refuse `--project`. Security-sensitive settings need `--yes`. Exit code 2 means a bad key or value; 1 means the engine refused the change.

```text
0 config set [options] <key> <value>
```

```bash
0 config set compactionThreshold 85%
0 config set allowModelSelfExtension on --yes
```

| Argument | Required | Description |
| --- | --- | --- |
| `key` | Yes |  |
| `value` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--project` | — | Write the override for this folder |
| `--yes` | — | Confirm a security-sensitive setting |
| `--json` | — | Print JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### config reset

Reset named settings, or every engine setting when none is named, to their defaults. Safety settings never reset to a looser value; the command lists any it kept. Requires `--yes`.

```text
0 config reset [options] [keys...]
```

| Argument | Required | Description |
| --- | --- | --- |
| `keys` | No |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--yes` | — | Confirm the reset |
| `--json` | — | Print JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### config export

Export effective configuration as JSON. Use `--global` for the global layer. Output goes to stdout unless a file is supplied.

```text
0 config export [options] [file]
```

| Argument | Required | Description |
| --- | --- | --- |
| `file` | No |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--global` | — | Export only the global layer instead of the effective config |

#### config import

Merge a shared config into the global (default) or --project layer

```text
0 config import [options] <file>
```

| Argument | Required | Description |
| --- | --- | --- |
| `file` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--project` | — | Import into the override for this folder instead of the global config |
| `--global` | — | Import into the global config (default) |
| `--yes` | — | Accept changes to security-sensitive settings (required to flip them) |

### models connections

Manage model provider connections, the same actions as Settings → Connections in the browser. These commands use a running `0 web` engine when there is one, and otherwise apply the change directly on this computer. Keys are never passed as an argument: use `--key-env` or `--stdin`.

```text
0 models connections
```

```bash
export OPENAI_API_KEY_FOR_0="sk-..."
0 models connections add openai --key-env OPENAI_API_KEY_FOR_0
0 models connections list
0 models connections test openai
0 models connections remove openai --yes
```

Subcommands: [list](#models-connections-list) · [add](#models-connections-add) · [test](#models-connections-test) · [remove](#models-connections-remove).

#### models connections list

List providers with their status and saved accounts. `*` marks the active account.

```text
0 models connections list [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### models connections add

Verify and save an API key for a provider. Exit code 2 means no key source was given; 1 means the provider rejected it.

```text
0 models connections add [options] <provider>
```

| Argument | Required | Description |
| --- | --- | --- |
| `provider` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--key-env <VAR>` | — | Read the API key from this environment variable |
| `--stdin` | — | Read the API key from stdin |
| `--account-id <id>` | — | Name this saved account |
| `--base-url <url>` | — | Custom API endpoint |
| `--model <model>` | — | Deployment model, where required |
| `--json` | — | Print JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### models connections test

Check that a connected provider answers and lists models.

```text
0 models connections test [options] <provider>
```

| Argument | Required | Description |
| --- | --- | --- |
| `provider` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### models connections remove

Remove a provider's saved credentials, or one saved account with `--account`. Requires `--yes`. A key supplied by an environment variable cannot be removed here.

```text
0 models connections remove [options] <provider>
```

| Argument | Required | Description |
| --- | --- | --- |
| `provider` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--account <id>` | — | Remove only this saved account |
| `--yes` | — | Confirm the removal |
| `--json` | — | Print JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

### models

List the models your connected providers offer and choose the default, as on the Models page.

```text
0 models
```

```bash
0 models list --provider openai
0 models default --provider openai gpt-5.4-mini
0 models recommended
```

Subcommands: [list](#models-list) · [set](#models-set) · [connect](#models-connect) · [default](#models-default) · [recommended](#models-recommended) · [connections](#models-connections) · [usage](#models-usage).

#### models list

List models offered by connected providers, with price and context size.

```text
0 models list [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--provider <id>` | — | Only this provider |
| `--json` | — | Print JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### models default

Show the default model, or set it. Setting requires `--provider`, and the provider must be connected.

```text
0 models default [options] [model]
```

| Argument | Required | Description |
| --- | --- | --- |
| `model` | No |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--provider <id>` | — | Provider that serves the model |
| `--json` | — | Print JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### models recommended

Show the recommended model for each role, chosen from your connected providers.

```text
0 models recommended [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

### config github

Check or connect the GitHub account used to publish fixes, as in Settings → Git.

```text
0 config github
```

```bash
0 config github status
0 config github connect --stdin < token.txt
0 config github repos --search api
```

Subcommands: [status](#config-github-status) · [connect](#config-github-connect) · [repos](#config-github-repos).

#### config github status

Show whether GitHub is signed in and which scopes are missing.

```text
0 config github status [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### config github connect

Sign in with a personal access token read from an environment variable or stdin. The token is never printed.

```text
0 config github connect [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--key-env <VAR>` | — | Read the token from this environment variable |
| `--stdin` | — | Read the token from stdin |
| `--json` | — | Print JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### config github repos

List repositories the signed-in account can reach (cached for five minutes).

```text
0 config github repos [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--search <text>` | — | Only names containing this text |
| `--refresh` | — | Bypass the five-minute cache |
| `--json` | — | Print JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

### models usage

Show spend and tokens of the open threads, by model or by thread. Open threads are only tracked by a running `0 web` engine; without one the report is empty.

```text
0 models usage [options]
```

```bash
0 models usage --by thread --json
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--by <model\|thread>` | — | Group by model (default) or list each thread |
| `--json` | — | Print JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

### config audit-log

Show the local log of privileged actions: connection and settings changes, extension installs and denied attempts. The log is append-only.

```text
0 config audit-log [options]
```

```bash
0 config audit-log --q connection --limit 20
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--q <text>` | — | Only events whose action, subject or actor contains this text |
| `--limit <n>` | — | Maximum events to show |
| `--before <id>` | — | Only events older than this id (pagination) |
| `--json` | — | Print JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

### doctor workbench

Set up and inspect the online SmolVM security workbench on Apple Silicon macOS. The local Linux guest contains 0, the security tools and the browser. Docker is not required.

```text
0 doctor workbench
```

Subcommands: [run-agent](#doctor-workbench-run-agent) · [console-agent](#doctor-workbench-console-agent) · [setup](#doctor-workbench-setup) · [status](#doctor-workbench-status) · [providers](#doctor-workbench-providers) · [configure](#doctor-workbench-configure) · [disable](#doctor-workbench-disable).

#### doctor workbench run-agent

Internal entrypoint for the CLI engine inside the workbench guest. Normal commands select it automatically when the workbench profile is on. Outside an admitted guest it is refused.

```text
0 doctor workbench run-agent
```

#### doctor workbench console-agent

Internal entrypoint for the chat engine inside the workbench guest. Use `0 -p` or `0` to start a chat. Outside an admitted guest it is refused.

```text
0 doctor workbench console-agent
```

#### doctor workbench setup

Verify or provision the signed native runtime, approve a local archive by digest, and save the operator-global SmolVM profile.

```text
0 doctor workbench setup [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--image <archive>` | — | Local OCI/Docker archive to digest-pin and approve; never a mutable registry tag |
| `--state <directory>` | — | Private VM state directory (defaults to ~/.0/workbench) |
| `--workspace <directory>` | — | Explicit workspace mount; otherwise each invocation mounts its current directory |
| `--provider <id>` | — | Grant chatgpt-codex requests through the host provider broker; credentials stay on the host |
| `--github` | — | Unsupported: GitHub credential forwarding is refused |
| `--no-github` | — | Revoke the GitHub token grant |
| `--cpus <count>` | — | Guest virtual CPUs |
| `--memory <MiB>` | — | Guest RAM in MiB |
| `--storage <GiB>` | — | Guest private writable storage in GiB |
| `--sandbox-image <reference=archive>` | — | Approve an immutable image reference for brokered isolated container actions; repeat for multiple images |

The supported provider grant is `chatgpt-codex`: model requests go through the host broker and credentials stay on the host. GitHub credential forwarding is refused. The host HOME, SSH configuration and Docker socket are not mounted into the guest.

#### doctor workbench status

Show configuration, native runtime readiness, image approval, effective privacy, network mode, broker resource ceilings and retained guest admission. It does not download or launch a VM or reveal credential values.

```text
0 doctor workbench status [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print machine-readable status (no credential values) |

#### doctor workbench providers

List the exact identifiers accepted by `--provider`; this does not expose credentials.

```text
0 doctor workbench providers
```

#### doctor workbench configure

Replace integration grants or operator-approved sibling image references.

```text
0 doctor workbench configure [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--provider <ids>` | — | Replace provider grants with comma-separated IDs, or none |
| `--github` | — | Enable the explicit GitHub credential grant |
| `--no-github` | — | Revoke the GitHub credential grant |
| `--current-workspace` | — | Mount each invocation's current directory instead of a fixed saved workspace |
| `--sandbox-image <reference=archive>` | — | Add or replace an operator-approved immutable sandbox image reference; repeat for multiple images |
| `--clear-sandbox-images` | — | Revoke all explicit sandbox image-reference grants |

#### doctor workbench disable

Explicitly switch to host-local execution. Approved image and guest state remain.

```text
0 doctor workbench disable
```

### doctor upgrade

Fetch and install the latest release binary for 0 (re-runs install.sh).

```text
0 doctor upgrade [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--version <tag>` | — | Pin a specific release tag (e.g. v0.10.0) |
| `--install-dir <path>` | — | Override the install directory (default: the folder of this binary, else ~/.0/bin) |

## Findings & evidence

### probe

Send adversarial messages to a live model or agent endpoint and report the ones it obeys

```text
0 probe [options] <url>
```

Probe sends ten attacks to the URL you name and reports the ones whose reply shows they worked:

- a user message that overrides the instructions
- fake system markup
- instructions hidden in a document
- instructions encoded in base64
- a role-play jailbreak
- reading out the system prompt
- asking for credentials
- asking for a command to be run
- markdown that leaks data when rendered
- raw HTML in the reply

Each attack carries a unique canary, so a hit is a check on the reply (the canary came back, a credential appeared, `uid=` came back from a command), not another model's opinion. Models vary, so each probe is sent twice by default and one hit counts.

```bash
0 probe https://api.example.com/v1/chat/completions -H "Authorization: Bearer $OPENAI_API_KEY" --format sarif -o probe.sarif
```

The request is an OpenAI-style chat body. For another shape, pass `--body` with `{{prompt}}` where the message goes. 0 finds the reply in common JSON shapes, or at `--response-path`.

Put a key in a header as an environment variable, as above, so it is not typed on the command line. If you pass `--secret` with a secret that is in the endpoint's prompt, a reply that contains it is reported as a definite leak.

Requests are 300 ms apart and capped at 100 by default. Findings go into the usual reports (`--format md|json|sarif|html|pdf`). With `--save` they also appear in `0 findings list`.

A miss means the reply did not show the attack working in those attempts. It does not prove the endpoint is safe against attacks outside the list.

| Argument | Required | Description |
| --- | --- | --- |
| `url` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `-H, --header <header>` | — | Request header, `Name: value`; the value may be $ENV_VAR so a key is not typed on the command line (repeatable) |
| `--body <json>` | — | Request body as JSON with {{prompt}} where the message goes (default: an OpenAI-style chat body) |
| `--body-file <file>` | — | Read the request body from a file |
| `--model <name>` | — | Add this model name to the default chat body |
| `--response-path <path>` | — | Where the reply is in a JSON response, such as choices.0.message.content (default: tried automatically) |
| `--probes <ids>` | — | Only these probes, comma separated (direct-override, delimiter-injection, indirect-document, encoded-instruction, persona-jailbreak, system-prompt-extraction, secret-request, tool-execution, markdown-exfiltration, raw-html-output) |
| `--repeat <n>` | `2` | Times each probe is sent; models vary, and a hit in any attempt counts |
| `--delay <ms>` | `300` | Pause between requests |
| `--timeout <seconds>` | `30` | Seconds to wait for each reply |
| `--max-requests <n>` | `100` | Send at most this many requests |
| `--secret <text>` | — | A secret known to be in the endpoint's prompt; a reply that contains it is a definite leak |
| `--format <format>` | `md` | Report format: json, md, sarif, html, pdf |
| `-o, --output <file>` | — | Write the report to a file instead of stdout |
| `--fail-on <severity>` | — | Exit 1 when a finding is at or above this severity |
| `--save` | — | Also store the findings, so they show in `0 findings list` |

### sbom

Generate an SBOM from lockfiles, check one against known advisories, and scan model files

```text
0 sbom
```

Subcommands: [generate](#sbom-generate) · [check](#sbom-check) · [licenses](#sbom-licenses) · [scan-models](#sbom-scan-models).

#### sbom generate

Write a CycloneDX 1.5 SBOM from the lockfiles in a folder (npm, pnpm, yarn, Cargo, Go, Python, Ruby, PHP, .NET, Maven, Gradle, Dart, Elixir)

```text
0 sbom generate [options] [folder]
```

```bash
0 sbom generate . -o sbom.cdx.json
```

The default `builtin` generator reads these lockfiles as text, anywhere under the folder, and installs or runs nothing: `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `Cargo.lock`, `go.mod`, `poetry.lock`, `Pipfile.lock`, pinned `requirements.txt`, `Gemfile.lock`, `composer.lock`, `packages.lock.json`, `gradle.lockfile`, `pubspec.lock` and `mix.lock`. It skips `node_modules`, build output and hidden folders.

Components are identified by package URL, sorted and de-duplicated, so the same lockfiles give the same SBOM. A component is marked `excluded` only when every lockfile that lists it says it is development-only. A folder with no supported lockfile and nothing unresolved is an error (exit 2).

It also reads Maven and Gradle declarations as text, with the same rules: nothing is run (no `mvn`, no `gradle`), nothing is downloaded, and output is sorted. Components are looked up in OSV as `pkg:maven/<groupId>/<artifactId>@<version>`.

- `pom.xml`: direct dependencies, with versions taken from the literal version, `<properties>`, `<dependencyManagement>`, and a parent POM or imported BOM, but only when that parent or BOM is in the repository (the `relativePath`, or any POM in the folder with the same coordinates and version). Every `pom.xml` under the folder is read, so a multi-module project is aggregated; a child's own properties override its parent's. Modules of the repository are not listed as third-party components, and `test` scope is marked `excluded`.
- `gradle.lockfile`, `gradle/libs.versions.toml` and the dependency lines of `build.gradle` and `build.gradle.kts`: a version is read only when it is a literal. When `gradle.lockfile` pins an artifact, the lockfile's version is used and a declared version of the same artifact is dropped. A version catalog is read as declared, so an entry the build never uses is still listed.

What is not analysed is listed as unresolved, never guessed: profiles (their dependencies and properties), a parent POM or imported BOM that is not in the repository, a version from a property that no POM in the repository defines (including `env.` and system properties), version ranges and `LATEST`/`RELEASE`, a dependency with no managed version, a declared module with no POM, and in Gradle a variable, a dynamic version (`1.+`, a range, `latest.release`), a missing version, a `platform(...)` BOM and an unknown `version.ref`. The final line of `generate` reads `resolved N, unresolved M` (components with a known version, and items skipped), followed by the first 20 skipped items. The SBOM records each as a `0:unresolved` metadata property, and `0 sbom check` prints the same line from them.

This is a declaration reader, not a build. It does not resolve transitive dependencies, private registries or mirrors, or `settings.xml`, and it makes no claim about whether vulnerable code is reachable.

Beyond name and version, the SBOM carries the following, only where the lockfile states it. Nothing is looked up or guessed.

- Hashes (`hashes`, hex): npm `integrity`, pnpm `resolution.integrity`, yarn classic `integrity`, Cargo `checksum`, Composer `dist.shasum` and Gemfile.lock `CHECKSUMS` (Bundler 2.5 and later). A Poetry package with several files or a gem with several platform builds gets no hash, because a component has one hash. Yarn Berry checksums are not reported, because they hash Yarn's cache archive and not the published package. Go, Pipfile, `requirements.txt`, NuGet, Gradle, Dart and Mix get no hash. When two lockfiles disagree on a hash, it is left out.
- Dependency graph (top-level `dependencies`): from npm lockfile v2 and v3, pnpm, yarn classic and Berry, Cargo, Poetry, Gemfile.lock and Composer (platform requirements such as `php` are skipped). A component whose lockfile records a graph and lists no dependencies has an empty `dependsOn`. A component from a lockfile that records no graph (Go, Pipfile, `requirements.txt`, NuGet, Gradle, Dart, Mix, npm lockfile v1) has no entry, which means unknown. The application itself gets no dependencies, so direct versus transitive is not recorded.
- Licenses (`licenses`): from npm lockfile v2 and v3 and Composer. A valid SPDX id is written as `id`, a valid SPDX expression as `expression`, and anything else as the `name` exactly as stated. Other lockfiles state no license, and 0 does not fetch licenses from registries.

The supplier of each component is not recorded.

Add `--ai` to also list the AI in the folder as CycloneDX components:

- model files (`.gguf`, `.safetensors`, `.onnx`, `.pt`, `.pth`, `.ckpt`, `.pkl` and others), with pickle-based formats flagged
- hub references in code (`from_pretrained`, `pipeline(..., model=)`, `hf_hub_download`, `load_dataset`)
- hosted model ids passed to provider SDKs, with the provider
- MCP servers from `.mcp.json` and similar files, with an unpinned launcher such as `npx -y` flagged

The scan reads files as text and downloads nothing. A reference the patterns do not recognise is missed, so treat the list as what was seen, not a complete inventory.

The builtin generator does not read CocoaPods, SwiftPM, C and C++ package managers, operating-system packages or compiled binaries. Use `--generator` for those, and `--generator` with `--image` for container images.

`--format spdx` writes SPDX 2.3 JSON instead (builtin generator only). It has one package for the application and one per library, each with its package URL as a `purl` external reference, its checksums, and its license when that is an SPDX id or expression. Free-text license names become `NOASSERTION`. `DESCRIBES` points at the application and `DEPENDS_ON` follows the graph above. The AI inventory is not written to SPDX, and `--ai` is refused with it.

`--generator syft`, `cdxgen` or `trivy` runs that installed tool instead and writes its CycloneDX JSON unchanged. Use it for what the builtin reader does not cover, such as transitive Maven and Gradle resolution, operating-system packages and binaries. `--ai` and `--format spdx` are not available with these tools.

To describe a container image, pass `--image` with `syft` or `trivy`. The value is a reference such as `nginx:1.25`, the path of a `docker save` archive, or the path of an OCI image layout folder. Then check the result against known advisories:

```bash
0 sbom generate --generator syft --image nginx:1.25 -o img.cdx.json
0 sbom check img.cdx.json
```

syft or trivy reads the image, from your local Docker daemon or by pulling it from a registry. 0 does not unpack layers itself, so the SBOM is only as complete as that tool's catalogue. `--image` is refused with the builtin generator and with cdxgen, with a folder argument, and with a value that starts with `-`, has spaces, or names a folder that is not an OCI layout. 0 passes the reference after `--`, so it cannot be read as an option.

0 starts the tool without a shell, on the folder as an absolute path, with a 10 minute timeout and a temporary working directory. It executes nothing from the scanned folder itself. If the tool is not installed, 0 prints how to install it and exits 2. The tool's own behaviour, such as network access, is its own. The commands are:

```text
syft dir:<folder> -o cyclonedx-json
cdxgen --lifecycle pre-build --no-install-deps -o <temp file> <folder>
trivy fs --format cyclonedx --quiet <folder>
syft -o cyclonedx-json -- <image>
trivy image --format cyclonedx --quiet -- <image>
```

The two cdxgen flags keep it from running the project's package manager. These tools write CycloneDX 1.7, not 1.5, and their component counts differ from the builtin reader, because each also walks the other trees in the folder. Whether trivy fetches its vulnerability database on a first run, and how older cdxgen versions treat those flags, is not verified.

| Argument | Required | Description |
| --- | --- | --- |
| `folder` | No | Folder to read lockfiles from (default: .) |

| Option | Registered default | Description |
| --- | --- | --- |
| `-o, --output <file>` | — | Write the SBOM to a file instead of stdout |
| `--name <name>` | — | Name of the application the SBOM describes (default: the folder's name) |
| `--generator <tool>` | `builtin` | Who writes the SBOM: builtin (reads lockfiles; default), syft, cdxgen, trivy (run the installed tool; exit 2 if it is missing) |
| `--format <format>` | `cyclonedx` | Output format: cyclonedx (1.5, default) or spdx (2.3 JSON; builtin generator only) |
| `--image <reference-or-archive>` | — | Describe a container image instead of a folder: a reference such as nginx:1.25, or the path of a docker save archive or OCI layout. Needs --generator syft or trivy, which pulls the image |
| `--ai` | — | Also list the AI in the folder: models, datasets, hosted model ids and MCP servers, found by reading files as text |

#### sbom check

Look every component of an SBOM up in the public OSV database and list the advisories

```text
0 sbom check [options] <file>
```

Each advisory is listed under its component with its aliases, severity, the version that fixes it and a one-line summary, most severe first. Exit 0 when there are no advisories and 1 when there are, so a scheduled job can fail or open an issue.

```bash
0 sbom generate . -o sbom.cdx.json
0 sbom check sbom.cdx.json
```

```text
lodash 4.17.15  pkg:npm/lodash@4.17.15
  GHSA-35jh-r3h4-6jhm (CVE-2021-23337)  high (CVSS 7.2)  Fixed in 4.17.21.
    Command Injection in lodash
```

The fixed version is the lowest version above the installed one that the advisory names for that package. If the advisory names none, the line says `No fixed version known.` Severity comes from the database's own label, or from a CVSS 3 vector when there is no label. A record with neither, or with only a CVSS 4 vector, shows `unknown`.

A package that OSV lists as malicious (an id that starts with `MAL-`) is shown as `MALICIOUS PACKAGE` at critical severity, under a banner line. Remove it, and treat any machine or pipeline that installed it as compromised. It makes the exit code 1 like any advisory.

`--format sarif` writes one result per vulnerable component and advisory. The rule id is the advisory id, the level follows severity, and the message names the fixed version. The location is the lockfile the component came from when the SBOM records it (`0 sbom generate` does), and the SBOM file otherwise. Write it to a file and import it:

```bash
0 sbom check sbom.cdx.json --format sarif -o deps.sarif
0 findings import deps.sarif
```

Importing the same results again changes nothing. `--format json` writes the advisories with their fixed version, severity and a `malicious` flag.

Add `--outdated` to also list components that have a newer version. This looks each package up at `https://api.deps.dev`, so package names go out. It checks at most 200 components, runtime dependencies first, and says how many it skipped. Each note shows the latest version and how far behind the installed one is. A newer version is information only. It does not mean the installed one is unsafe, and it never changes the exit code.

The network use is the lookup at `https://api.osv.dev`: package URLs go out and nothing else does.

| Argument | Required | Description |
| --- | --- | --- |
| `file` | Yes | CycloneDX SBOM (JSON), for example from `0 sbom generate` |

| Option | Registered default | Description |
| --- | --- | --- |
| `--format <format>` | `text` | Output: text, json or sarif (SARIF imports with `0 findings import`) |
| `-o, --output <file>` | — | Write the result to a file instead of stdout |
| `--outdated` | — | Also list components with a newer version (looks packages up at https://api.deps.dev; information only, not a vulnerability) |

#### sbom licenses

Check the licenses in an SBOM, or in a folder's lockfiles, against an allow or deny policy

```text
0 sbom licenses [options] [sbom-file-or-folder]
```

```bash
0 sbom licenses . --preset permissive
0 sbom licenses sbom.cdx.json --deny 'GPL-*,AGPL-*' --format sarif > licenses.sarif
0 sbom licenses . --policy license-policy.yaml --resolve
```

Pass a CycloneDX SBOM file, or a folder. For a folder, 0 reads the lockfiles as in [sbom generate](#sbom-generate) and checks the result. The output lists each component as denied, not allowed, unknown or allowed. The output and this page are information from lockfiles and registries. They are not legal advice.

Components with no license data are unknown. Only npm lockfiles (`package-lock.json` v2 and v3) and `composer.lock` state licenses. A pnpm, yarn, Cargo, Go, Python, Ruby or NuGet lockfile gives none, so a check of such a repository is mostly unknown until you add `--resolve`. 0 prints a notice when more than half the components are unknown.

`--resolve` looks up each component that states no license on [deps.dev](https://deps.dev). It sends the package name and version and nothing else, makes up to 8 requests at a time, and stops after `--resolve-limit` components (default 2000). It covers npm, Cargo, Go, PyPI, RubyGems, NuGet and Maven. Components from other ecosystems stay unknown. Looked-up components are marked `[deps.dev]`.

On this repository, a check with `--preset permissive` found 1088 of 1107 components unknown. With `--resolve` 11 stayed unknown, 30 were not allowed (LGPL, MPL-2.0, OFL-1.1, CC-BY-4.0 and Unicode-3.0 licenses) and 1066 were allowed.

| Argument | Required | Description |
| --- | --- | --- |
| `sbom-file-or-folder` | No | CycloneDX SBOM (JSON), or a folder to read lockfiles from |

| Option | Registered default | Description |
| --- | --- | --- |
| `--preset <name>` | — | Start from a preset: permissive or no-copyleft |
| `--policy <file>` | — | Policy file (JSON or YAML): allow, deny, allowByPackage (with a reason), unknown |
| `--allow <ids>` | — | Comma list of SPDX ids to allow; any license not listed is not allowed |
| `--deny <ids>` | — | Comma list of SPDX ids to deny; a trailing * matches a family, for example GPL-* |
| `--unknown <mode>` | — | What a component with no usable license data does: warn (default), fail or allow |
| `--resolve` | — | Look up the license of components that state none on deps.dev (network; sends package names and versions) |
| `--resolve-limit <n>` | — | With --resolve, look up at most this many components (default 2000) |
| `--exclude-dev` | — | Skip components that are development-only |
| `--format <format>` | `text` | Output: text, json or sarif |

##### Write a policy

A policy is an allow list, a deny list, exceptions and a rule for unknown licenses. Start from a preset, a policy file, or the `--allow` and `--deny` flags. They combine: lists are joined, and a license on the deny list is denied even if it is also allowed.

- `--preset permissive` allows MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Unlicense, CC0-1.0, Zlib, BlueOak-1.0.0 and Python-2.0. Every other license is not allowed. Unknown is `warn`.
- `--preset no-copyleft` denies the GPL, AGPL, LGPL, SSPL and EUPL families. Every other license is allowed. Weak copyleft such as MPL-2.0, EPL-2.0 and CC-BY-SA is not denied. Unknown is `warn`.

A policy file is JSON or YAML:

```yaml
# license-policy.yaml
preset: no-copyleft
allow: []
deny:
  - SSPL-*
  - CC-BY-NC-4.0
allowByPackage:
  - package: pkg:npm/some-library
    version: 2.1.0
    reason: Dual-licensed, we use it under MIT.
  - package: internal-tool
    licenses: [LGPL-3.0-or-later]
    reason: Linked dynamically and not distributed.
unknown: warn
```

- `allow` and `deny` hold SPDX ids. Ids are case-sensitive. An id ending in `*` matches a family, for example `GPL-*`. `GPL-2.0-only WITH Classpath-exception-2.0` names a license with an exception, and it beats a rule about the license alone.
- If `allow` has any entry, every license not listed is not allowed. Without an allow list, every license not denied is allowed.
- `allowByPackage` waives one component, named by name, package URL or package URL with version. `reason` is required. With `licenses`, the entry allows only those ids for that component instead of waiving it.
- `unknown` is `warn` (listed, exit 0), `fail` (listed, exit 1) or `allow` (counted only). The flag `--unknown` overrides the file.

An unrecognised key or id is a usage error, so a typo does not weaken the policy.

##### How licenses are judged

0 evaluates SPDX expressions. In `MIT OR Apache-2.0` you choose, so one allowed side is enough. In `GPL-2.0-only AND MIT` you need both, so both must be allowed. A deny applies to an `OR` only when every side is denied. `GPL-2.0+` and `GPL-2.0-or-later` are the same license, as are `GPL-2.0` and `GPL-2.0-only`. For other licenses, `Apache-2.0+` counts as `Apache-2.0`. Operators are upper case.

A component that lists several licenses as separate entries is treated as needing all of them, because CycloneDX does not say whether they are alternatives. Write an expression with `OR` if you mean a choice.

A license `name` in free text, an `id` that is not on the SPDX list, and an expression 0 cannot parse are unknown. 0 does not match them against ids, so `{ "license": { "name": "MIT" } }` is unknown.

Use `--exclude-dev` to skip components that are development-only. A violation is a denied or not-allowed component, or an unknown one when `unknown` is `fail`. 0 exits 1 on any violation, 0 otherwise, and 2 on a usage error.

`--format json` lists every component with its verdict. `--format sarif` writes one result per violating component, and per unknown component unless `unknown` is `allow`. The rule id is `license/<spdx-id>` (`license/unknown` for unknown), the location is the lockfile that lists the component (the SBOM file when you pass one), and the fingerprint is stable between runs. Import it with `0 findings import licenses.sarif`.

#### sbom scan-models

Scan model files (pickle, PyTorch, joblib, numpy) for imports that can run code when loaded

```text
0 sbom scan-models [options] <path>
```

```bash
0 sbom scan-models ./models
```

Pickle-based model files (`.pkl`, `.pickle`, `.joblib`, `.pt`, `.pth`, `.ckpt`, `.bin`, `.npy`, `.npz`, including the `data.pkl` inside a PyTorch zip) run the callables they reference when they are loaded. This command reads the files as bytes and sorts every imported callable into three groups:

- dangerous: `os.system`, `subprocess.*`, `builtins.eval`/`exec`/`__import__`/`open`, `importlib.*`, `socket.*`, `shutil.*`, network clients, `ctypes.*`, nested `pickle.loads`/`torch.load` and similar
- expected: tensor rebuild helpers, storages, `collections.OrderedDict`, numpy array reconstruction and the like
- unrecognised: on neither list, reported at lower severity because libraries such as scikit-learn pickle their own classes

Nothing is loaded, imported or executed, and no Python is needed. The format comes from the content, not the extension, so a pickle renamed `.safetensors` is still scanned. Large payloads are skipped without being read, a zip bomb is reported and not inflated, archive member names are never extracted, and a truncated or malformed file is reported as an incomplete scan.

Each file is listed with its format, a verdict (`DANGEROUS`, unrecognised imports, no dangerous imports found, not a pickle format, not scanned) and the offending imports. Safetensors and TFLite are reported as formats that cannot execute code. GGUF and ONNX are reported as not pickle formats. Keras `.h5` and `.keras` files are not scanned, because they can embed Python code.

"No dangerous imports found" means exactly that. The scanner can miss what it cannot parse, and the result does not say a file is safe or that the weights are trustworthy.

`--format sarif` writes one result per dangerous file, located at the file. Exit 1 when any file is dangerous and 2 on a usage error. `0 sbom generate --ai` adds a `0:risk` property to a model file in the inventory when this scan finds it dangerous.

| Argument | Required | Description |
| --- | --- | --- |
| `path` | Yes | A model file, or a folder to search for model files |

| Option | Registered default | Description |
| --- | --- | --- |
| `--format <format>` | `text` | Output: text, json or sarif |

### findings

Browse and manage persisted findings

```text
0 findings [options]
```

Triage (`new`, `accepted`, `suppressed`) and verification are separate states. Accepting a finding records your decision; reproduction and fix verification are separate steps.

Subcommands: [list](#findings-list) · [show](#findings-show) · [update](#findings-update) · [import](#findings-import) · [fix](#findings-fix) · [burndown](#findings-burndown) · [verify](#findings-verify) · [evidence](#findings-evidence) · [report-draft](#findings-report-draft) · [accept](#findings-accept) · [suppress](#findings-suppress) · [reopen](#findings-reopen) · [export](#findings-export) · [keys](#findings-keys) · [upload](#findings-upload) · [issues](#findings-issues) · [reports](#findings-reports).

| Option | Registered default | Description |
| --- | --- | --- |
| `--db-path <path>` | — | Path to SQLite database |
| `--scan <scanId>` | — | Filter by scan ID |
| `--severity <severity>` | — | Filter by severity: critical, high, medium, low, info |
| `--category <category>` | — | Filter by attack category |
| `--status <status>` | — | Filter by status: discovered, verified, confirmed, scored, reported, fixed, false-positive |
| `--triage <triage>` | — | Filter by triage: new, accepted, suppressed |
| `--limit <n>` | `50` | Max findings/groups to show |
| `--all` | `false` | Show raw finding rows instead of grouped fingerprints |

#### findings list

List findings from the database

```text
0 findings list [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--all` | — | Show raw finding rows instead of grouped fingerprints |
| `--db-path <path>` | — | Path to SQLite database |
| `--scan <scanId>` | — | Filter by scan ID |
| `--severity <severity>` | — | Filter by severity: critical, high, medium, low, info |
| `--category <category>` | — | Filter by attack category |
| `--status <status>` | — | Filter by status: discovered, verified, confirmed, scored, reported, fixed, false-positive |
| `--triage <triage>` | — | Filter by triage: new, accepted, suppressed |
| `--limit <n>` | — | Max findings/groups to show |

#### findings show

Show detailed information about a finding

```text
0 findings show [options] <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes | Finding ID (full or prefix) |

| Option | Registered default | Description |
| --- | --- | --- |
| `--db-path <path>` | — | Path to SQLite database |
| `--json` | — | Print JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### findings accept

Mark a finding family as accepted

```text
0 findings accept [options] <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes | Finding ID (full or prefix) |

| Option | Registered default | Description |
| --- | --- | --- |
| `--db-path <path>` | — | Path to SQLite database |
| `--note <text>` | — | Optional triage note |

#### findings suppress

Suppress a finding family across duplicate occurrences

```text
0 findings suppress [options] <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes | Finding ID (full or prefix) |

| Option | Registered default | Description |
| --- | --- | --- |
| `--db-path <path>` | — | Path to SQLite database |
| `--note <text>` | — | Suppression reason |

#### findings reopen

Reset a finding family back to new

```text
0 findings reopen [options] <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes | Finding ID (full or prefix) |

| Option | Registered default | Description |
| --- | --- | --- |
| `--db-path <path>` | — | Path to SQLite database |
| `--note <text>` | — | Optional triage note |

#### findings import

Import findings from another scanner's SARIF 2.1.0 file (use - for stdin). Nothing in the file is executed.

```text
0 findings import [options] [file]
```

```bash
0 findings import results.sarif
0 findings import --github acme/app
```

Each result becomes a finding that keeps the scanner's name, rule, severity, CWE and file and line. The scan it creates is marked imported and unverified, and importing the same file again changes nothing. Absolute paths become repo-relative under `--root`; paths outside it are dropped. Stop a running console on the same database first.

`--github owner/repo` imports that repository's code scanning, Dependabot and secret scanning alerts instead of a file. Give a file or `--github`, not both.

It runs `gh api` with your own `gh auth login` session, so the token never reaches 0 and the 0 GitHub connector is not used. Your repository access limits the result. `--types` picks the alert kinds, `--state` the alert state (`open`, `dismissed`, `fixed` or `all`) and `--ref` narrows code scanning to a branch. A kind that is switched off for the repository is skipped with a warning.

If a later page fails, returns invalid JSON or the 20-page limit is reached, the alerts read so far are still imported, marked incomplete, with a warning on stderr. A failed fetch makes the command exit 1. Running it again imports again when an alert changed on GitHub.

Secret alerts record the type, validity and, for the first 50 alerts, the file and line of the first location. The secret value is never requested or stored. Alert text is stripped of control characters and shortened before it is stored.

| Argument | Required | Description |
| --- | --- | --- |
| `file` | No | SARIF file, or - to read standard input |

| Option | Registered default | Description |
| --- | --- | --- |
| `--github <owner/repo>` | — | Import code scanning, Dependabot and secret scanning alerts from a GitHub repository, read with your own `gh` login (gh auth login); the 0 GitHub connector is not used |
| `--state <state>` | `open` | Filter alerts by state: open, dismissed, fixed, all |
| `--types <types>` | `all` | Comma-separated alert kinds: code-scanning, dependabot, secret-scanning, all |
| `--ref <branch>` | — | Filter code-scanning alerts by branch or git ref |
| `--tool <name>` | — | Label for the scanner, overriding the name in the file |
| `--root <dir>` | — | Folder that was scanned; absolute paths under it become repo-relative (default: the current directory) |
| `--db-path <path>` | — | Destination database; stop its running console before importing |
| `--format <format>` | `text` | Output format: text or json |

#### findings fix

Fix one finding in an isolated git work tree and open a pull request for review

```text
0 findings fix [options] <finding>
```

```bash
0 findings fix 3f2a --test "pnpm test"
```

A thread follows the `fix-finding` skill in a separate git work tree, so your checkout is never touched. It makes the smallest change it can. Then the command runs each `--test` check, commits on a branch named `0/fix-<id>` and opens a pull request, as a draft when a check fails. Running it again for the same finding updates the same pull request.

Nothing is pushed to the base branch and nothing is merged. A person reviews and merges. Use `--test` for the project's tests and, to re-run the scanner that raised the finding, its own command (for example `foxguard .`). The command edits files on this machine, so it needs the local console and rejects `--computer` and `--engine-url`.

Exit codes:

- 0: a verified change, or committed with `--no-pr`
- 1: no change, or a failed check
- 2: usage error
- 3: stopped at the budget or time limit

A fix policy (approved libraries, forbidden patterns, rules, notes; JSON or YAML) can steer the thread. It comes only from `--policy <file>` or from your own `~/.0/fix-policy.json|yaml|yml`.

A policy file inside the repository being fixed is not read unless you pass `--repo-policy`, because whoever controls the repository would then control the prompt. `--repo-policy` prints a warning, and a file that links outside the repository is refused. The policy is lower-priority guidance: the rules to never commit, push or merge override it.

| Argument | Required | Description |
| --- | --- | --- |
| `finding` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--repo <dir>` | — | Git repository the finding is in (default: the current directory) |
| `--base <branch>` | — | Branch to start from and open the pull request against (default: the remote's default branch) |
| `--test <command>` | — | Check to run after the change; repeat for several. A failing check makes the pull request a draft |
| `--policy <file>` | — | Policy file (.json or .yaml) of approved libraries and fix rules; any path you name, relative to the current directory. Default: ~/.0/fix-policy.json\|yaml\|yml |
| `--repo-policy` | — | Also read fix-policy.* or .zero/fix-policy.* from the repository being fixed (untrusted content; off by default) |
| `--no-pr` | — | Commit on the fix branch but do not push or open a pull request |
| `--budget <usd>` | `3` | Stop when the estimated spend reaches this many USD |
| `--model <model>` | — | Model for the fix thread (default: claude-opus-5-5 with a Claude subscription, otherwise gpt-6-luna) |
| `--timeout <seconds>` | `1800` | Maximum seconds to wait for the fix |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--computer <id>` | — | Use a registered remote computer |
| `--engine <id>` | — |  |
| `--computers-config <path>` | — | Operator computer connection registry JSON file |
| `--engines-config <path>` | — |  |
| `--db-path <path>` | — | Control database of the local engine to attach to |

#### findings report-draft

Write a draft early warning, notification or final report about one finding (Markdown; nothing is sent)

```text
0 findings report-draft [options] <finding>
```

Use this when a manufacturer has to tell the authorities about an actively exploited vulnerability (Article 14 of the Cyber Resilience Act, Regulation (EU) 2024/2847). Confirm the current requirements and deadlines yourself.

The text is built without a model. Each field is copied from the finding record (title, severity, category, location, status, triage state, creation time, and the attacker-impact sentence when someone assessed it), taken from a fact you pass with a flag or in a `--facts` JSON file, or left as `[to be completed by the manufacturer: ...]`. Nothing says the vulnerability is exploited, that users are affected or that a fix exists unless you supplied it.

`--evidence-file` lists a file's name, size and SHA-256 and never copies its content. `--stage all` writes the three stages one after another. The finding can be a full id, an id prefix, or `fp:` plus a fingerprint prefix from `0 findings list`.

The draft says that a person must review it and submit it through the authority's own channel. 0 submits nothing.

| Argument | Required | Description |
| --- | --- | --- |
| `finding` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--stage <stage>` **required** | — | early-warning, notification, final or all |
| `--product <name>` | — | Product name |
| `--manufacturer <name>` | — | Legal name of the manufacturer |
| `--contact <text>` | — | Who submits the report and how to reach them |
| `--affected-versions <text>` | — | Affected product versions |
| `--exploited-since <when>` | — | When exploitation is known to have started |
| `--exploitation-evidence <text>` | — | How you know it is being exploited |
| `--malicious-actor <text>` | — | Suspected malicious act or actor, if known |
| `--member-states <text>` | — | Member States where the product is available |
| `--mitigation <text>` | — | Mitigation taken or recommended |
| `--user-measures <text>` | — | What users can do now |
| `--corrective-measure <text>` | — | The fix or update available to users |
| `--corrective-measure-date <when>` | — | When the corrective measure became available |
| `--evidence-file <file>` | — | Name and SHA-256 of a supporting file (its content is never copied); repeat for several |
| `--facts <file>` | — | JSON file with the same facts (camelCase keys, for example affectedVersions); flags win |
| `-o, --output <file>` | — | Write to a file instead of stdout |
| `--db-path <path>` | — | Path to SQLite database |

#### findings evidence

Write one folder of findings, SARIF, SBOM and fix branches, with a README that says what it does and does not show

```text
0 findings evidence [options] <folder>
```

The folder holds:

- `README.md`
- `manifest.json`: version, date, commit, models and the SHA-256 of each file
- `findings.json` and `findings.md`: severity, status, triage state and note, timestamps, location
- `findings.sarif`
- `sbom.cdx.json`, from the lockfiles in `--repo`
- `fixes.md`: the fix branches that exist in `--repo`
- `advisories.json` from the public OSV database, only with `--check-advisories`

That lookup is the only network use. Evidence and proof-of-concept bodies are left out unless you pass `--include-evidence`. With it, the folder can hold working exploit details.

The command writes only those file names. It refuses a folder that holds other files, a symbolic link, or a folder inside the repository, and it removes a file of its own from an earlier run that it did not write this time.

The README makes no claim of compliance. The folder is evidence for your own records, not a conformity assessment.

| Argument | Required | Description |
| --- | --- | --- |
| `folder` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--repo <folder>` | — | Repository the findings are about: adds the SBOM, the commit and the fix branches |
| `--check-advisories` | — | Look the SBOM components up in the public OSV database (the only network use) |
| `--include-evidence` | — | Also write evidence and proof-of-concept bodies (can contain working exploit details) |
| `--scan <id>` | — | Only the findings of this scan |
| `--name <name>` | — | Name of the application the SBOM describes (default: the repository folder's name) |
| `--db-path <path>` | — | Path to SQLite database |
| `--json` | — | Print the result as JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |
#### findings burndown

Work through open findings in batches: one fix branch and pull request each, then a report

```text
0 findings burndown [options]
```

Burndown selects open findings (not fixed, false positive, accepted or suppressed; one per fingerprint, worst severity first) and runs each through the same flow as [findings fix](#findings-fix): its own git work tree, a branch named `0/fix-<id>`, your `--test` checks, and one pull request, a draft when a check fails. Nothing is pushed to the base branch and nothing is merged.

Filter with `--severity`, `--category`, `--tool` (or `--source`), `--scan` and `--fingerprint`. Size a batch with `--limit`.

`--concurrency` (1 to 4) runs fixes side by side, each in its own work tree. `--budget` is the total for the run and `--per-fix` caps one fix. The cap shrinks to what is left of the total, and no fix starts once it is spent.

The run stops when `--max-consecutive-failures` fixes fail in a row, or when the share of failures goes above `--max-failure-rate` after `--min-attempts` fixes. A fix fails when the thread changes nothing, errors, or a check fails.

Run the same command again to continue: findings that already have a pull request (or, with `--no-pr`, a committed branch) are skipped. `--retry` works on them again. `--dry-run` shows the plan and changes nothing.

The report lists what was proposed, committed, opened or updated as pull requests (with links), which checks passed, drafts because a check failed, skipped findings with the reason, cost and time. `--format json` prints it as JSON. Each run also adds a row of metrics (findings attempted, fixes proposed, check result, cost, duration) that `--history` lists.

Burndown edits files on this machine, so it needs the local console and rejects `--computer` and `--engine-url`.

Exit codes:

- 0: every attempted fix is verified, or there was nothing to do
- 1: a fix failed, or the run stopped on failures
- 2: usage error
- 3: the total budget ran out

| Option | Registered default | Description |
| --- | --- | --- |
| `--severity <levels>` | — | Only these severities (critical, high, medium, low, info; comma-separated) |
| `--category <category>` | — | Only this category |
| `--tool <name>` | — | Only findings reported by this tool |
| `--source <name>` | — | Alias of --tool |
| `--scan <id>` | — | Only findings of this scan (id prefix) |
| `--fingerprint <prefix>` | — | Only findings whose fingerprint or id starts with this |
| `--limit <n>` | — | Attempt at most this many findings in this run; the next run continues with the rest |
| `--repo <dir>` | — | Git repository the findings are in (default: the current directory) |
| `--base <branch>` | — | Branch to start from and open pull requests against (default: the remote's default branch) |
| `--test <command>` | — | Check to run after each change; repeat for several. A failing check makes the pull request a draft |
| `--no-pr` | — | Commit on the fix branches but do not push or open pull requests |
| `--concurrency <n>` | `1` | Fixes at the same time, each in its own work tree (1 to 4) |
| `--budget <usd>` | `10` | Total spend for this run in USD; no new fix starts once it is used |
| `--per-fix <usd>` | `3` | Spend cap for one fix, in USD |
| `--max-consecutive-failures <n>` | `3` | Stop after this many failed fixes in a row |
| `--max-failure-rate <fraction>` | `0.5` | Stop when the share of failed fixes is above this (after --min-attempts) |
| `--min-attempts <n>` | `4` | Fixes to attempt before the failure share can stop the run |
| `--model <model>` | — | Model for the fix threads (default: claude-opus-5-5 with a Claude subscription, otherwise gpt-6-luna) |
| `--timeout <seconds>` | `1800` | Maximum seconds to wait for one fix |
| `--retry` | — | Work again on findings that already have a fix branch or pull request |
| `--dry-run` | — | List what would be attempted and skipped; change nothing |
| `--history` | — | List the metrics row of each earlier run and exit |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--computer <id>` | — | Use a registered remote computer |
| `--engine <id>` | — |  |
| `--computers-config <path>` | — | Operator computer connection registry JSON file |
| `--engines-config <path>` | — |  |
| `--db-path <path>` | — | Control database of the local engine to attach to |

#### findings verify

Experimental: re-check findings with a fresh thread each and record a verdict next to them

```text
0 findings verify [options] [finding...]
```

Verify re-checks findings the way a second reviewer would. Each finding gets its own thread, or with `--batch` a few findings of one file share one. The thread gets only the finding's title, location, category, description and claimed impact, never the scan that produced it. It follows the experimental `verify-finding` skill: it reads the code, traces the input from an entry point to the sink, looks for a control, and builds a concrete attack or says it cannot. It answers true-positive, false-positive, fixed, uncertain or duplicate (a duplicate is only found inside a batch) with reasoning that cites `path:line`, and an advisory severity.

Pass the folder that was scanned with `--folder` (default: the current directory). A finding whose file is not in that folder is skipped with a reason. Name findings by id or id prefix, or select them with `--severity`, `--category` and `--tool`. Findings that are suppressed, fixed or marked false positive are skipped, and so are findings that already have a verdict unless you pass `--force`. `--limit` caps a run; the next run continues with the rest.

The verdict is stored next to the finding by its id. [findings list](#findings-list) and [findings show](#findings-show) print it, for example `verified: likely false positive`. Severity and status do not change, and the advisory severity is kept apart from the finding's own. A thread that returns no verdict for a finding is recorded as uncertain with the reason `no verdict returned`. A thread that fails to run stores nothing, so the next run tries it again.

`--apply` never suppresses a critical or high finding. It suppresses a lower-severity finding only when the verdict is false-positive and it names a control at `path:line` that exists in the folder and the reasoning cites a `path:line` too. The suppression note starts with `False positive (model-verified):` and `0 findings reopen` undoes it. Without `--apply` no status changes.

`--budget` is the total for the run and `--per-finding` caps one finding. `--concurrency` (1 to 3) runs threads side by side. The run stops when `--max-consecutive-failures` threads in a row return no verdict, or when the budget is spent. `--dry-run` lists what would be checked. `--format json` prints the report with counts per verdict, the reasoning, the cost and what `--apply` did.

Verify reads files on this machine, so it needs the local console and rejects `--computer` and `--engine-url`.

Exit codes:

- 0: done
- 1: a check returned no verdict, or the run stopped on failures
- 2: usage error
- 3: the total budget ran out

| Option | Registered default | Description |
| --- | --- | --- |
| `--folder <dir>` | — | The folder that was scanned; the threads read the code there (default: the current directory) |
| `--severity <levels>` | — | Only these severities (critical, high, medium, low, info; comma-separated) |
| `--category <category>` | — | Only this category |
| `--tool <name>` | — | Only findings reported by this tool |
| `--scan <id>` | — | Only findings of this scan (id prefix) |
| `--limit <n>` | — | Check at most this many findings in this run; the next run continues with the rest |
| `--force` | — | Check findings again that already have a verdict |
| `--apply` | — | Suppress findings called false-positive when the verdict cites a control at path:line (default: never change a status) |
| `--batch <n>` | `1` | Findings in one file that share a thread (1 to 5) |
| `--concurrency <n>` | `1` | Threads at the same time (1 to 3) |
| `--budget <usd>` | `2` | Total spend for this run in USD; no new thread starts once it is used |
| `--per-finding <usd>` | `0.3` | Spend cap for one finding, in USD |
| `--max-consecutive-failures <n>` | `3` | Stop after this many checks in a row that return no verdict |
| `--model <model>` | — | Model for the threads (default: claude-opus-5-5 with a Claude subscription, otherwise gpt-6-luna) |
| `--timeout <seconds>` | `600` | Maximum seconds to wait for one thread |
| `--dry-run` | — | List what would be checked and skipped; change nothing |
| `--format <format>` | — | Output: text or json Choices: text, json. |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--computer <id>` | — | Use a registered remote computer |
| `--engine <id>` | — |  |
| `--computers-config <path>` | — | Operator computer connection registry JSON file |
| `--engines-config <path>` | — |  |
| `--db-path <path>` | — | Control database of the local engine to attach to |

| Argument | Required | Description |
| --- | --- | --- |
| `finding` | No |  |

#### findings upload

Upload findings to GitHub code scanning (SARIF) or to Bitbucket Code Insights (scan JSON or SARIF)

```text
0 findings upload [options] <file>
```

Run the scan in a pull request check, then upload the result:

```bash
0 scan . --diff origin/main --format sarif -o scan.sarif
0 findings upload scan.sarif
```

The repository, commit and ref come from the clone (`GITHUB_SHA` and `GITHUB_REF` in Actions). The file is compressed, uploaded with `gh` and checked until GitHub has processed it; a refused file is reported with GitHub's reason. GitHub matches alerts by fingerprint, so an upload for a later commit updates them. `gh` needs permission to write security events (`security-events: write` in Actions).

With `--to bitbucket-cloud` or `--to bitbucket-dc` the findings go to Bitbucket Code Insights instead. Upload the file from `0 scan --format json`, which carries the agent's verdict, rationale and fix guidance. With `BITBUCKET_TOKEN` set the report and its annotations are sent; without it the payload is printed. See [Bitbucket, Jenkins and Azure Pipelines](/ci/#bitbucket-jenkins-and-azure-pipelines).

| Argument | Required | Description |
| --- | --- | --- |
| `file` | Yes | SARIF 2.1.0 file from `0 scan --format sarif -o scan.sarif`; for Bitbucket also `0 scan --format json -o scan.json` |

| Option | Registered default | Description |
| --- | --- | --- |
| `--to <target>` | `github` | github (default), bitbucket-cloud or bitbucket-dc |
| `--url <url>` | — | Bitbucket Data Center base URL (default: BITBUCKET_URL) |
| `--report-id <id>` | `0-security` | Bitbucket report id or key |
| `--print` | — | Bitbucket: print the report and annotation payload instead of posting it (also the behaviour without BITBUCKET_TOKEN) |
| `--allow-insecure-http` | — | Bitbucket: allow sending the token to an http:// URL that is not on this machine (default: refuse) |
| `--repo <owner/name>` | — | Repository (default: the current clone's); Bitbucket: workspace/repo or PROJECT/repo |
| `--commit <sha>` | — | Commit the results are for (default: HEAD, or GITHUB_SHA in Actions) |
| `--ref <ref>` | — | refs/heads/&lt;branch&gt; or refs/pull/&lt;n&gt;/merge (default: the current branch, or GITHUB_REF in Actions) |
| `--tool <name>` | — | Name the tool shown in GitHub |
| `--no-wait` | — | Return when GitHub has accepted the upload instead of waiting for it to be processed |
| `--format <format>` | `text` | Output: text or json |

#### findings issues

Mirror findings into GitHub Issues, one issue per finding, kept in sync without duplicates

```text
0 findings issues [options]
```

```bash
0 findings issues --repo acme/app --dry-run
0 findings issues --repo acme/app --min-severity high --max 10
```

Run `--dry-run` first. It prints what would be created, updated, closed or reopened and changes nothing.

Each finding family gets one issue. A later run finds it through a hidden `<!-- 0-finding:<key> -->` marker in the body (the key is the finding's fingerprint), so running it again never duplicates. Open findings at or above `--min-severity` (default `medium`) get an issue. An issue is updated when the finding's title, severity or location changes, closed with a comment when the finding is suppressed, accepted, fixed or marked a false positive, and reopened if it comes back.

0 creates the `security` and `severity:<level>` labels when they are missing, and warns and carries on if it cannot. It manages only issues that carry the `security` label (applying it needs triage rights). If you remove the label from an issue, that issue is detached and a new one is created for the finding.

`--max` (default 25) caps the changes in one run and `--delay` (default 1000 ms) spaces them out for GitHub's rate limits. Run again to continue.

The issue text holds only the title, severity, category, location (`path:line`), the attacker-impact sentence, the status and a hint for finding the details locally. Evidence, requests, responses and proof-of-concept bodies are never copied, because they can quote code or secrets. Report text has no `@mentions`, no `#123` references, no HTML and no links.

`gh` needs permission to write issues (`issues: write` in Actions). Without `--repo`, the repository comes from the clone.

| Option | Registered default | Description |
| --- | --- | --- |
| `--repo <owner/name>` | — | Repository (default: the current clone's) |
| `--min-severity <severity>` | `medium` | Open issues only for findings at or above this: critical, high, medium, low or info |
| `--max <n>` | `25` | Most issues to create, update, close or reopen in one run |
| `--delay <ms>` | `1000` | Wait this long between changes to respect rate limits |
| `--dry-run` | — | Print what would change and change nothing |
| `--db-path <path>` | — | Path to SQLite database (default: the shared database and every scan's) |
| `--format <format>` | `text` | Output: text or json |

#### findings export

Export selected findings, or a whole scan, as `json`, `md`, `sarif`, `html` or `pdf`. Reads the local database; no engine needs to run. IDs accept a unique prefix. For a share-safe copy of a JSON report use `0 findings reports export`.

```text
0 findings export [options] [ids...]
```

```bash
0 findings export 3f2a 91bc --format sarif -o findings.sarif
0 findings export --scan 20260101-abc --format pdf -o report.pdf
```

| Argument | Required | Description |
| --- | --- | --- |
| `ids` | No |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--scan <id>` | — | Export every finding of this scan instead of selected IDs |
| `--format <format>` | `json` | json, md, sarif, html or pdf |
| `-o, --output <file>` | — | Write to a file instead of stdout |
| `--severity <severity>` | — | With no IDs: only this severity |
| `--category <category>` | — | With no IDs: only this category |
| `--status <status>` | — | With no IDs: only this status |
| `--triage <triage>` | — | With no IDs: only this triage state |
| `--db-path <path>` | — | Path to SQLite database |
| `--json` | — | Print the result of writing a file as JSON |

#### findings keys

Manage read-only API access keys for the findings API. The secret is printed once at creation and never stored in plaintext. Team workspaces manage keys in the browser.

```text
0 findings keys
```

```bash
0 findings keys create ci-reader --expires-in 30
```

Subcommands: [list](#findings-keys-list) · [create](#findings-keys-create) · [revoke](#findings-keys-revoke).

#### findings keys list

List keys with their expiry and status. Secrets are never shown.

```text
0 findings keys list [options]
```

```bash
0 findings keys list --json
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--db-path <path>` | — | Path to SQLite database |
| `--json` | — | Print JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### findings keys create

Create a read-only key. Default expiry is 90 days.

```text
0 findings keys create [options] <name>
```

```bash
0 findings keys create ci-reader --expires-in 30
```

| Argument | Required | Description |
| --- | --- | --- |
| `name` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--expires-in <days>` | — | Days until the key expires (default 90) |
| `--db-path <path>` | — | Path to SQLite database |
| `--json` | — | Print JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### findings keys revoke

Revoke a key. Requires `--yes`.

```text
0 findings keys revoke [options] <id>
```

```bash
0 findings keys revoke 643b88a4-2fae-409b-b4d9-bea00fc75812 --yes
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--yes` | — | Confirm the revocation |
| `--db-path <path>` | — | Path to SQLite database |
| `--json` | — | Print JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

### config db

Manage the local findings database.

```text
0 config db
```

Subcommands: [repair](#config-db-repair) · [reset](#config-db-reset).

#### config db repair

Back up a malformed local SQLite database and recreate a clean one

```text
0 config db repair [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--db-path <path>` | — | Path to SQLite database |

#### config db reset

Delete the local SQLite database and optionally reseed the verification workbench

```text
0 config db reset [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--db-path <path>` | — | Path to SQLite database |
| `--seed <preset>` | `verification` | Seed preset to load after reset |

Reset also removes the database's `-journal` file and `.lock` directory. It refuses, and deletes nothing, when:

- the database path is a directory (check `ZERO_DB_PATH` and `--db-path`)
- the process recorded in `<db>.lock/pid` is still alive
- the lock has no owner information and changed in the last 5 minutes

Symlinks are removed as links and never followed. The browser's reset-database action behaves the same way and can return an error for a held lock.

## Automation & integration

### computers

Add and manage remote computers. A computer is a remote 0 engine that runs threads and automations on its host. Select it in the browser's computer menu to work there.

```text
0 computers
```

Subcommands: [list](#computers-list) · [add](#computers-add) · [stop](#computers-stop) · [repair](#computers-repair) · [remove](#computers-remove) · [hosts](#computers-hosts).


#### computers list

List the registered remote computers with their host and whether 0 deployed them
(managed computers can be reconnected and stopped from here).

```text
0 computers list [options]
```

```bash
0 computers list --json
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print JSON |
| `--engines-config <path>` | — | Engine registry path |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### computers add

Deploy the built CLI engine onto a running Linux Lima instance or an SSH host and register its connection locally. Run `pnpm build` in a source checkout first.

```bash
0 computers add --ssh me@build-box
```

Use `--ssh` for an SSH host alias or `user@host`. Without it, the command uses the `zero-worker` Lima instance. SSH deployment uses noninteractive key authentication.

```text
0 computers add [options]
```

Use `--target-git` with an `https://` URL to clone your repository into the remote workspace. Deployment installs runtime dependencies and starts the engine on the remote machine.

`--forward-provider-key` sends your `OPENAI_API_KEY` to the remote engine. Use it only for a host you own.

Check the returned backend ID and connection details, then select that computer in the browser before starting remote work.

| Option | Registered default | Description |
| --- | --- | --- |
| `--ssh <user@host>` | — | SSH target host (BatchMode; key auth from ssh config/agent) |
| `--lima <name>` | `zero-worker` | Lima instance name |
| `--target-git <url>` | — | HTTPS URL of a Git repository the remote server clones into the engine folder instead of the bundled demo target |
| `--ssh-config <path>` | — | OpenSSH config file for the SSH target (e.g. a Lima instance's ssh.config) |
| `--engine-port <port>` | — | Engine port on the remote server (default: stable port derived from host) |
| `--trust-new-host` | `false` | Trust and remember the computer's SSH host key if it is not known yet |
| `--forward-provider-key` | `false` | Forward this computer's OPENAI_API_KEY to the remote engine (user-owned hosts only) |
| `--engines-config <path>` | — | Engine registry path |

Aliases: `deploy`.

#### computers repair

Reconnect a deployed computer from its saved deployment details. The command starts the retained engine if needed and recreates its SSH tunnel. It keeps remote files and refuses to replace an unrelated process or an occupied engine port. If the deployment files are missing, add the computer again.

```text
0 computers repair <id>
```

The result is JSON with the backend ID, reconnection status, and whether the
engine was started.

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

Aliases: `reconnect`.

#### computers stop

Stop a computer that 0 deployed and close its local tunnel. Before it signals the process, the command checks the saved deployment details, the remote working directory, and the process ID and command. The remote workspace and the saved registration stay, so you can add the computer again later.

```text
0 computers stop <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

#### computers remove

Remove a remote computer from this machine: closes the tunnel and forgets its
saved connection. Files on the remote computer stay in place.

```text
0 computers remove [options] <id>
```

Run `0 computers list` to see the IDs.

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--engines-config <path>` | — | Engine registry path |

#### computers hosts

List SSH host aliases from `~/.ssh/config`, with their resolved host and user. It does not check connectivity or whether a host can run a Linux engine.

```text
0 computers hosts
```

### skills

Browse, add, create, edit, import, export and link skills

```text
0 skills
```

Every command works with the app running or on its own, and takes `--json`. Adding from GitHub or the catalog shows a review first and needs `--yes`.

```bash
0 skills list
0 skills catalog --search handoff
0 skills add mattpocock~skills~handoff --yes
```

Subcommands: [list](#skills-list) · [add](#skills-add) · [show](#skills-show) · [new](#skills-new) · [edit](#skills-edit) · [copy](#skills-copy) · [delete](#skills-delete) · [import](#skills-import) · [export](#skills-export) · [link](#skills-link) · [unlink](#skills-unlink) · [catalog](#skills-catalog) · [extensions](#skills-extensions) · [remove](#skills-remove).

#### skills list

List installed skills and linked folders

```text
0 skills list [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Use this engine database instead of the default |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### skills show

Show a skill's SKILL.md and files

```text
0 skills show [options] <id-or-name>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id-or-name` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Use this engine database instead of the default |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### skills new

Create a skill from a SKILL.md file

```text
0 skills new [options] <file>
```

| Argument | Required | Description |
| --- | --- | --- |
| `file` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Use this engine database instead of the default |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### skills edit

Replace a skill's SKILL.md with the contents of --file

```text
0 skills edit [options] <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--file <path>` **required** | — | SKILL.md with the new content |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Use this engine database instead of the default |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### skills copy

Save a workspace copy of a skill under a new name

```text
0 skills copy [options] <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--name <name>` **required** | — | Name for the copy (lowercase letters, digits, hyphens) |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Use this engine database instead of the default |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### skills delete

Delete a skill from the workspace library

```text
0 skills delete [options] <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--yes` | — | Confirm the deletion |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Use this engine database instead of the default |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### skills import

Import a skill bundle (.skill.json) or a folder with SKILL.md

```text
0 skills import [options] <bundle>
```

| Argument | Required | Description |
| --- | --- | --- |
| `bundle` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Use this engine database instead of the default |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### skills export

Export a skill as a bundle

```text
0 skills export [options] <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `-o, --output <file>` | — | Write the bundle to a file instead of stdout |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Use this engine database instead of the default |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### skills link

Link a folder of skills; they stay where they are

```text
0 skills link [options] <folder>
```

| Argument | Required | Description |
| --- | --- | --- |
| `folder` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Use this engine database instead of the default |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### skills unlink

Unlink a folder by its link id (see `0 skills list --json`)

```text
0 skills unlink [options] <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Use this engine database instead of the default |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### skills catalog

Browse the skills catalog

```text
0 skills catalog [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--search <text>` | — | Filter by name, publisher or summary |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Use this engine database instead of the default |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### skills add

Add a skill from the catalog or GitHub (owner/repo[/path]); shows a review first

```text
0 skills add [options] <source>
```

| Argument | Required | Description |
| --- | --- | --- |
| `source` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--preview` | — | Only show the review |
| `--yes` | — | Install the reviewed commit |
| `--enable` | — | Extensions: also enable it |
| `--project <dir>` | — | Extensions: with --enable, enable for this folder only |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Use this engine database instead of the default |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### skills extensions

Installed extensions: list, info, enable, disable, update, remove (install with `0 skills add`)

```text
0 skills extensions
```

Subcommands: [add](#skills-extensions-add) · [mcp](#skills-extensions-mcp) · [list](#skills-extensions-list) · [info](#skills-extensions-info) · [enable](#skills-extensions-enable) · [disable](#skills-extensions-disable) · [remove](#skills-extensions-remove) · [update](#skills-extensions-update) · [import](#skills-extensions-import).

#### skills extensions add

Install an extension: <url|owner/repo|folder>@<full sha>; same as `0 skills add`

```text
0 skills extensions add [options] <source>
```

| Argument | Required | Description |
| --- | --- | --- |
| `source` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--preview` | — | Only show the install prompt |
| `--yes` | — | Install the exact revision shown |
| `--enable` | — | Also enable it |
| `--project <dir>` | — | With --enable: enable for this folder only |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Use this engine database instead of the default |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### skills extensions mcp

Add one MCP server as a local extension

```text
0 skills extensions mcp [options] <name> [command...]
```

| Argument | Required | Description |
| --- | --- | --- |
| `name` | Yes |  |
| `command` | No |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--url <https-url>` | — | A remote server instead of a command |
| `--preview` | — | Only show the install prompt |
| `--yes` | — | Install the exact revision shown |
| `--enable` | — | Also enable it |
| `--project <dir>` | — | With --enable, enable for this folder only |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Use this engine database instead of the default |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### skills extensions list

List installed extensions and built-ins

```text
0 skills extensions list [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--project <dir>` | — | Show enablement for this project |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Use this engine database instead of the default |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### skills extensions info

Show the install prompt for an installed extension

```text
0 skills extensions info [options] <name>
```

| Argument | Required | Description |
| --- | --- | --- |
| `name` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Use this engine database instead of the default |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### skills extensions enable

Enable globally, or for one project with --project

```text
0 skills extensions enable [options] <name>
```

| Argument | Required | Description |
| --- | --- | --- |
| `name` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--project <dir>` | — | Enable for this folder only |
| `--yes` | — | Approve an unapproved revision (for example an imported one) |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Use this engine database instead of the default |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### skills extensions disable

Disable globally, or for one project with --project

```text
0 skills extensions disable [options] <name>
```

| Argument | Required | Description |
| --- | --- | --- |
| `name` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--project <dir>` | — | Disable for this folder only |
| `--yes` | — | Confirm disabling a built-in |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Use this engine database instead of the default |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### skills extensions remove

Remove an installed extension and its stored revisions

```text
0 skills extensions remove [options] <name>
```

| Argument | Required | Description |
| --- | --- | --- |
| `name` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--yes` | — | Confirm the removal |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Use this engine database instead of the default |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### skills extensions update

Show the diff and install prompt for a newer revision; --yes --to <sha> approves it

```text
0 skills extensions update [options] <name>
```

| Argument | Required | Description |
| --- | --- | --- |
| `name` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--to <sha>` | — | Full commit SHA to update to (default: the remote HEAD) |
| `--yes` | — | Approve the revision given by --to |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Use this engine database instead of the default |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### skills extensions import

Import earlier plugins, MCP servers and skills (runs once automatically); shows what could not be migrated

```text
0 skills extensions import [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--force` | — | Run the importer again |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Use this engine database instead of the default |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### skills remove

Remove a skill that was added from GitHub or the catalog

```text
0 skills remove [options] <name>
```

| Argument | Required | Description |
| --- | --- | --- |
| `name` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--yes` | — | Confirm the removal |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Use this engine database instead of the default |
| `--format <format>` | — | Output: text or json Choices: text, json. |

### automation

Saved automations.

```text
0 automation
```

Subcommands: [list](#automation-list) · [show](#automation-show) · [create](#automation-create) · [edit](#automation-edit) · [duplicate](#automation-duplicate) · [versions](#automation-versions) · [rollback](#automation-rollback) · [delete](#automation-delete).


#### automation list

List saved automations and templates.

```text
0 automation list [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--templates` | — | List only templates |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--engine <id>` | — | Use a registered remote engine; targets and inputs are interpreted there |
| `--engines-config <path>` | — | Operator engine connection registry JSON file |
| `--db-path <path>` | — | Control database of the local engine |
| `--format <format>` | `json` | Output format: json or text |

#### automation show

Inspect one saved automation or select a template with `--template`.

```text
0 automation show [options] [id]
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | No |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--template <id>` | — | Show a template definition |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--engine <id>` | — | Use a registered remote engine; targets and inputs are interpreted there |
| `--engines-config <path>` | — | Operator engine connection registry JSON file |
| `--db-path <path>` | — | Control database of the local engine |
| `--format <format>` | `json` | Output format: json or text |

#### automation create

Create an automation from a template or a JSON definition.

```text
0 automation create [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--template <id>` | — | Start from a template (see `0 sentinels list --automation --templates`) |
| `--file <path>` | — | Definition JSON object |
| `--name <name>` | — | Name for the new automation |
| `--target <target>` | — | Target the automation runs against |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |

#### automation edit

Replace an automation's definition from a JSON file.

```text
0 automation edit [options] <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--file <path>` **required** | — | Definition JSON object |
| `--revision <n>` | — | Reviewed revision to edit (default: the current one) |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |

#### automation duplicate

Save a copy of an automation.

```text
0 automation duplicate [options] <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--name <name>` | — | Name for the copy |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |

#### automation versions

List saved revisions of an automation.

```text
0 automation versions [options] <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |

#### automation rollback

Restore an earlier revision as a new revision.

```text
0 automation rollback [options] <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--revision <n>` **required** | — | Revision to restore (see `0 sentinels set --automation versions`) |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |

#### automation delete

Delete a saved automation and its schedules.

```text
0 automation delete [options] <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--revision <n>` | — | Reviewed revision to delete (default: the current one) |
| `--yes` | — | Confirm deletion |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |

### threads

Inspect and control the same live threads the browser uses. Attach with `--engine`, or with `--engine-url` and `--engine-token-env`, or use the discovered local engine. These commands keep the engine's current admission grants.

```text
0 threads
```

```bash
0 threads list --engine production
```

Subcommands: [list](#threads-list) · [show](#threads-show) · [send](#threads-send) · [start](#threads-start) · [stop](#threads-stop) · [create](#threads-create) · [continue](#threads-continue) · [cancel](#threads-cancel) · [force-stop](#threads-force-stop) · [events](#threads-events) · [resume](#threads-resume) · [decide](#threads-decide) · [retry](#threads-retry) · [set](#threads-set) · [rename](#threads-rename) · [clear](#threads-clear) · [close](#threads-close) · [archive](#threads-archive) · [delete](#threads-delete) · [export](#threads-export).

#### threads list

List live sessions, or retained snapshots with --saved. Listing does not resume work.

```text
0 threads list [options]
```

```bash
0 threads list --saved --engine production
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--saved` | — | List retained thread snapshots |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--engine <id>` | — | Use a registered remote engine; targets and inputs are interpreted there |
| `--engines-config <path>` | — | Operator engine connection registry JSON file |
| `--db-path <path>` | — | Control database of the local engine |
| `--format <format>` | `text` | Output format: json or text |
| `--json` | — |  |

#### threads show

Read an existing live session without recreating it or restoring approvals.

```text
0 threads show [options] <id>
```

```bash
0 threads show SESSION_ID --engine production
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--wait` | — | Wait for the answer; stdout is the reply only (thread id and usage go to stderr) |
| `--timeout <seconds>` | `600` | Maximum seconds to wait with --wait |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--engine <id>` | — | Use a registered remote engine; targets and inputs are interpreted there |
| `--engines-config <path>` | — | Operator engine connection registry JSON file |
| `--db-path <path>` | — | Control database of the local engine |
| `--format <format>` | `text` | Output format: json or text |
| `--json` | — |  |

#### threads create

Create a session within the engine's authorized workspace and model configuration. --config reads a bounded JSON object; it cannot expand engine grants.

```text
0 threads create [options]
```

```bash
0 threads create --config session.json --engine production
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--config <path>` | — | Thread configuration JSON object |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--engine <id>` | — | Use a registered remote engine; targets and inputs are interpreted there |
| `--engines-config <path>` | — | Operator engine connection registry JSON file |
| `--db-path <path>` | — | Control database of the local engine |
| `--format <format>` | `json` | Output format: json or text |
| `--json` | — |  |

#### threads send

Send text to a live engine session. The engine runs the turn using its configured provider and tools.

```text
0 threads send [options] <id> <text>
```

```bash
0 threads send SESSION_ID "Review the current findings" --engine production
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |
| `text` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--wait` | — | Wait for the answer; stdout is the reply only (thread id and usage go to stderr) |
| `--timeout <seconds>` | `600` | Maximum seconds to wait with --wait |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--engine <id>` | — | Use a registered remote engine; targets and inputs are interpreted there |
| `--engines-config <path>` | — | Operator engine connection registry JSON file |
| `--db-path <path>` | — | Control database of the local engine |
| `--format <format>` | `text` | Output format: json or text |
| `--json` | — |  |

#### threads continue

Continue the selected live session with optional text. This preserves the existing engine context.

```text
0 threads continue [options] <id> [text]
```

```bash
0 threads continue SESSION_ID --engine production
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |
| `text` | No |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--wait` | — | Wait for the answer; stdout is the reply only (thread id and usage go to stderr) |
| `--timeout <seconds>` | `600` | Maximum seconds to wait with --wait |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--engine <id>` | — | Use a registered remote engine; targets and inputs are interpreted there |
| `--engines-config <path>` | — | Operator engine connection registry JSON file |
| `--db-path <path>` | — | Control database of the local engine |
| `--format <format>` | `text` | Output format: json or text |
| `--json` | — |  |

#### threads cancel

Explicitly cancel the session's active work. Transport disconnect alone does not request cancellation from an attached engine.

```text
0 threads cancel [options] <id>
```

```bash
0 threads cancel SESSION_ID --engine production
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--engine <id>` | — | Use a registered remote engine; targets and inputs are interpreted there |
| `--engines-config <path>` | — | Operator engine connection registry JSON file |
| `--db-path <path>` | — | Control database of the local engine |
| `--format <format>` | `text` | Output format: json or text |
| `--json` | — |  |

#### threads events

Read engine session events after an optional nonnegative cursor. Cursors belong to that engine and session.

```text
0 threads events [options] <id>
```

```bash
0 threads events SESSION_ID --after 0 --engine production
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--after <cursor>` | — | Nonnegative engine event cursor |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--engine <id>` | — | Use a registered remote engine; targets and inputs are interpreted there |
| `--engines-config <path>` | — | Operator engine connection registry JSON file |
| `--db-path <path>` | — | Control database of the local engine |
| `--format <format>` | `json` | Output format: json or text |
| `--json` | — |  |

#### threads force-stop

Stop a session's owned execution process and registered resources. Use the exact live ID from `0 threads list`. The command never restores a saved chat or substitutes a replacement session.

The owning engine checks authorization and supervisor availability. Unsupported execution returns an error, and teardown that is not confirmed stays quarantined. Nothing is escalated or replayed automatically.

```text
0 threads force-stop [options] <id>
```

```bash
0 threads force-stop LIVE_SESSION_ID --engine production
0 threads force-stop LIVE_SESSION_ID --engine-url http://127.0.0.1:48123 --engine-token-env ZERO_ENGINE_TOKEN
```

Force stop works for qualified Bun sessions on macOS and Linux. Completed external effects are not undone. After an error, run `0 threads show` before you take another action.

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--engine <id>` | — | Use a registered remote engine; targets and inputs are interpreted there |
| `--engines-config <path>` | — | Operator engine connection registry JSON file |
| `--db-path <path>` | — | Control database of the local engine |
| `--format <format>` | `text` | Output format: json or text |
| `--json` | — |  |

#### threads resume

Restore a retained snapshot as a new session under current engine grants. Stored transcripts do not restore approval or filesystem grants.

```text
0 threads resume [options] <saved-id>
```

```bash
0 threads resume SAVED_ID --engine production
```

| Argument | Required | Description |
| --- | --- | --- |
| `saved-id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--engine <id>` | — | Use a registered remote engine; targets and inputs are interpreted there |
| `--engines-config <path>` | — | Operator engine connection registry JSON file |
| `--db-path <path>` | — | Control database of the local engine |
| `--format <format>` | `text` | Output format: json or text |
| `--json` | — |  |

#### threads decide

Respond to an existing session decision using a JSON response file. The engine checks the decision belongs to that live session.

```text
0 threads decide [options] <id> <decision-id>
```

```bash
0 threads decide SESSION_ID DECISION_ID --response response.json --engine production
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |
| `decision-id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--response <path>` **required** | — | Decision response JSON object |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--engine <id>` | — | Use a registered remote engine; targets and inputs are interpreted there |
| `--engines-config <path>` | — | Operator engine connection registry JSON file |
| `--db-path <path>` | — | Control database of the local engine |
| `--format <format>` | `json` | Output format: json or text |
| `--json` | — |  |

#### threads start

Create a thread, send the first prompt and print its ID. With `--wait`, block until the turn ends and print the reply.

```text
0 threads start [options] <prompt>
```

```bash
0 threads start "Triage the open findings" --model gpt-5 --effort high --mode recon --wait
```

| Argument | Required | Description |
| --- | --- | --- |
| `prompt` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--model <model>` | — | Model for this thread |
| `--effort <level>` | — | Reasoning effort: minimal, low, medium, high, xhigh |
| `--approvals <ask\|auto>` | — | Moved to the global setting |
| `--folder <path>` | — | Folder the thread works in |
| `--skill <id>` | — | Built-in skill to follow; if it declares a check, the harness runs it and the thread cannot claim Verified without it |
| `--title <title>` | — | Thread title |
| `--wait` | — | Wait for the answer; stdout is the reply only (thread id and usage go to stderr) |
| `--cost-ceiling <usd>` | — | Stop the thread when its estimated spend reaches this many USD |
| `--timeout <seconds>` | `600` | Maximum seconds to wait with --wait |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--computer <id>` | — | Use a registered remote computer |
| `--engine <id>` | — |  |
| `--computers-config <path>` | — | Operator computer connection registry JSON file |
| `--engines-config <path>` | — |  |
| `--db-path <path>` | — | Control database of the local engine to attach to |
| `--json` | — | Print the engine response as JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### threads stop

Cancel a thread's active work. `--force` force stops owned execution that did not drain.

```text
0 threads stop [options] <id>
```

```bash
0 threads stop 3f2a --force
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--force` | — | Force stop owned execution that did not drain |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--computer <id>` | — | Use a registered remote computer |
| `--engine <id>` | — |  |
| `--computers-config <path>` | — | Operator computer connection registry JSON file |
| `--engines-config <path>` | — |  |
| `--db-path <path>` | — | Control database of the local engine to attach to |
| `--json` | — | Print the engine response as JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### threads retry

Re-run the last turn of a thread.

```text
0 threads retry [options] <id>
```

```bash
0 threads retry 3f2a
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--computer <id>` | — | Use a registered remote computer |
| `--engine <id>` | — |  |
| `--computers-config <path>` | — | Operator computer connection registry JSON file |
| `--engines-config <path>` | — |  |
| `--db-path <path>` | — | Control database of the local engine to attach to |
| `--json` | — | Print the engine response as JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### threads set

Change a thread's model, reasoning effort, mode or folder. A computer is chosen when the thread starts.

```text
0 threads set [options] <id>
```

```bash
0 threads set 3f2a --mode copilot --folder ~/code/app
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--model <model>` | — | Model |
| `--effort <level>` | — | Reasoning effort: minimal, low, medium, high, xhigh |
| `--approvals <ask\|auto>` | — | Moved to the global setting |
| `--folder <path>` | — | Folder the thread works in |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--computer <id>` | — | Use a registered remote computer |
| `--engine <id>` | — |  |
| `--computers-config <path>` | — | Operator computer connection registry JSON file |
| `--engines-config <path>` | — |  |
| `--db-path <path>` | — | Control database of the local engine to attach to |
| `--json` | — | Print the engine response as JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### threads rename

Rename a thread, or generate a new title from its conversation.

```text
0 threads rename [options] <id> [title]
```

```bash
0 threads rename 3f2a --regenerate
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |
| `title` | No |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--regenerate` | — | Generate a new title from the conversation |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--computer <id>` | — | Use a registered remote computer |
| `--engine <id>` | — |  |
| `--computers-config <path>` | — | Operator computer connection registry JSON file |
| `--engines-config <path>` | — |  |
| `--db-path <path>` | — | Control database of the local engine to attach to |
| `--json` | — | Print the engine response as JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### threads clear

Erase a thread's conversation but keep the thread. Requires `--yes`.

```text
0 threads clear [options] <id>
```

```bash
0 threads clear 3f2a --yes
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--yes` | — | Confirm the destructive action |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--computer <id>` | — | Use a registered remote computer |
| `--engine <id>` | — |  |
| `--computers-config <path>` | — | Operator computer connection registry JSON file |
| `--engines-config <path>` | — |  |
| `--db-path <path>` | — | Control database of the local engine to attach to |
| `--json` | — | Print the engine response as JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### threads close

Stop and close a live thread. Its saved copy stays.

```text
0 threads close [options] <id>
```

```bash
0 threads close 3f2a
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--computer <id>` | — | Use a registered remote computer |
| `--engine <id>` | — |  |
| `--computers-config <path>` | — | Operator computer connection registry JSON file |
| `--engines-config <path>` | — |  |
| `--db-path <path>` | — | Control database of the local engine to attach to |
| `--json` | — | Print the engine response as JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### threads archive

Archive a thread, or a retained snapshot with `--saved`.

```text
0 threads archive [options] <id>
```

```bash
0 threads archive 3f2a
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--saved` | — | The ID is a retained snapshot, not a live thread |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--computer <id>` | — | Use a registered remote computer |
| `--engine <id>` | — |  |
| `--computers-config <path>` | — | Operator computer connection registry JSON file |
| `--engines-config <path>` | — |  |
| `--db-path <path>` | — | Control database of the local engine to attach to |
| `--json` | — | Print the engine response as JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### threads delete

Permanently delete a thread or, with `--saved`, a retained snapshot. Requires `--yes`.

```text
0 threads delete [options] <id>
```

```bash
0 threads delete 3f2a --yes
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--saved` | — | The ID is a retained snapshot, not a live thread |
| `--yes` | — | Confirm the destructive action |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--computer <id>` | — | Use a registered remote computer |
| `--engine <id>` | — |  |
| `--computers-config <path>` | — | Operator computer connection registry JSON file |
| `--engines-config <path>` | — |  |
| `--db-path <path>` | — | Control database of the local engine to attach to |
| `--json` | — | Print the engine response as JSON |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### threads export

Export a thread transcript as JSON or Markdown.

```text
0 threads export [options] <id>
```

```bash
0 threads export 3f2a --format md -o transcript.md
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--saved` | — | The ID is a retained snapshot, not a live thread |
| `--format <format>` | `json` | json or md |
| `-o, --output <file>` | — | Write to a file instead of stdout |
| `--engine-url <url>` | — | Attach directly to a running trusted engine |
| `--engine-token-env <name>` | — | Environment variable holding the attached engine token |
| `--computer <id>` | — | Use a registered remote computer |
| `--engine <id>` | — |  |
| `--computers-config <path>` | — | Operator computer connection registry JSON file |
| `--engines-config <path>` | — |  |
| `--db-path <path>` | — | Control database of the local engine to attach to |
| `--json` | — | Print the engine response as JSON |

### sentinels

Create, inspect and control Sentinels.

```text
0 sentinels
```

Subcommands: [list](#sentinels-list) · [run](#sentinels-run) · [set](#sentinels-set) · [sync](#sentinels-sync) · [export](#sentinels-export) · [show](#sentinels-show) · [presets](#sentinels-presets) · [create](#sentinels-create) · [pause](#sentinels-pause) · [resume](#sentinels-resume) · [acknowledge](#sentinels-acknowledge) · [archive](#sentinels-archive) · [delete](#sentinels-delete) · [activations](#sentinels-activations) · [files](#sentinels-files) · [triggers](#sentinels-triggers) · [webhook](#sentinels-webhook).

#### sentinels sync

Make Sentinels match the YAML files in a folder. Shows what would change; --apply writes it.

```text
0 sentinels sync [options] <folder>
```

```bash
0 sentinels sync ./sentinels
0 sentinels sync ./sentinels --apply
```

Each `*.yaml` file is one Sentinel: name, mission, instructions, skills, model, folder, and automations with their triggers (see [Sentinels as files](/sentinels/#sentinels-as-files)). Without `--apply` nothing is written.

- A new Sentinel is created paused and a new trigger disabled.
- A changed model or skill list sends an active Sentinel back to review.
- A Sentinel that is not in the folder is left alone.

Stop a running console on the same database first.

| Argument | Required | Description |
| --- | --- | --- |
| `folder` | Yes | Folder of Sentinel definitions (*.yaml), for example .0/sentinels |

| Option | Registered default | Description |
| --- | --- | --- |
| `--apply` | — | Write the changes (without it, only the plan is shown) |
| `--check` | — | Exit 1 when the database differs from the files |
| `--commit <sha>` | — | Commit the files came from; recorded on each Sentinel |
| `--enable` | — | Enable the triggers this sync creates (only for a change that was already reviewed) |
| `--db-path <path>` | — | Database to change; stop its running console first |
| `--format <format>` | `text` | Output: text or json |

#### sentinels export

Write a Sentinel as a YAML definition file, so a team can start from what it already has

```text
0 sentinels export [options] <id>
```

Prints the definition, or writes `<name>.yaml` into `--out`. Syncing the exported file back changes nothing.

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes | Sentinel ID (full or prefix) or exact name |

| Option | Registered default | Description |
| --- | --- | --- |
| `--out <folder>` | — | Write &lt;name&gt;.yaml into this folder instead of standard output |
| `--db-path <path>` | — | Database to read; stop its running console first |

#### sentinels list

List Sentinels.

```text
0 sentinels list [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--status <status>` | — | Only active, paused, archived |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### sentinels show

Show a Sentinel (full or prefix ID).

```text
0 sentinels show [options] <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### sentinels presets

List Sentinel presets.

```text
0 sentinels presets [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### sentinels create

Create a Sentinel from a preset or a JSON definition.

```text
0 sentinels create [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--preset <id>` | — | Start from a preset (see `0 sentinels list --presets`) |
| `--name <name>` | — | Name |
| `--file <path>` | — | Sentinel JSON object (overrides preset fields) |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### sentinels set

Change a Sentinel's settings.

```text
0 sentinels set [options] <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--name <name>` | — | Name |
| `--purpose <text>` | — | One-line purpose |
| `--mission <text>` | — |  |
| `--file <path>` | — | Patch JSON object |
| `--version <n>` | — | Reviewed version (default: the current one) |
| `--state <state>` | — | active, paused, acknowledged, archived or deleted |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### sentinels pause

Pause a Sentinel.

```text
0 sentinels pause [options] <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### sentinels resume

Resume a paused Sentinel.

```text
0 sentinels resume [options] <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--acknowledge` | — | Also acknowledge review of changed model or tools |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### sentinels acknowledge

Mark changed model or tools as reviewed.

```text
0 sentinels acknowledge [options] <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### sentinels archive

Archive a Sentinel; its history stays.

```text
0 sentinels archive [options] <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### sentinels delete

Delete a Sentinel; its automations are detached, not deleted.

```text
0 sentinels delete [options] <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--yes` | — | Confirm deletion |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### sentinels run

Run a Sentinel now; starts a thread (needs a running engine).

```text
0 sentinels run [options] <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--task <text>` | — | Task for this run |
| `--yes` | — | Confirm that this run is authorized |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### sentinels activations

List a Sentinel's recent runs.

```text
0 sentinels activations [options] <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--limit <n>` | `50` | Maximum rows (1-200) |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |
| `--format <format>` | — | Output: text or json Choices: text, json. |


#### sentinels files

Read and edit a Sentinel's instructions and notes files.

```text
0 sentinels files
```

Subcommands: [list](#sentinels-files-list) · [get](#sentinels-files-get) · [put](#sentinels-files-put) · [rm](#sentinels-files-rm).

#### sentinels files list

List files.

```text
0 sentinels files list [options] <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### sentinels files get

Print a file's content.

```text
0 sentinels files get [options] <id> <path>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |
| `path` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### sentinels files put

Create or replace a file from --file or --content.

```text
0 sentinels files put [options] <id> <path>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |
| `path` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--file <path>` | — | Read content from a local text file |
| `--content <text>` | — | Inline content |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### sentinels files rm

Delete a file.

```text
0 sentinels files rm [options] <id> <path>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |
| `path` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--yes` | — | Confirm deletion |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### sentinels triggers

Control what starts a Sentinel's automations.

```text
0 sentinels triggers
```

Subcommands: [list](#sentinels-triggers-list) · [add](#sentinels-triggers-add) · [enable](#sentinels-triggers-enable) · [disable](#sentinels-triggers-disable) · [check](#sentinels-triggers-check) · [rm](#sentinels-triggers-rm).

#### sentinels triggers list

List triggers.

```text
0 sentinels triggers list [options] <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### sentinels triggers add

Add a trigger for an automation the Sentinel owns; disabled unless --enable --yes.

```text
0 sentinels triggers add [options] <id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--automation <id>` | — | What the trigger starts (default: the only one this Sentinel owns) |
| `--kind <kind>` | — | schedule \| manual \| github-pr |
| `--file <path>` | — | Trigger JSON object with schedule or github settings |
| `--enable` | — | Enable immediately |
| `--yes` | — | Confirm that an enabled trigger was reviewed |
| `--frequency <frequency>` | — | schedule: minutes, hourly, daily, weekdays, weekly, cron |
| `--every <minutes>` | — | schedule, minutes: interval (5 or more) |
| `--at <HH:MM>` | — | schedule, daily, weekdays, weekly: local time |
| `--weekday <day>` | — | schedule, weekly: sun, mon, ... or 0-6 |
| `--cron <expression>` | — | schedule, cron: five fields |
| `--timezone <zone>` | — | schedule: IANA timezone (default UTC) |
| `--repo <owner/name>` | — | github-pr: repository to watch |
| `--base-branch <branch>` | — | github-pr: only pull requests into this branch |
| `--comment` | — | github-pr: comment on each pull request with one short summary, edited in place on later pushes (default: off) |
| `--include-forks` | — | github-pr: also review pull requests from forks, marked untrusted (default: skipped) |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### sentinels triggers enable

Enable a trigger after reviewing it.

```text
0 sentinels triggers enable [options] <id> <trigger-id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |
| `trigger-id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--yes` | — | Confirm that this trigger was reviewed |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### sentinels triggers disable

Pause a trigger.

```text
0 sentinels triggers disable [options] <id> <trigger-id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |
| `trigger-id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### sentinels triggers check

Poll a pull request trigger now instead of waiting for its next poll.

```text
0 sentinels triggers check [options] <id> <trigger-id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |
| `trigger-id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### sentinels triggers rm

Delete a trigger.

```text
0 sentinels triggers rm [options] <id> <trigger-id>
```

| Argument | Required | Description |
| --- | --- | --- |
| `id` | Yes |  |
| `trigger-id` | Yes |  |

| Option | Registered default | Description |
| --- | --- | --- |
| `--yes` | — | Confirm deletion |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### sentinels webhook

GitHub webhook for pull request Sentinels (server mode). Hidden: most installs poll. See [Sentinels](/sentinels/#faster-with-a-github-webhook-server-mode).

```text
0 sentinels webhook
```

Subcommands: [status](#sentinels-webhook-status) · [secret](#sentinels-webhook-secret).

#### sentinels webhook status

Show whether the webhook is set up and the last deliveries.

```text
0 sentinels webhook status [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |
| `--format <format>` | — | Output: text or json Choices: text, json. |

#### sentinels webhook secret

Manage the webhook secret.

```text
0 sentinels webhook secret
```

Subcommands: [rotate](#sentinels-webhook-secret-rotate).

#### sentinels webhook secret rotate

Create the secret, or replace it; the old one keeps working for 5 minutes. Printed once.

```text
0 sentinels webhook secret rotate [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--yes` | — | Confirm; update the secret on GitHub afterwards |
| `--json` | — | Print machine-readable JSON |
| `--db-path <path>` | — | Control database (default: the user database) |
| `--format <format>` | — | Output: text or json Choices: text, json. |

## Team workspace setup

### config team

```text
0 config team
```

Provision opt-in accounts for a team engine you control. Local use without accounts stays the default. Creating a config does not activate it on a running host. See [Team workspaces](/computers/) for roles and deployment boundaries.

Subcommands: [init](#config-team-init) · [add-user](#config-team-add-user) · [list](#config-team-list).

### config team init

Create a private configuration with the first owner account. The password comes from protected terminal input or stdin and is stored as a salted hash. No email invitation is sent. Then start `0 web --team-config <path>`.

```text
0 config team init [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--config <path>` **required** | — | Configuration file to create |
| `--name <name>` **required** | — | Workspace name |
| `--owner <id>` **required** | — | Owner account ID |
| `--display-name <name>` **required** | — | Owner display name |

### config team add-user

Add an account to a private configuration with the role `owner`, `editor` or `viewer`. A viewer cannot control agents. Restart the team engine to load changes. The password is never a command-line argument.

```text
0 config team add-user [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--config <path>` **required** | — | Team configuration |
| `--user <id>` **required** | — | Account ID |
| `--display-name <name>` **required** | — | Display name |
| `--role <role>` **required** | — | owner, editor or viewer |

### config team list

List account IDs, display names and roles. Password hashes are not shown. The configuration must be a private regular file.

```text
0 config team list [options]
```

| Option | Registered default | Description |
| --- | --- | --- |
| `--config <path>` **required** | — | Team configuration |
