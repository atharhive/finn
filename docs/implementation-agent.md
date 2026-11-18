# Finn agent integration

## Public API

`src/agent/index.ts` exports `FinnAgent` and `FINN_INSTRUCTIONS`.

```ts
const agent = new FinnAgent({
  baseUrl: 'http://127.0.0.1:8790',
  model: 'a-real-provider/a-configured-model',
  fallbackModel: 'a-real-provider/a-second-configured-model', // optional
  mcpUrl: editor.url,
  mcpToken: editor.token,
  workspaceRoot: root,
  maxRetries: 2,             // optional, integer 0 through 5
  requestTimeoutMs: 60000,  // optional, whole run deadline, maximum one hour
});
await agent.run({ prompt, mode: 'agent', signal, onEvent });
await agent.cancel();
await agent.dispose();
```

Model strings above are placeholders, not available models. Use exact references returned by the real TrueForge model catalog. Finn never calls model providers. Provider credentials belong in TrueForge, not the extension.

`run` returns `{ sessionId }` only after a successful terminal `turn.done` with no pending actions. One agent instance retains one inline session across sequential turns. Concurrent runs reject. Inline selections are JSON-encoded as untrusted user data. Prompt and selection payloads each have a 200000-byte limit. Disposed instances cannot run again.

Additional `FinnAgentConfig` options: `token` is an optional TrueForge ID token; `skills` is a list of configured native skill names; `sandboxEnvironment` selects an isolated TrueForge sandbox for those skills. These are programmatic options, not VSCode settings unless the extension adds corresponding configuration. No environment variables are implicitly consumed by FinnAgent.

## Verified SDK and HTTP contract

Implementation uses `@truefoundry/trueforge-sdk` **0.185.0**, not handwritten guessed endpoints. Authoritative definitions inspected in the downloaded SDK and installed package:

- `AgentSpec`, `McpServer`, `RemoteMcpServerManifest`, `McpServerHeaderAuth`, `RuntimeConfig`, `ContextManagementConfig`, `CompactionConfig`.
- `SessionsClient` and requests for session creation, update, streaming turns, cancellation and turn events.
- `TurnStreamingEvent`, `ModelMessageEvent`, `ModelMessageDeltaEvent`, `TurnDoneEvent`, `ToolApprovalRequiredEvent`, `UserToolApprovalInputEvent`.
- `GitSkill`, `Skill`, `SandboxConfig`, and the native skill settings client.

The SDK serializes camelCase inputs to the actual snake_case HTTP schema:

1. `PUT /api/v1/settings/mcp-servers` registers a unique per-instance remote editor connector with header-based bearer authentication. `GET /api/v1/settings/mcp-servers/{name}` verifies its URL.
2. `POST /api/v1/sessions` uses `agent: { spec: AgentSpec }`. An inline spec is the actual harness-supported agent definition and avoids mutating shared named agents.
3. `POST /api/v1/sessions/{id}/turns` has `stream: true`, `previous_turn_id: "auto"`, and `input: [{ type: "user.message", content }]`.
4. SDK SSE parsing exposes real assistant deltas, complete messages, tool calls/results, lifecycle and compaction events. Completed messages do not duplicate their preceding text deltas. No hidden reasoning content is exposed as assistant text.
5. Model fallback updates the same inline session with `PATCH /api/v1/sessions/{id}`, then verifies the selected model with `GET`.
6. Cancellation sends `POST /api/v1/sessions/{id}/cancel`, then polls that session for an inactive terminal state, bounded to five seconds. It does not report remote cancellation as verified merely because the request returned HTTP 200.
7. Disposal aborts and settles the active request, deletes its bearer-bearing MCP registration, and verifies HTTP 404 on read-back. Session history remains in TrueForge for audit; it is not silently deleted.

## Retry and fallback safety

The SDK's implicit retries are disabled. Finn's visible retry policy is bounded by the overall run deadline:

- Explicit HTTP 429 turn rejection: retry with exponential delays starting at 100ms and capped at 2000ms, at most `maxRetries` per selected model.
- Explicit terminal `turn.done` with `state.status: "error"`: retry only if that attempt has **never emitted any tool-call delta, complete tool call, tool event, or user tool response/approval**. This handles provider authentication/network failures reported inside accepted SSE turns.
- After that model's retry budget, switch once to the configured fallback model on the same session, verify the update, then use its own bounded retry budget.
- An explicit unknown-model HTTP 422 during session validation or turn submission can switch directly to fallback. Other validation errors do not.
- Never replay after tool invocation, truncated SSE, parse failures, transport uncertainty, HTTP 5xx, cancellation, or unresolved client actions. An upstream proxy failure could conceal already-running tool execution.
- Exhaustion rejects with the genuine final provider error and emits an error event. There is no mock-success path. Retried pre-tool attempts may already have emitted text; status events clearly announce retries, rather than pretending those earlier attempts did not occur.

## Editor tools and approvals

Only `read_file`, `search_workspace`, `propose_edit`, `run_command`, and `assemble_context` are enabled for the editor MCP connector. The SDK `requireApprovalForTools: []` deliberately avoids a duplicate harness approval gate for this connector: `run_command` must obtain explicit human approval inside the editor workspace service. This is not permission to execute commands without approval.

Unexpected harness `tool.approval_required` events are denied with the real `user.tool_approval` turn-events schema. Finn then rejects rather than auto-approving or hanging. MCP authentication and client-side tool response requirements are reported as setup errors. This version does not expose a general-purpose upstream approval UI.

Instructions require all changes to go through in-memory `propose_edit` and human hunk acceptance. No model-generated shell writes are permitted. Enforcement of paths, secrets, command approvals, proposal writes and process cancellation belongs to `src/workspace/`, not to model instructions alone. The extension must discard pending workspace proposals and cancel workspace commands when cancelling a run; FinnAgent cannot itself access that service through the shared contract. Accepted human changes are never undone by cancellation.

## Context engineering enabled by default

Every agent definition explicitly enables **native TrueForge context compaction**. The SDK's documented default trigger is 80% of the selected model context length, or 50000 tokens if that length is unknown. Compaction start/finish events become real `context` events with the original harness payload. No fake token metrics are generated.

Instructions additionally require `assemble_context` with the actual query and a bounded budget before exploration. The editor context provider owns repository selection and token accounting. The five editor schemas are preloaded because their surface is small. Large-response sandbox offloading is explicitly disabled in the default no-sandbox configuration; do not imply it works without a sandbox.

## Native harness skills

`src/agent/skills/review-first/SKILL.md` supplies meaningful Finn-specific review/TDD/context/verification guidance. Native skills are real TrueForge resources, not a simulated local tool.

`src/agent/skills.ts` exports `registerFinnReviewSkill(client, { url, ref, name? })`. This **explicit administrative setup** uses the verified native skill upsert API, points to `src/agent/skills/review-first`, and verifies the stored manifest through the native skill list API. Supply a reachable HTTPS GitHub/GitLab repository containing this file and preferably an immutable commit revision. No repository is published or fabricated by the helper.

Then create FinnAgent with `skills: ['finn-review-first']` and an appropriate `sandboxEnvironment`. The agent spec attaches those skill names with `preload: true`; TrueForge loads their actual SKILL.md content. The SDK explicitly says skills require a sandbox, so Finn enables an isolated harness sandbox when skills are selected and disables file downloads. Configure a sandbox provider/environment in TrueForge first. **Never mount the editor workspace into that sandbox.** Native skills are opt-in because a fresh harness has no configured sandbox or registered skill; missing setup fails honestly. Default native compaction does not depend on that optional setup.

## Actual runtime setup requirements

Use the project's `npm run trueforge` launcher for TrueForge 0.185.0 on `http://127.0.0.1:8790`. Stock TrueForge blocks private outbound addresses, including the editor's loopback MCP URL. The narrowly scoped launcher must keep network policy enabled and set:

```sh
HOST=127.0.0.1
NETWORK_POLICY_ENABLED=true
OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1","localhost"]'
```

Do **not** disable the whole network guard. These are harness server environment settings, not FinnAgent settings. The launcher and server are parent-owned files outside this implementation's ownership.

The harness must run on the same host/network namespace as the editor to reach its 127.0.0.1 MCP listener. A remotely hosted harness cannot access the editor's loopback address; remote networking/tunnelling and stronger authentication need an explicit deployment design. Configuring an authenticated remote server also requires the optional TrueForge `token` and server-side permission to manage its own MCP connector and sessions.

Configure at least one real model provider in TrueForge. During initial verification, `GET /api/v1/models` returned `{"data":[]}` and real session creation rejected an unconfigured model with HTTP 422 and `Unknown model ... provider not configured`. This is a setup blocker for inference, not a successful model demonstration.

## Tests and actual evidence

Deterministic HTTP contract tests start a test-only local server and use the **real installed SDK** over HTTP/SSE. They cover registration, inline agent definitions, session reuse, streaming text/tool events, native context configuration, native skill registration, abort/timeout/remote cancellation, safe retry/fallback, refusal to replay tools/ambiguous failures, input limits and disposal. These fixtures are not part of production and are not claimed as live inference.

```sh
npx vitest run tests/agent
FINN_TRUEFORGE_LIVE_URL=http://127.0.0.1:8790 npx vitest run tests/agent
npm run typecheck
```

The opt-in live contract test starts the real editor workspace MCP service, registers its bearer-authenticated connector in the running TrueForge server, verifies an honest unknown-model error, and verifies cleanup. It requires the loopback allowlist above. It never bypasses the harness or supplies fake model responses.

Verified result after the allowlisted server restart: **3 test files, 29 tests passed**, including that live TrueForge registration/error/cleanup test; root TypeScript typecheck passed.

## Live model-backed evidence

`tests/agent/live-model.test.ts` is skipped unless both variables are set:

```sh
FINN_TRUEFORGE_LIVE_URL=http://127.0.0.1:8790 FINN_LIVE_MODEL=<provider>/<model> \
  npx vitest run tests/agent/live-model.test.ts
```

The first case drives a real model turn: streamed text arrives, the model calls `read_file` and `propose_edit` over the authenticated editor MCP bridge, the proposal stays in memory with pending hunks, the source file is byte-identical before acceptance, an accepted hunk writes the reviewed change, and `undo` restores the original bytes. The second case cancels a real streaming turn and asserts that the run rejects, no proposals remain, and no file changed.

Verified on 18 November 2026 against TrueForge 0.185.0 and a real OpenAI-compatible provider (`deepseek-v4.1-flash`): **2 tests passed in 21.2s**. The provider endpoint sat behind the loopback allowlist; Finn never contacted a provider directly.

Tool timeline labels come from the SDK stream: a tool call is announced as `Tool call: <name>` the moment its name arrives, and its result as `Tool result: <name>`. Names resolved from `toolInfo.name`, falling back to `function.name`, so the editor shows real tool names instead of raw payloads.

Provider endpoints that require extra routing headers are fronted by a local loopback shim during verification. That shim is test infrastructure in the scratch directory, not part of Finn and not committed.
