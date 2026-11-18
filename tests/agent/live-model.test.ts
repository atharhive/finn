import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { FinnAgent } from "../../src/agent/index.js";
import { createWorkspace } from "../../src/workspace/index.js";
import type { AgentEvent } from "../../src/contracts.js";

// Opt-in real inference check through a locally running TrueForge.
// Requires FINN_TRUEFORGE_LIVE_URL plus FINN_LIVE_MODEL set to a configured
// provider/model reference whose upstream supports tool calling.
const live = Boolean(process.env.FINN_TRUEFORGE_LIVE_URL && process.env.FINN_LIVE_MODEL);
const baseUrl = process.env.FINN_TRUEFORGE_LIVE_URL ?? "";
const model = process.env.FINN_LIVE_MODEL ?? "";

let root = "";
const source = 'def greet(name):\n    """Return a greeting."""\n    return f"Hi, {name}!"\n';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "finn-live-model-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "greeting.py"), source);
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

it.runIf(live)(
  "drives a real model through TrueForge tools into a reviewed, undoable edit",
  async () => {
    const workspace = await createWorkspace({ root, approveCommand: async () => false });
    const mcp = await workspace.startMcpServer();
    const agent = new FinnAgent({
      baseUrl,
      model,
      mcpUrl: mcp.url,
      mcpToken: mcp.token,
      workspaceRoot: root,
      maxRetries: 0,
      requestTimeoutMs: 180_000,
    });
    const events: AgentEvent[] = [];
    try {
      const result = await agent.run({
        prompt:
          "Read src/greeting.py, then propose an edit that changes the returned greeting text from 'Hi,' to 'Hello,'. Do not run commands.",
        mode: "agent",
        onEvent: (event) => events.push(event),
      });
      expect(result.sessionId).toMatch(/\S/);

      const streamed = events.filter((event) => event.type === "text");
      expect(streamed.reduce((total, event) => total + (event.text?.length ?? 0), 0)).toBeGreaterThan(0);

      const toolText = events
        .filter((event) => event.type === "tool")
        .map((event) => event.text ?? "");
      expect(toolText).toContain("Tool call: read_file");
      expect(toolText.some((text) => text.includes("propose_edit"))).toBe(true);

      const proposals = workspace.listProposals();
      expect(proposals.length).toBeGreaterThan(0);
      const proposal = proposals.find((item) => item.path.endsWith("greeting.py"));
      expect(proposal).toBeDefined();
      const pending = proposal!.hunks.filter((hunk) => hunk.status === "pending");
      expect(pending.length).toBeGreaterThan(0);
      expect(proposal!.proposed).toContain("Hello,");

      // Nothing may reach disk before a human accepts a reviewed hunk.
      expect(await readFile(join(root, "src", "greeting.py"), "utf8")).toBe(source);

      await workspace.acceptHunk(proposal!.id, pending[0].id);
      expect(await readFile(join(root, "src", "greeting.py"), "utf8")).toContain("Hello,");

      await workspace.undo();
      expect(await readFile(join(root, "src", "greeting.py"), "utf8")).toBe(source);
    } finally {
      await agent.dispose();
      await workspace.dispose();
    }
  },
  240_000,
);

it.runIf(live)(
  "cancels a real turn without writing files or leaving pending proposals",
  async () => {
    const workspace = await createWorkspace({ root, approveCommand: async () => false });
    const mcp = await workspace.startMcpServer();
    const agent = new FinnAgent({
      baseUrl,
      model,
      mcpUrl: mcp.url,
      mcpToken: mcp.token,
      workspaceRoot: root,
      maxRetries: 0,
      requestTimeoutMs: 180_000,
    });
    const events: AgentEvent[] = [];
    try {
      const running = agent.run({
        prompt:
          "Read every Python file in this repository and explain each function in detail before doing anything else.",
        mode: "agent",
        onEvent: (event) => {
          events.push(event);
          if (event.type === "text") void agent.cancel();
        },
      });
      await expect(running).rejects.toThrow(/cancel/i);
      expect(workspace.listProposals()).toHaveLength(0);
      expect(await readFile(join(root, "src", "greeting.py"), "utf8")).toBe(source);
    } finally {
      await agent.dispose();
      await workspace.dispose();
    }
  },
  240_000,
);
