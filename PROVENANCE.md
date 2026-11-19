# Provenance: my own engine, rebuilt

## The short version

Finn's repository-intelligence engine is **Ink**, my earlier project. I wrote it, I won an IBM hackathon with it, and I am reusing it here on purpose rather than pretending this repository appeared from nowhere.

## The story

Ink started with a question that kept slowing me down: in a repository nobody has read end to end, which files actually matter for this task? I answered it in Rust, with a scanner, a dependency graph and a context selector. It worked well enough to win an **IBM hackathon**, which came with **$1,600 of IBM TechXchange tickets**.

It also taught me the lesson that made Finn necessary. Retrieval is not an agent. Ink could point at the right file, but the loop around it was scripted, so it always looked busy without ever earning enough trust to change code on its own. The engine was good. The harness around it was theatre.

When Forge-a-thon asked for a coding agent on top of TrueFoundry TrueForge, I had two options: write another retrieval engine, or take the one I already had and fix what was actually broken. I took my own code. Rewriting solved work is vanity, and it would have burned the time I needed for the review boundary.

So the scanner, graph, context-selection and MCP layers come from [Ink](https://github.com/dev-Ninjaa/ink) at commit `5c32267d8f92b0dc06998f6481a1ca5dca726d6d`, rebranded and adapted. Everything around them is new.

## What I kept, and what I rewrote

| Concern | Ink | Finn |
| --- | --- | --- |
| Agent loop | Scripted orchestration inside the MCP service | TrueForge owns sessions, turns, tools, streaming, approvals and compaction |
| Writes | Tool-level edits | In-memory proposals, per-hunk human acceptance, undo journal |
| Safety | Workspace scan boundaries | Canonical path resolution, symlink and hardlink rejection, `.git` and credential denial, bearer-authenticated loopback MCP with `Host` and `Origin` checks |
| Context | Retrieval results | Budgeted bundles with per-file reasons and explicit `@file` / `@symbol` mentions |
| Interface | Panel front end | Native commands, `Ctrl+I` inline edits, diff previews, streamed tool events, CSP-hardened webview |

I deleted the synthetic agent scheduling instead of wrapping it, because a harness that only looks like it is running is worse than no harness at all.

## What this means for the licence

This repository starts a fresh Git history. That is a decision about clean commits, not a claim that the engine is new work, and the README says so.

Ink's original copyright and MIT terms travel with the code in `licenses/ink-MIT.txt`, and inherited component licence files stay where they were. New Finn code is MIT licensed under [LICENSE](LICENSE); dependencies keep their own terms.

If you reuse Finn, keep this file with it. The engine is available because the person who wrote it put a licence on it, and that is a courtesy worth passing on.
