# Submission scorecard — evidence ledger, not an awarded score

Official criteria: Forge-a-thon statement pp. 7–9. Judges choose discrete anchors; when between anchors the lower applies. **No points are claimed here before a model-backed recording exists.** Unit tests and baseline Flask tests support engineering confidence but cannot replace on-screen fixed-task evidence.

| Criterion | Max | Current evidence / limitation | Required final-video evidence | Final timestamp | Claimed anchor |
|---|---:|---|---|---|---|
| A1 Inline edit | 10 | Selection workflow and diff implementation; no model-backed A recording | Selected function → exact A instruction → rendered diff → per-hunk accept AND reject | NOT RECORDED | UNCLAIMED |
| A2 Agent mode | 10 | MCP loop and verification harness; no generated B accepted | Exact B prompt with no files named; discovered implementation/test/docs; ≥3 accepted file edits since B baseline | NOT RECORDED | UNCLAIMED |
| A3 Streaming and cancellation | 10 | Automated tests are not UI evidence | Tokens arriving, immediate user cancellation, responsive editor and unchanged/consistent files | NOT RECORDED | UNCLAIMED |
| B1 Context assembly | 15 | Budgeted retrieval implementation; live retrieval not recorded | Explicit mentions separately; B auto-retrieval with size budget and chosen file reasons visible | NOT RECORDED | UNCLAIMED |
| B2 Diff safety | 10 | Review/undo implementation; manual demonstration pending | Per-hunk review before disk writes plus working undo of accepted change | NOT RECORDED | UNCLAIMED |
| B3 Resilience | 10 | Clean snapshot comparison exercised, NOT a failed-model run | C with invalid provider key/unreachable model endpoint, clear error or verified fallback, responsive editor and clean Git status | NOT RECORDED | UNCLAIMED |
| B4 TrueForge integration depth | 10 | SDK session/turn stream and editor MCP; compaction configured | Real B session with tool calls and meaningful harness context feature; explain actual boundaries | NOT RECORDED | UNCLAIMED |
| C1 Video | 10 | No final video | ≤4 minutes, A/B/C in order, legible verification, TrueForge session; no cuts from instruction to diff | NOT RECORDED | UNCLAIMED |
| C2 Write-up | 15 | Eight-heading source draft only; identity/model/timestamps incomplete | Public 1–3 page PDF, accurate design decisions, costs, limitations and final timestamps | NOT RECORDED | UNCLAIMED |

## Anchor caveats

- The 7-point B4 anchor explicitly requires **TrueForge tool approval driving diff review**. Finn's current editor enforces its own proposal review and command confirmation; `requireApprovalForTools` is empty and unsupported harness approval requests fail closed. Do not claim harness-driven approval because MCP tools exist.
- Compaction being enabled is configuration evidence, not proof of meaningful use. Show an actual session event/behaviour and explain why it mattered before claiming the top B4 anchor. Optional skills must be configured, actually used and shown; a template is not evidence.
- The top B3 anchor requires automatic failover to a **second configured model without user action** and no changed files. Error handling, a retry test or manually changing models is not that behaviour. Claim only the visible anchor (clear error: 4; retry/backoff then clear error: 7; real automatic fallback: 10).
- A clean C snapshot can pass without any model run. Its report is deliberately labelled filesystem-only. Attach the corresponding video/session, not just JSON.
- The final video must show all A/B/C acceptance checks. `58 passed` from upstream baseline alone does not prove the newly added command exists, masks configuration, has a new test, or spans three files.

## Evidence manifest to fill after recording

- Final video public URL: **NOT RECORDED**
- Final video duration: **NOT RECORDED**
- Flask full SHA: `22d924701a6ae2e4cd01e9a15bbaf3946094af65`
- Finn source revision / VSIX hash: **FILL FROM REAL BUILD**
- OS / Node / Python / TrueForge versions: **FILL FROM RECORDING ENVIRONMENT** (TrueForge target: `0.185.0`)
- TrueForge B session ID and redacted exported inline definition: **NOT RECORDED**
- Configured model(s), provider/endpoint, host, approximate measured cost: **NOT CONFIGURED / NOT MEASURED**
- Evidence files: `demo.json`, `python-freeze.txt`, `a-result.json`, `b-before.json`, `b-result.json`, `c-before.json`, `c-result.json`, readable terminal output and session export. Keep outside Flask checkouts; inspect for credentials before sharing.

The local harness author exercised a fresh pinned checkout: baseline CLI tests 58 passed; A and B probes rejected unmodified Flask as expected; C before/after filesystem-only comparison passed without representing a real failed-model run. Those are harness-validation results, **not competition completion**.
