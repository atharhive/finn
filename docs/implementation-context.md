# Repository context implementation

## Public API

```ts
import { createContextProvider } from '../src/context/index.js';
const provider = await createContextProvider({ root: workspaceRoot, binaryPath: enginePath });
try {
  const bundle = await provider.assemble({
    query: 'Fix session expiry when refreshing cookies @symbol:refreshSession',
    mentions: ['@file:src/session.ts'],
    maxTokens: 12000,
    signal,
  });
} finally {
  await provider.dispose();
}
```

`ContextProvider`, `assemble(ContextRequest)` and `dispose()` use the shared contracts. If omitted, the binary defaults to `<root>/target/debug/finn_mcp`. Packaged extensions should supply their engine path. There are no framework-specific production paths and no inference calls.

## Engine reuse and actual task relevance

The official MCP SDK stdio client starts the existing Rust Finn MCP binary. Every assembly calls its real `optimize_context` tool with the **actual request query** and budget. That runs the imported repository-intelligence, dependency-graph and context-optimizer crates unchanged.

Before calling Rust, the provider builds a private, symlink-free snapshot containing only allowed source files. The engine's file reader cannot accidentally ingest denied files. Snapshots use a private `mkdtemp` directory under `TMPDIR` when configured, file mode 0600, and are deleted in `finally`. Source repositories are never modified. This costs copying and fresh analysis each request, deliberately favoring isolation and freshness over cache performance.

Rust's chosen paths and human-readable graph/path reasons become candidates. Independent bounded source-body discovery adds any safe file containing query terms, including files Rust did not choose. Each unique lowercase ASCII query term of at least three characters matching source text contributes 10 points; Rust-selected files receive an additional point. Ranking is deterministic by descending score then path. These are lexical heuristics, not semantic embeddings or model judgments. Source text comes from the safe inventory, never unvalidated engine-provided content.

Explicit mentions rank first:

- `@file:path/to/file`, `@file(path with spaces.ts)`, or `@file path/to/file`.
- `@symbol:identifier`, `@symbol(identifier)`, or `@symbol identifier`.
- Both inline query mentions and `mentions[]` are accepted. Plain entries in `mentions[]` mean repository-relative file paths.
- Files receive priority 1,000,000; symbols 100,000. Deduplication is by path.
- Symbol lookup recognizes lexical declarations (`function`, `class`, `def`, `fn`, `struct`, `enum`, `interface`, `type`, `const`, `let`, `var`, `trait`). It is not a language-server symbol resolver. Ambiguous declarations include all matching files. Unsupported/unresolved symbols warn rather than inventing content.
- Missing, ignored, traversal, absolute, secret or symlink mentions never bypass the inventory and produce explicit unresolved/denied warnings.

## Security and bounded discovery

The canonical workspace root is used throughout. All symbolic links are excluded, including links targeting another location inside the workspace. File reads check each component with `lstat`, canonical equality, a final-component `O_NOFOLLOW` open, bounded size, and canonical equality after reading. `.git` internals, common credential directories, `.env` variants, environment scripts, API-key/service-account files, private-key formats, secret/credential/token names, package caches and common build output are denied. Binary/NUL and invalid UTF-8 files are excluded. This is a filename/directory policy, **not a comprehensive secret scanner** for credentials embedded in otherwise legitimate source. Workspaces should not contain committed inline credentials. Ordinary canonical checks are not an OS sandbox against a hostile process continuously racing filesystem renames.

Root and nested `.gitignore`, `.ignore`, and `.finnignore` files use the `ignore` package. Rules apply to automatic selection and mentions equally. Ignore files are policy inputs, not returned context. Parent exclusions remain authoritative: nested negations cannot reopen a parent-denied path. Git global excludes are not loaded.

Scanning visits at most 4,000 entries, reads at most 16 MiB of accepted text and admits files up to 512 KiB. Reaching limits or encountering unreadable/oversized files emits warnings; discovery is not advertised as complete. Rust warning counts are exposed without echoing arbitrary engine diagnostics or private snapshot paths.

## Reproducible conservative budget

For each returned file:

```ts
tokens = Buffer.byteLength(JSON.stringify({ path, content, reasons }), 'utf8');
```

`bundle.tokens` is the sum of those costs, enforced to stay at or below `maxTokens`. This intentionally charges **one conservative token per serialized UTF-8 byte**, including escaping, path and explanation overhead. It is not a model tokenizer or an exact inference-token metric. Consumers must reserve separate room for their instructions, conversations, tools and enclosing bundle/transport metadata. Do not pass an unreserved model context-window size directly.

Whole files are admitted greedily in priority order. Oversized files are omitted with budget warnings, never silently truncated. Explicit mentions do not override the budget. Zero budgets return no files. Negative, fractional, infinite and NaN budgets reject. This conservative policy can underfill the available model window substantially.

## Failure and cancellation

Missing/non-executable binaries and handshake failures reject with `Rust Finn engine unavailable`; engine tool errors reject, rather than returning fabricated fallback context. Startup and tool requests have 15s and 30s timeouts respectively. Pre-aborted requests reject immediately. In-flight cancellation closes the stdio client/process, aborts provider work and makes the provider terminal; callers must create a fresh provider afterward. Disposing is idempotent and aborts ongoing work. The SDK closes the child process, while assembly `finally` cleans up its snapshot.

## Verification

Run `npx vitest run tests/context`. The provider tests start `/home/ubuntu/finn/target/debug/finn_mcp` for real (no success mocks or conditional skips), using small temporary repositories. They cover source content, actual query-body relevance, explainability, conservative Unicode budgets, zero/invalid budgets, ignore/secret/symlink denial, explicit files/symbols, cancellation/disposal and unavailable-engine errors. Unit fixture tests exercise additional credential inventory exclusions without starting Rust. Build the inherited Rust binary before running integration tests.
