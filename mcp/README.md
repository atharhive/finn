# Finn MCP Server

Finn provides repository context to **TrueForge** and other MCP clients through
`repository_intelligence`, `dependency_graph`, and `context_optimizer`.
TrueForge owns planning, agent execution, editing, and verification. Finn does
not launch agents, simulate task progress, or certify that a task is complete.

## Tools

| Tool | Arguments | Result |
|------|-----------|--------|
| `analyze_repository` | `root` | Files, languages, entry points, modules, relationships and measured analysis metrics. |
| `build_dependency_graph` | `root` | Dependency nodes, edges, cycles, central files and reachability. |
| `optimize_context` | `root`, `query`, optional `max_tokens`, `min_relevance` | Selected context, dropped files and token estimates. |

`root` is an absolute local repository path. Analysis and relevance are heuristic;
inspect source and run appropriate tests before treating results as proof.
Each request analyzes the repository afresh. The MCP layer stores no reusable
analysis cache and exposes no cache counters or persistent execution state.
It emits no stage-percentage notifications. Results are returned after the engine
finishes; tool failures have `isError: true`.

## Resources and prompt

- `finn://analysis/{root}`: repository analysis JSON.
- `finn://graph/{root}`: dependency graph JSON.
- `prepare_context`: guidance to analyze, inspect dependencies, and optimize context
  for TrueForge, taking `root`, `task`, and optional `max_tokens`. This prompt
  prepares context; it does not carry out the developer task.

For `/path/to/repository`, the analysis URI is
`finn://analysis//path/to/repository`.

## Build and verify

Run from the workspace root with a Rust toolchain supporting the workspace and
its resolved dependencies:

```sh
cargo build -p finn_mcp
cargo test -p finn_mcp
cargo fmt --all -- --check
cargo clippy -p finn_mcp --all-targets -- -D warnings
```

The executable is `target/debug/finn_mcp` (or `target\debug\finn_mcp.exe`
on Windows), relative to the workspace root. Build on the same OS as the client;
Linux executables do not run on Windows.

## Local MCP setup

Configure TrueForge's MCP client to run the absolute executable path using stdio:

```json
{
  "mcpServers": {
    "finn": {
      "command": "/path/to/finn/target/debug/finn_mcp",
      "args": ["--transport", "stdio"]
    }
  }
}
```

Example `optimize_context` arguments:

```json
{"root":"/path/to/repository","query":"where is authentication handled","max_tokens":3000}
```

## Optional result logging

Set `FINN_REPORT_DIR` to save actual tool results and successful resource reads.
Timestamped `.json` files contain raw results (errors may be plain text);
`report.md` appends human-readable summaries. This is result logging, not an
execution timeline. Logging is disabled when the variable is unset or empty,
and never writes to protocol stdout. Logs can contain repository details; use
a private directory outside the analyzed repository to avoid scanning them later.

## Optional Streamable HTTP

```sh
cargo build -p finn_mcp --features http
./target/debug/finn_mcp --transport http --addr 127.0.0.1:3000
```

The MCP endpoint is `/mcp`; `/health` returns `ok`.
This server has **no built-in authentication**. Bind to loopback for local use;
use an authenticated reverse proxy before exposing it to a network. The CLI's
HTTP address default is `0.0.0.0:3000`, so set `--addr` explicitly.

| Variable | Purpose |
|----------|---------|
| `FINN_ALLOWED_HOSTS` | Comma-separated HTTP Host allow-list; defaults to localhost, 127.0.0.1 and [::1] (plus unspecified bind addresses when applicable). |
| `FINN_ALLOWED_ORIGINS` | Comma-separated browser Origin allow-list, passed to transport origin validation. |
| `FINN_REPORT_DIR` | Optional directory for actual result logs. |

## Layout

- `src/engine.rs`: bridge to the three repository engine crates.
- `src/handler.rs`: MCP capabilities, instructions and resource endpoints.
- `src/tools/`: analysis, graph and context tool handlers.
- `src/prompts/`: context-preparation prompt.
- `src/resources/`: repository-backed resource templates and reads.
- `src/reporting.rs`: optional actual-result logs.
- `tests/integration_tests.rs`: real-binary stdio MCP tests.

Original license notices are retained in `LICENSE`.
