# Finn

A VS Code coding agent with a TrueForge-owned execution loop, repository-aware
context selection, and explicit review before source changes reach disk.

## Status

Under active development. The imported repository-intelligence engine is the
foundation, not a claim that the complete coding workflow already works.

## Starting point

Fresh Git history. Reused engine code and its exact upstream revision are declared
in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Original licence notices are
preserved. New work adds the TrueForge client, editor MCP bridge, safe patch review,
and the native coding workflow.

## Engineering contract

- TrueForge owns model calls, sessions, tools and streamed agent execution.
- Model-produced edits are proposals, never silent workspace writes.
- Context is task-aware, budgeted and explainable.
- Cancellation discards unapplied proposals; applied changes are undoable.
- No synthetic progress or mock success in production.

Setup, tests and demo instructions are added with the corresponding features.
