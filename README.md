<p align="center">
  <a href="https://0.security/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/readme/header-dark.svg">
      <img src="assets/readme/header-light.svg" alt="0security" width="900">
    </picture>
  </a>
</p>

<h1 align="center">Sovereign AI security agents</h1>

<p align="center">
  <sub>By the Swiss Applied AI &amp; Cybersecurity Research Lab</sub>
</p>

<p align="center">
  <sub>Backed by</sub>
  <a href="https://www.ycombinator.com/companies/0security"><img src="assets/readme/y-combinator.png" alt="Y Combinator" width="116" height="24" align="middle"></a>
</p>

<p align="center">
  <a href="https://github.com/0sec-labs/0security/releases/latest"><img src="https://img.shields.io/github/v/release/0sec-labs/0security" alt="Latest release"></a>
  <a href="LICENSE-MIT"><img src="https://img.shields.io/badge/license-MIT%20%7C%20Apache--2.0-blue" alt="MIT or Apache-2.0 license"></a>
  <a href="https://github.com/0sec-labs/0security/stargazers"><img src="https://img.shields.io/github/stars/0sec-labs/0security?style=flat" alt="GitHub stars"></a>
</p>

<p align="center">
  0security is software infrastructure to deploy sovereign, persistent AI security agents that find and fix security risks across any tech stack, work with any model, and run anywhere.
</p>

<p align="center">
  <a href="https://docs.0.security/"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/nav-docs-dark.svg"><img src="assets/readme/nav-docs-light.svg" alt="Documentation" height="48"></picture></a>
  <a href="https://0.security/research/"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/nav-research-dark.svg"><img src="assets/readme/nav-research-light.svg" alt="Security research" height="48"></picture></a>
  <a href="#quick-start"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/nav-install-dark.svg"><img src="assets/readme/nav-install-light.svg" alt="Install locally" height="48"></picture></a>
  <a href="https://0.security/enterprise/"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/enterprise-button-dark.svg"><img src="assets/readme/enterprise-button-light.svg" alt="Enterprise" height="48"></picture></a>
</p>

<p align="center">
  <a href="assets/readme-ui-demo.mp4">
    <picture>
      <img src="assets/readme-ui-demo.gif" alt="0 web UI: review a demo API, watch the investigation, then open findings with suggested fixes and verification" width="100%">
    </picture>
  </a>
</p>

## Quick start

```bash
curl -fsSL https://raw.githubusercontent.com/0sec-labs/0security/main/install.sh | bash
0
```

Prefer the terminal?

```bash
export OPENAI_API_KEY="your-api-key"
0 scan ./your-repo
0 findings list
```

`0 scan` takes a folder or a git URL, prints a report (`--format json|md|sarif|html|pdf`) and stops at `--budget` (default $5).

Have a Claude Pro or Max plan? Sign in to [Claude Code](https://code.claude.com/docs) and 0 runs on your subscription, no API key needed:

```bash
claude login
0 scan ./your-repo
```

0 drives the official `claude` CLI headlessly (Anthropic allows a subscription login only inside Claude Code), isolated from your own Claude Code settings, hooks and plugins. See [Claude subscription](docs/src/content/docs/models.md#claude-subscription).

Any supported provider works: set its key instead (Anthropic, OpenRouter, DeepSeek and more, see [Models](https://docs.0.security/models/)), or connect one in the browser with `0`.

<details>
<summary>Windows, Docker and source installs</summary>

- **Windows** (experimental): download `0-windows-x64.exe` from [Releases](https://github.com/0sec-labs/0security/releases/latest).
- **Docker**: `docker run --rm ghcr.io/0sec-labs/0security:latest --help`. See the [Docker guide](https://docs.0.security/server-mode/).
- **Source**: Node.js 24+ and pnpm, then `pnpm install --frozen-lockfile && pnpm build`.
- `install.sh` supports Apple Silicon macOS and x64/ARM64 Linux. Set `INSTALL_DIR` to change the location.

</details>

Only point 0 at systems you own or are authorized to test.

## What can you do with 0?

0 reviews code, keeps every finding in one place, fixes findings as pull requests and produces the evidence you hand to others. It is one binary and uses your own model keys.

| Job | Command |
| --- | --- |
| **Review code**: a fast scanner pass (foxguard by default, or semgrep and opengrep) then a model reviews what it found; `--diff` for a pull request | `0 scan ./repo` |
| **Keep one list**: import another scanner's SARIF or a repository's GitHub alerts, then triage, suppress and export | `0 findings import report.sarif` |
| **Fix as pull requests**: one branch and PR per finding, a draft when your checks fail, never a push to your base branch; or work through a backlog in batches | `0 findings fix <id> --test "pnpm test"`, `0 findings burndown` |
| **Send findings where people work**: GitHub code scanning and GitHub Issues, without duplicates | `0 findings upload`, `0 findings issues` |
| **Produce evidence**: CycloneDX or SPDX SBOM with hashes, graph and licenses, an AI inventory, advisory check, model-file scan, CRA report drafts and an evidence folder (evidence and drafts only: nothing here claims compliance or submits anything) | `0 sbom generate`, `0 sbom check`, `0 sbom scan-models`, `0 findings evidence`, `0 findings report-draft` |
| **Review AI apps**: LLM apps and MCP servers by skill, and a live model or agent endpoint by adversarial probe | `0 scan --skill llm-app-review`, `0 probe` |
| **Steer with your own rules**: a reviewable threat model, and policies checked pass or fail | `0 threat-model`, `0 scan --policy ./policies` |

Other review methods are skills: `crypto-migration`, `artifact-scan`, `mcp-server-review` and more (`0 skills list`). See the [command reference](https://docs.0.security/commands/) and the [CI guide](https://docs.0.security/ci/).

Prefer a browser? `0` starts a local web console with threads, a findings board and Sentinels (standing agents that wake on a schedule or on every pull request). It is optional: everything above works from the terminal and CI.

<p align="center">
  <a href="assets/readme-findings.mp4">
    <picture>
      <img src="assets/readme-findings.gif" alt="0 findings: review the queue, organize the board, and inspect source evidence" width="100%">
    </picture>
  </a>
</p>

## Why 0?

- **Open source**: MIT or Apache-2.0, built in the open
- **Private**: runs on your computer or in a container, and only the context you send to your chosen model leaves it
- **Your model**: any provider key or local OpenAI-compatible server
- **Evidence first**: every finding links to its source evidence and says whether it was verified
- **Safe by default**: fixes are branches and pull requests, repository files never steer a scan unless you opt in, and report text cannot notify anyone

## Learn more

- [Documentation](https://docs.0.security/)
- [Models and providers](https://docs.0.security/models/)
- [Extensions](https://docs.0.security/extensions/)
- [Command reference](https://docs.0.security/commands/)
- [Security research](https://0.security/research/)
- [Enterprise](https://0.security/enterprise/)

## Contributing

**0 is built in the open.** Huge thanks to everyone who has filed a bug, fixed a doc or sent a patch.

- **Report bugs** in [issues](https://github.com/0sec-labs/0security/issues)
- **Improve the docs**
- **Write an extension** or a skill
- **Found a vulnerability in 0?** See [SECURITY.md](.github/SECURITY.md)

Start with the [contributing guide](.github/CONTRIBUTING.md). Run `pnpm install` and `pnpm dev` to work on the engine. Open an issue before large changes.

<a href="https://github.com/0sec-labs/0security/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=0sec-labs/0security" alt="Contributors to 0sec-labs/0security" />
</a>

## License

[MIT](LICENSE-MIT) OR [Apache-2.0](LICENSE-APACHE).
