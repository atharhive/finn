# Architecture

Finn is a local VS Code client of TrueForge, not a replacement agent harness.

```text
VS Code selection and chat
          |
          v
TrueForge SDK: agent -> session -> turn -> streamed events
          |
          v
Authenticated editor MCP bridge on 127.0.0.1
  | read/search       | context             | propose edit
  v                   v                     v
Workspace guard   Finn Rust engine     In-memory hunks
                  + task retrieval          |
                                       Human review
                                            |
                                      Accepted edits
                                      + undo journal
```

The four modules are independently testable: `src/agent`, `src/context`,
`src/workspace`, and `src/extension`. Protocol contracts live in
`src/contracts.ts`. The Rust scanner/graph/selector under `crates` supplies the
reused foundation; no upstream Git objects are part of Finn's history. See
`THIRD_PARTY_NOTICES.md` for immutable provenance.

## Safety boundaries

Model tools may propose source edits, but cannot apply them. Each hunk is accepted
or rejected explicitly. The workspace service detects stale content before writing
or undoing so unrelated user edits are not overwritten. Pending state is in memory;
a restart discards it. Cancellation does not undo previously accepted human edits.

Commands require a separate human approval. They are ordinary local processes,
not a sandbox. A malicious approved command can bypass the proposal layer. Keep
untrusted work in an isolated clone/container and inspect every command.

## Model boundary

Finn holds no provider key and never calls a model provider. The configured
TrueForge service selects the provider/model and records the execution session.
A configured fallback is another TrueForge model reference, not a Finn-side LLM
loop. Error/cancellation paths must leave pending source proposals unapplied.

## Verification boundaries

Unit tests, MCP integration tests and an extension-host smoke test are not a live
coding-agent demo. The latter requires a configured model, real streamed sessions,
visible review and the independently verified Flask outcomes described in
`docs/demo.md`. Test doubles are permitted only inside tests and must not be
reported as live-model success.
