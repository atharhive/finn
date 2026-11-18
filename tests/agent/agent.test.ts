import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { afterEach, expect, it } from "vitest";
import { FinnAgent } from "../../src/agent/index.js";
import type { AgentEvent } from "../../src/contracts.js";

const agents: FinnAgent[] = [];
const servers: Server[] = [];
type Request = { method: string; path: string; body: any };
const stamp = "2026-01-01T00:00:00Z";
const event = (type: string, extra = {}) => ({
  id: Math.random().toString(),
  type,
  thread_id: "main",
  created_at: stamp,
  ...extra,
});
const done = () =>
  event("turn.done", {
    state: {
      status: "done",
      completed_at: stamp,
      output: null,
      required_actions: [],
    },
  });
function sse(res: ServerResponse, events: any[]) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const value of events) res.write(`data: ${JSON.stringify(value)}\n\n`);
  res.end();
}
async function harness(
  override?: (req: Request, res: ServerResponse) => boolean | Promise<boolean>,
) {
  const requests: Request[] = [];
  let currentSpec: any;
  let mcpDeleted = false;
  const sessionResponse = () => ({
    data: {
      id: "session-1",
      agent: { type: "inline", spec: currentSpec },
      created_at: stamp,
      updated_at: stamp,
      created_by_subject: {
        subject_id: "local",
        subject_type: "user",
        subject_display_name: "local",
      },
      last_turn_details: null,
      metadata: {},
      metrics: { total_duration_ms: 0, total_turns: 0 },
      source: null,
      title: null,
    },
  });
  const server = createServer(async (req: IncomingMessage, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const r = {
      method: req.method!,
      path: req.url!,
      body: raw ? JSON.parse(raw) : null,
    };
    requests.push(r);
    if (await override?.(r, res)) return;
    res.setHeader("Content-Type", "application/json");
    if (r.path === "/api/v1/sessions" && r.method === "POST") {
      currentSpec = r.body.agent.spec;
      res.end(JSON.stringify(sessionResponse()));
    } else if (
      r.path === "/api/v1/sessions/session-1" &&
      (r.method === "PATCH" || r.method === "GET")
    ) {
      if (r.method === "PATCH") currentSpec = r.body.agent.spec;
      res.end(JSON.stringify(sessionResponse()));
    } else if (
      r.path.startsWith("/api/v1/settings/mcp-servers/") &&
      r.method === "DELETE"
    ) {
      mcpDeleted = true;
      res.end(JSON.stringify({ data: {} }));
    } else if (
      r.path.startsWith("/api/v1/settings/mcp-servers/") &&
      r.method === "GET"
    ) {
      if (mcpDeleted) {
        res.writeHead(404);
        res.end("{}");
        return;
      }
      const manifest = requests.find(
        (x) => x.method === "PUT" && x.path === "/api/v1/settings/mcp-servers",
      )!.body.manifest;
      res.end(JSON.stringify({ data: { name: manifest.name, manifest } }));
    } else if (r.path.endsWith("/turns") && r.method === "POST") {
      sse(res, [
        event("turn.created", {
          turn_id: "turn-1",
          previous_turn_id: null,
          state: { status: "running", started_at: stamp },
        }),
        event("model.message.delta", { content: "Hello" }),
        done(),
      ]);
    } else res.end(JSON.stringify({ data: {} }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  const config = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    model: "catalog/primary",
    mcpUrl: "http://127.0.0.1:3210/mcp",
    mcpToken: "editor-secret",
    workspaceRoot: "/workspace",
    maxRetries: 0,
  };
  return { requests, config };
}
it.each([
  [
    "terminal error",
    [
      event("turn.done", {
        state: {
          status: "error",
          completed_at: stamp,
          message: "Model unavailable",
        },
      }),
    ],
    "Model unavailable",
  ],
  [
    "truncated stream",
    [event("model.message.delta", { content: "partial" })],
    "ended without",
  ],
  [
    "cancelled turn",
    [
      event("turn.done", {
        state: { status: "cancelled", completed_at: stamp },
      }),
    ],
    "cancelled",
  ],
])("never reports success for a %s", async (_label, wireEvents, message) => {
  const { config } = await harness((r, res) => {
    if (r.path.endsWith("/turns")) {
      sse(res, wireEvents as any[]);
      return true;
    }
    return false;
  });
  const agent = new FinnAgent(config);
  agents.push(agent);
  const seen: AgentEvent[] = [];
  await expect(
    agent.run({ prompt: "Work", mode: "agent", onEvent: (e) => seen.push(e) }),
  ).rejects.toThrow(message as string);
  expect(seen.some((e) => e.type === "done")).toBe(false);
  expect(seen.some((e) => e.type === "error")).toBe(true);
});
it("honors pre-aborted signals without contacting the harness", async () => {
  const { config, requests } = await harness();
  const agent = new FinnAgent(config);
  agents.push(agent);
  const signal = AbortSignal.abort();
  await expect(
    agent.run({
      prompt: "Never run",
      mode: "agent",
      signal,
      onEvent: () => {},
    }),
  ).rejects.toThrow(/abort|cancel/i);
  expect(requests).toHaveLength(0);
});
it("aborts a streaming request and remotely cancels a running turn on signal cancellation", async () => {
  let started!: () => void;
  const ready = new Promise<void>((r) => {
    started = r;
  });
  const { config, requests } = await harness((r, res) => {
    if (!r.path.endsWith("/turns")) return false;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      `data: ${JSON.stringify(event("turn.created", { turn_id: "turn-1", previous_turn_id: null, state: { status: "running", started_at: stamp } }))}\n\n`,
    );
    started();
    return true;
  });
  const agent = new FinnAgent(config);
  agents.push(agent);
  const controller = new AbortController();
  const result = agent.run({
    prompt: "Work",
    mode: "agent",
    signal: controller.signal,
    onEvent: () => {},
  });
  const rejected = expect(result).rejects.toThrow(/abort|cancel/i);
  await ready;
  controller.abort();
  await rejected;
  expect(
    requests.some(
      (r) =>
        r.method === "POST" && r.path === "/api/v1/sessions/session-1/cancel",
    ),
  ).toBe(true);
  expect(requests.at(-1)).toMatchObject({
    method: "GET",
    path: "/api/v1/sessions/session-1",
  });
});
it("times out a stalled stream, cancels remotely and rejects rather than hanging", async () => {
  const { config, requests } = await harness((r, res) => {
    if (!r.path.endsWith("/turns")) return false;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(": heartbeat\n\n");
    return true;
  });
  const agent = new FinnAgent({ ...config, requestTimeoutMs: 1000 });
  agents.push(agent);
  await expect(
    agent.run({ prompt: "Work", mode: "agent", onEvent: () => {} }),
  ).rejects.toThrow(/timeout|timed out/i);
  expect(requests.some((r) => r.path.endsWith("/cancel"))).toBe(true);
});
it("retries explicitly rate-limited turn submissions with bounded exponential backoff", async () => {
  let count = 0;
  const { config, requests } = await harness((r, res) => {
    if (r.path.endsWith("/turns") && ++count <= 2) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Rate limited" }));
      return true;
    }
    return false;
  });
  const agent = new FinnAgent({ ...config, maxRetries: 2 });
  agents.push(agent);
  const before = Date.now();
  await agent.run({ prompt: "Work", mode: "agent", onEvent: () => {} });
  expect(Date.now() - before).toBeGreaterThanOrEqual(300);
  expect(requests.filter((r) => r.path.endsWith("/turns"))).toHaveLength(3);
});
it("switches to the configured fallback only after rejected submissions exhaust retries, preserving the session", async () => {
  let count = 0;
  const { config, requests } = await harness((r, res) => {
    if (r.path.endsWith("/turns") && ++count === 1) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Primary rate limited" }));
      return true;
    }
    return false;
  });
  const agent = new FinnAgent({ ...config, fallbackModel: "catalog/fallback" });
  agents.push(agent);
  const events: AgentEvent[] = [];
  await agent.run({
    prompt: "Work",
    mode: "agent",
    onEvent: (e) => events.push(e),
  });
  expect(
    requests.find((r) => r.method === "PATCH")?.body.agent.spec.model.name,
  ).toBe("catalog/fallback");
  expect(
    requests.filter(
      (r) => r.path === "/api/v1/sessions" && r.method === "POST",
    ),
  ).toHaveLength(1);
  expect(
    events.some((e) => e.type === "status" && e.text?.includes("fallback")),
  ).toBe(true);
});
it("never replays a turn after ambiguous network/server failure, even with fallback configured", async () => {
  const { config, requests } = await harness((r, res) => {
    if (r.path.endsWith("/turns")) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Ambiguous proxy failure" }));
      return true;
    }
    return false;
  });
  const agent = new FinnAgent({
    ...config,
    fallbackModel: "catalog/fallback",
    maxRetries: 3,
  });
  agents.push(agent);
  await expect(
    agent.run({ prompt: "Work", mode: "agent", onEvent: () => {} }),
  ).rejects.toThrow();
  expect(requests.filter((r) => r.path.endsWith("/turns"))).toHaveLength(1);
  expect(requests.some((r) => r.method === "PATCH")).toBe(false);
});
it("surfaces complete assistant messages and real tool events without duplicating streamed text", async () => {
  const call = {
    id: "call-1",
    type: "function",
    function: { name: "read_file", arguments: '{"path":"src/main.rs"}' },
    tool_info: {
      type: "mcp",
      name: "read_file",
      server_id: "editor-id",
      server_name: "editor",
    },
  };
  const { config } = await harness((r, res) => {
    if (!r.path.endsWith("/turns")) return false;
    sse(res, [
      event("model.message", { content: null, tool_calls: [call] }),
      event("tool.response", { tool_call_id: "call-1", content: "source" }),
      event("model.message.delta", { content: "Hello" }),
      event("model.message", { content: "Hello" }),
      event("model.message", { content: [{ type: "text", text: " summary" }] }),
      done(),
    ]);
    return true;
  });
  const agent = new FinnAgent(config);
  agents.push(agent);
  const events: AgentEvent[] = [];
  await agent.run({
    prompt: "Inspect",
    mode: "agent",
    onEvent: (e) => events.push(e),
  });
  expect(
    events
      .filter((e) => e.type === "text")
      .map((e) => e.text)
      .join(""),
  ).toBe("Hello summary");
  expect(events.filter((e) => e.type === "tool")).toHaveLength(2);
});
it("denies unexpected harness approvals by default using the actual turn events schema", async () => {
  const { config, requests } = await harness((r, res) => {
    if (!r.path.endsWith("/turns")) return false;
    sse(res, [
      event("turn.created", {
        turn_id: "turn-1",
        previous_turn_id: null,
        state: { status: "running", started_at: stamp },
      }),
      event("tool.approval_required", {
        tool_calls: [{ id: "call-1", source_event_id: "message-1" }],
      }),
      done(),
    ]);
    return true;
  });
  const agent = new FinnAgent(config);
  agents.push(agent);
  await expect(
    agent.run({ prompt: "Work", mode: "agent", onEvent: () => {} }),
  ).rejects.toThrow(/approval/i);
  expect(
    requests.find((r) => r.path.endsWith("/turns/turn-1/events"))?.body,
  ).toMatchObject({
    events: [
      {
        type: "user.tool_approval",
        thread_id: "main",
        tool_call_id: "call-1",
        approval: { status: "deny" },
      },
    ],
  });
});
it("includes bounded inline selection context as untrusted user data", async () => {
  const { config, requests } = await harness();
  const agent = new FinnAgent(config);
  agents.push(agent);
  await agent.run({
    prompt: "Simplify",
    mode: "inline",
    selection: {
      path: "src/lib.rs",
      startLine: 2,
      endLine: 3,
      text: "fn example() {}",
    },
    onEvent: () => {},
  });
  const content = requests.find((r) => r.path.endsWith("/turns"))?.body.input[0]
    .content;
  expect(content).toContain("Simplify");
  expect(content).toContain("src/lib.rs");
  expect(content).toContain("fn example() {}");
  expect(content).toContain("untrusted");
});
it("attaches explicitly configured native TrueForge skills with a sandbox, without inventing client-side skill tools", async () => {
  const { config, requests } = await harness();
  const agent = new FinnAgent({
    ...config,
    skills: ["finn-review-first"],
    sandboxEnvironment: "isolated-skills",
  });
  agents.push(agent);
  await agent.run({ prompt: "Work", mode: "agent", onEvent: () => {} });
  const spec = requests.find(
    (r) => r.path === "/api/v1/sessions" && r.method === "POST",
  )?.body.agent.spec;
  expect(spec.skills).toEqual([{ name: "finn-review-first", preload: true }]);
  expect(spec.config.sandbox).toMatchObject({
    enabled: true,
    environment_name: "isolated-skills",
    file_downloads: false,
  });
});
it.each([
  [{ model: "" }, /model/i],
  [{ maxRetries: Number.NaN }, /retries/i],
  [{ requestTimeoutMs: 0 }, /timeout/i],
  [{ baseUrl: "https://user:secret@example.com" }, /credentials/i],
  [{ mcpToken: "" }, /token/i],
])("rejects unsafe or unbounded configuration %j", async (change, message) => {
  const { config } = await harness();
  expect(() => new FinnAgent({ ...config, ...change })).toThrow(message);
});
it("removes and verifies removal of its bearer-bearing MCP registration on disposal", async () => {
  const { config, requests } = await harness();
  const agent = new FinnAgent(config);
  agents.push(agent);
  await agent.run({ prompt: "Work", mode: "agent", onEvent: () => {} });
  await agent.dispose();
  expect(
    requests.some(
      (r) =>
        r.method === "DELETE" &&
        r.path.startsWith("/api/v1/settings/mcp-servers/"),
    ),
  ).toBe(true);
  expect(requests.at(-1)?.method).toBe("GET");
  await expect(
    agent.run({ prompt: "No", mode: "agent", onEvent: () => {} }),
  ).rejects.toThrow(/disposed/);
});
it("falls back safely when session validation rejects an unavailable primary model", async () => {
  const { config, requests } = await harness((r, res) => {
    if (
      r.path === "/api/v1/sessions" &&
      r.method === "POST" &&
      r.body.agent.spec.model.name === "catalog/primary"
    ) {
      res.writeHead(422, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message:
              'Unknown model "catalog/primary" — provider not configured',
          },
        }),
      );
      return true;
    }
    return false;
  });
  const agent = new FinnAgent({ ...config, fallbackModel: "catalog/fallback" });
  agents.push(agent);
  await agent.run({ prompt: "Work", mode: "agent", onEvent: () => {} });
  expect(
    requests
      .filter((r) => r.path === "/api/v1/sessions" && r.method === "POST")
      .map((r) => r.body.agent.spec.model.name),
  ).toEqual(["catalog/primary", "catalog/fallback"]);
});
it("rejects unbounded prompt and selection payloads before contacting TrueForge", async () => {
  const { config, requests } = await harness();
  const agent = new FinnAgent(config);
  agents.push(agent);
  await expect(
    agent.run({
      prompt: "x".repeat(200_001),
      mode: "agent",
      onEvent: () => {},
    }),
  ).rejects.toThrow(/large|limit/i);
  expect(requests).toHaveLength(0);
});
it("retries terminal model failures with backoff before any tools, then changes model on the same session", async () => {
  let turns = 0;
  const { config, requests } = await harness((r, res) => {
    if (!r.path.endsWith("/turns")) return false;
    turns++;
    if (turns <= 2) {
      sse(res, [
        event("turn.done", {
          state: {
            status: "error",
            completed_at: stamp,
            message: "Provider authentication failed",
          },
        }),
      ]);
      return true;
    }
    return false;
  });
  const agent = new FinnAgent({
    ...config,
    maxRetries: 1,
    fallbackModel: "catalog/fallback",
  });
  agents.push(agent);
  await agent.run({ prompt: "Work", mode: "agent", onEvent: () => {} });
  expect(turns).toBe(3);
  expect(
    requests.find((r) => r.method === "PATCH")?.body.agent.spec.model.name,
  ).toBe("catalog/fallback");
});
it("never retries terminal errors once a tool has been invoked", async () => {
  const call = {
    id: "call-1",
    type: "function",
    function: { name: "propose_edit", arguments: "{}" },
    tool_info: {
      type: "mcp",
      name: "propose_edit",
      server_id: "editor-id",
      server_name: "editor",
    },
  };
  const { config, requests } = await harness((r, res) => {
    if (!r.path.endsWith("/turns")) return false;
    sse(res, [
      event("model.message", { tool_calls: [call] }),
      event("turn.done", {
        state: {
          status: "error",
          completed_at: stamp,
          message: "Provider failed after tool",
        },
      }),
    ]);
    return true;
  });
  const agent = new FinnAgent({
    ...config,
    maxRetries: 2,
    fallbackModel: "catalog/fallback",
  });
  agents.push(agent);
  await expect(
    agent.run({ prompt: "Work", mode: "agent", onEvent: () => {} }),
  ).rejects.toThrow("Provider failed after tool");
  expect(requests.filter((r) => r.path.endsWith("/turns"))).toHaveLength(1);
  expect(requests.some((r) => r.method === "PATCH")).toBe(false);
});
it("configures native context compaction by default and surfaces its events", async () => {
  const { config, requests } = await harness((r, res) => {
    if (!r.path.endsWith("/turns")) return false;
    sse(res, [
      event("thread.context_compaction_started", {
        trigger: {
          type: "context_threshold_exceeded",
          context_tokens: 9000,
          threshold_tokens: 8000,
        },
      }),
      done(),
    ]);
    return true;
  });
  const agent = new FinnAgent(config);
  agents.push(agent);
  const events: AgentEvent[] = [];
  await agent.run({
    prompt: "Work",
    mode: "agent",
    onEvent: (e) => events.push(e),
  });
  expect(
    requests.find((r) => r.path === "/api/v1/sessions" && r.method === "POST")
      ?.body.agent.spec.config.context_management.compaction.enabled,
  ).toBe(true);
  expect(events.some((e) => e.type === "context")).toBe(true);
});
it("exhausts both model budgets and returns the final genuine provider error", async () => {
  const { config, requests } = await harness((r, res) => {
    if (!r.path.endsWith("/turns")) return false;
    sse(res, [
      event("turn.done", {
        state: {
          status: "error",
          completed_at: stamp,
          message: "Genuine provider failure",
        },
      }),
    ]);
    return true;
  });
  const agent = new FinnAgent({
    ...config,
    maxRetries: 1,
    fallbackModel: "catalog/fallback",
  });
  agents.push(agent);
  await expect(
    agent.run({ prompt: "Work", mode: "agent", onEvent: () => {} }),
  ).rejects.toThrow("Genuine provider failure");
  expect(requests.filter((r) => r.path.endsWith("/turns"))).toHaveLength(4);
});
it("does not mark turns with unresolved required actions as successful", async () => {
  const { config } = await harness((r, res) => {
    if (!r.path.endsWith("/turns")) return false;
    sse(res, [
      event("turn.done", {
        state: {
          status: "done",
          completed_at: stamp,
          output: null,
          required_actions: [
            event("tool.approval_required", {
              tool_calls: [{ id: "call-1", source_event_id: "message-1" }],
            }),
          ],
        },
      }),
    ]);
    return true;
  });
  const agent = new FinnAgent(config);
  agents.push(agent);
  await expect(
    agent.run({ prompt: "Work", mode: "agent", onEvent: () => {} }),
  ).rejects.toThrow(/required action/i);
});
afterEach(async () => {
  await Promise.all(agents.splice(0).map((a) => a.dispose().catch(() => {})));
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((r) => {
          s.closeAllConnections();
          s.close(() => r());
        }),
    ),
  );
});
it("uses the real SDK HTTP contract to register editor MCP, create an inline agent session and stream a chained turn", async () => {
  const { requests, config } = await harness();
  const agent = new FinnAgent(config);
  agents.push(agent);
  const events: AgentEvent[] = [];
  expect(
    await agent.run({
      prompt: "Inspect the project",
      mode: "agent",
      onEvent: (e) => events.push(e),
    }),
  ).toEqual({ sessionId: "session-1" });
  expect(
    events
      .filter((e) => e.type === "text")
      .map((e) => e.text)
      .join(""),
  ).toBe("Hello");
  expect(events.at(-1)?.type).toBe("done");
  const registration = requests.find(
    (r) => r.path === "/api/v1/settings/mcp-servers" && r.method === "PUT",
  )!;
  expect(registration.body.manifest).toMatchObject({
    type: "remote",
    url: config.mcpUrl,
    auth: {
      type: "header",
      headers: { Authorization: "Bearer editor-secret" },
    },
  });
  const session = requests.find((r) => r.path === "/api/v1/sessions")!;
  expect(session.body.agent.spec.model.name).toBe(config.model);
  expect(session.body.agent.spec.instructions).toContain("propose_edit");
  expect(session.body.agent.spec.mcp_servers[0]).toMatchObject({
    enable_tools: [
      "read_file",
      "search_workspace",
      "propose_edit",
      "run_command",
      "assemble_context",
    ],
    require_approval_for_tools: [],
  });
  expect(requests.find((r) => r.path.endsWith("/turns"))?.body).toMatchObject({
    stream: true,
    previous_turn_id: "auto",
    input: [{ type: "user.message", content: "Inspect the project" }],
  });
  await agent.run({ prompt: "Continue", mode: "agent", onEvent: () => {} });
  expect(
    requests.filter(
      (r) => r.path === "/api/v1/sessions" && r.method === "POST",
    ),
  ).toHaveLength(1);
});
