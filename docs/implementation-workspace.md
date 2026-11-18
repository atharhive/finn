# Workspace bridge implementation

`src/workspace/index.ts` exports `createWorkspace`, `WorkspaceService`, `WorkspaceOptions`, and `Proposal`. It imports shared `CommandRequest`, `ContextRequest`, and `ContextBundle` without changing them.

## API

```ts
const workspace = await createWorkspace({
  root,
  onChange: proposals => renderReview(proposals),
  approveCommand: request => showExplicitHumanApproval(request),
  contextProvider: request => context.assemble(request),
});
const { url, token } = await workspace.startMcpServer();
```

The agreed API is implemented exactly: `listProposals`, `acceptHunk`, `rejectHunk`, `undo`, `discardPending`, `dispose`, and `startMcpServer`. Additional direct APIs:

- `readFile(path): Promise<string>`
- `searchWorkspace(query): Promise<Array<{path,line,text}>>`, literal search, 1-based lines, at most 200 matches and 10,000 entries visited. Build/dependency directories are skipped.
- `proposeEdit(path, content, originalHash?): Promise<Proposal>`, optional lowercase SHA-256 hash of the original UTF-8 content.
- `runCommand(request, signal?): Promise<{stdout,stderr,exitCode,truncated}>`
- `assembleContext(request): Promise<ContextBundle>`

Paths are relative to the canonical workspace root. Empty/no-op, binary and over-1-MiB replacements are rejected. Existing files and new files with existing parent directories are supported. No directories or files are created during proposal staging.

## Human review and undo

Every proposal is an in-memory full replacement plus individually identified diff hunks. Only `acceptHunk` writes an edit. Rejecting, previewing, listing, assembling context and proposing never write source files. Hunk actions are serialized, including concurrent UI requests. Acceptance compares current content with the proposal's expected state and rechecks it through the writable file descriptor before writing. External edits make pending acceptance stale rather than being overwritten.

Undo is LIFO per accepted hunk, using inverse contextual patches rather than restoring an old full-file snapshot. Unrelated external edits survive. Conflicting edits cause an error without a write. Undo returns the hunk to pending. Untouched newly created files are removed on undo; externally changed new files are not deleted. Reaccepting an undone hunk preserves unrelated external edits.

`discardPending` cancels commands and context assembly, invalidates in-flight proposal staging, and marks pending hunks rejected without reverting accepted human changes. `dispose` additionally waits for processes/review operations to settle and closes all MCP sessions and the listener. Dispose is idempotent.

## MCP transport

Uses official `@modelcontextprotocol/sdk` `McpServer` and `StreamableHTTPServerTransport`, not a hand-written MCP imitation. The listener binds an ephemeral port only on `127.0.0.1`. Each bridge generates a random 256-bit bearer token. All methods require `Authorization: Bearer <token>`, exact loopback Host, and either no Origin (native clients) or the exact listener Origin. Requests are limited to 2 MiB, including chunked bodies. Stateful SDK transports are isolated per session, limited to 16 sessions, and support initialization/session IDs/DELETE termination.

Tool schemas:

- `read_file`: `{path}`
- `search_workspace`: `{query}`
- `propose_edit`: `{path,content,originalHash?}`
- `run_command`: `{command,args,cwd?,timeoutMs?}`
- `assemble_context`: `{query,maxTokens,mentions?}`

Results use MCP text content containing JSON. SDK tool errors remain actual errors, never fabricated success. There is intentionally no MCP accept/write/undo tool. Human UI calls those direct APIs.

## Security boundaries

Reads, proposals, writes, undo and returned context paths reject traversal, absolute paths, symlinks (including in-workspace symlinks), hardlinked files, `.git`, dotenv files, credential directories/files and common key extensions. Files must be regular, nonbinary UTF-8 text under 1 MiB. Paths are revalidated on acceptance and undo. Linux file operations additionally walk parent directories through `O_DIRECTORY|O_NOFOLLOW` handles and `/proc/self/fd`, preventing parent-symlink swaps between validation and opening. Other platforms use canonical checks and final-component `O_NOFOLLOW` where supported; they do not have Linux directory-FD anchoring.

Commands have no default approval. The callback receives an independent clone of the exact request; only an explicit `true` authorizes execution. Cwd is revalidated after approval. Spawning uses an executable and argument array, never an implicit shell. Execution is capped at 30 seconds including approval, and combined stdout/stderr at 64 KiB. Output overflow terminates the command and reports truncation. Cancellation and timeout kill the POSIX process group, including ordinary child processes. Environment contains only PATH, workspace HOME, LANG and CI, not inherited provider credentials. **Approved commands are not an OS sandbox**: a human-approved executable can access the user's other files, mutate files, or deliberately detach children. Review commands accordingly. Windows uses direct child termination rather than POSIX process-group semantics.

Context receives the real query, budget, mentions and cancellation signal. Returned context file paths are validated with the same read policy; unavailable context providers fail explicitly.

## Verification

`npx vitest run tests/workspace`

Real filesystem tests cover multi-file/multi-hunk review, rejection, stale acceptance, hash mismatch, concurrency, new files, preserving external changes on undo/reaccept, cancellation during staging/approval/execution, disposal, traversal, symlink replacement and hardlinks. Real official-SDK HTTP integration tests initialize sessions, invoke all five tools, terminate sessions, reject unknown sessions, verify auth/Host/Origin/body limits, and cancel an approved process tree through an MCP request.

The installed SDK, Zod 4 and Vitest 5 APIs are compatible. Root TypeScript checks may include unrelated in-progress areas; no root configuration was modified by this worker.
