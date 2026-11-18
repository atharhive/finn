# Finn examples

These files are **SDK-shaped TrueForge 0.185.0 inputs**, not YAML configs, not HTTP request bodies, and not working model deployments.

| File | Purpose |
|---|---|
| `finn-agent.sdk.json` | Inline `AgentSpec` matching `src/agent` defaults. The MCP name is a placeholder; Finn generates a unique editor MCP name at runtime. |
| `model-provider.sdk.json` | Custom OpenAI-compatible provider template. Replace `baseUrl` and `modelId` with an endpoint/model you actually serve. |
| `task-c-provider.sdk.json` | Unreachable custom provider for Task C. If TrueForge rejects it at setup, use a provider it accepts with an invalid test key instead. |
| `write-up.html` | Eight-heading 1–3 page PDF source draft. Open in a browser and print A4 to PDF with backgrounds on and headers/footers off. Identity, timestamps and model cost remain placeholders. |

Validate locally with `npx vitest run tests/demo/examples.test.ts`. Prefer TrueForge Settings for credentials. Do not commit API keys. See `docs/demo.md`.
