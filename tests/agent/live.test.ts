import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { TrueForge } from "@truefoundry/trueforge-sdk";
import { FinnAgent } from "../../src/agent/index.js";
import { createWorkspace } from "../../src/workspace/index.js";
import type { AgentEvent } from "../../src/contracts.js";

// Opt-in real runtime contract check. Does not claim to verify inference.
it.runIf(Boolean(process.env.FINN_TRUEFORGE_LIVE_URL))(
  "real TrueForge accepts authenticated editor registration and honestly rejects an unconfigured model",
  async () => {
    const baseUrl = process.env.FINN_TRUEFORGE_LIVE_URL!;
    const client = new TrueForge({ baseUrl, auth: false, maxRetries: 0 });
    const root = await mkdtemp(join(tmpdir(), "finn-live-agent-"));
    const workspace = await createWorkspace({
      root,
      approveCommand: async () => false,
    });
    const mcp = await workspace.startMcpServer();
    const before = (await client.settings.mcpServers.list()).data.map(
      (server) => server.name,
    );
    const agent = new FinnAgent({
      baseUrl,
      model: "finn-unconfigured-provider/unconfigured-model",
      mcpUrl: mcp.url,
      mcpToken: mcp.token,
      workspaceRoot: root,
      maxRetries: 0,
      requestTimeoutMs: 15_000,
    });
    try {
      const events: AgentEvent[] = [];
      await expect(
        agent.run({
          prompt: "Do not execute tools. This verifies missing setup handling.",
          mode: "agent",
          onEvent: (e) => events.push(e),
        }),
      ).rejects.toThrow(/Unknown model/);
      expect(
        events.some(
          (event) =>
            event.type === "error" && event.text?.includes("Unknown model"),
        ),
      ).toBe(true);
      expect(events.some((event) => event.type === "done")).toBe(false);
      const during = (await client.settings.mcpServers.list()).data.map(
        (server) => server.name,
      );
      expect(during.filter((name) => !before.includes(name))).toHaveLength(1);
      await agent.dispose();
      const after = (await client.settings.mcpServers.list()).data.map(
        (server) => server.name,
      );
      expect(after.filter((name) => !before.includes(name))).toHaveLength(0);
    } finally {
      await agent.dispose();
      await workspace.dispose();
      await rm(root, { recursive: true, force: true });
    }
  },
);
