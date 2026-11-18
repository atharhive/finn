import { createServer } from "node:http";
import { expect, it } from "vitest";
import { TrueForge } from "@truefoundry/trueforge-sdk";
import { registerFinnReviewSkill } from "../../src/agent/skills.js";

it("registers and reads back Finn review guidance through the real native skills HTTP contract", async () => {
  let stored: any;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    res.setHeader("Content-Type", "application/json");
    if (req.method === "PUT" && req.url === "/api/v1/settings/skills") {
      stored = JSON.parse(raw).manifest;
      res.end(
        JSON.stringify({ data: { name: stored.name, manifest: stored } }),
      );
    } else if (req.method === "GET" && req.url === "/api/v1/settings/skills") {
      res.end(
        JSON.stringify({ data: [{ name: stored.name, manifest: stored }] }),
      );
    } else {
      res.writeHead(404);
      res.end("{}");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  try {
    const client = new TrueForge({
      baseUrl: `http://127.0.0.1:${address.port}`,
      auth: false,
      maxRetries: 0,
    });
    expect(
      await registerFinnReviewSkill(client, {
        url: "https://github.com/example/finn",
        ref: "immutable-revision",
      }),
    ).toBe("finn-review-first");
    expect(stored).toMatchObject({
      name: "finn-review-first",
      type: "git",
      ref: "immutable-revision",
      path: "src/agent/skills/review-first",
      url: "https://github.com/example/finn",
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
