# Provenance and acknowledgements

## Where the engine came from

Finn's repository-intelligence engine began life as **Ink**, our previous project: a Rust scanner, dependency graph and context selector that answered one question well, which files matter for this task. Ink won an IBM hackathon, which came with $1,600 of IBM TechXchange tickets. That project is why Finn treats retrieval as a subsystem instead of a prompt.

Finn reuses that foundation from [Ink](https://github.com/dev-Ninjaa/ink) at upstream commit `5c32267d8f92b0dc06998f6481a1ca5dca726d6d`, specifically the scanner, dependency graph, context-selection and MCP layers. The retained engine was rebranded and adapted for a TrueForge-native agent. This repository starts a fresh Git history, which is not a claim of from-scratch authorship.

## What Finn changed around it

| Concern | Ink | Finn |
| --- | --- | --- |
| Agent loop | Scripted orchestration inside the MCP service | TrueForge owns sessions, turns, tools, streaming, approvals and compaction |
| Writes | Tool-level edits | In-memory proposals, per-hunk human acceptance, undo journal |
| Safety | Workspace scan boundaries | Canonical path resolution, symlink and hardlink rejection, `.git` and credential denial, bearer-authenticated loopback MCP with `Host` and `Origin` checks |
| Context | Retrieval results | Budgeted bundles with per-file reasons and explicit `@file` / `@symbol` mentions |
| Interface | Panel front end | Native commands, `Ctrl+I` inline edits, diff previews, streamed tool events, CSP-hardened webview |

The synthetic agent-scheduling surface was removed rather than wrapped, because a harness that only looks like it is running is worse than no harness.

## Licensing

New Finn code is MIT licensed under [LICENSE](LICENSE). Ink's original copyright and MIT terms are preserved in `licenses/ink-MIT.txt`, and inherited component licence files remain in place. Dependencies keep their own licences.

If you reuse Finn, keep this file and the licence terms with it. Attribution is the whole reason the engine is available to you.
