# Submission scorecard — evidence ledger, not an awarded score

Official criteria: Forge-a-thon statement pp. 7–9. Judges choose discrete anchors; when between anchors the lower applies.

**Recorded run:** `finn-demo-vo.mp4`, 3 min 53 s, with narration, recorded 20 November 2026 against `pallets/flask` `3.1.3` (`22d924701a6ae2e4cd01e9a15bbaf3946094af65`), TrueForge 0.185.0, model reference `local-gateway/deepseek-v41-flash` served through a loopback OpenAI-compatible gateway. Timestamps are from the final cut, not a plan.

| Criterion | Max | What the recording shows | Timestamp | Claimed anchor |
|---|---:|---|---|---|
| A1 Inline edit | 10 | Selection of `get_debug_flag`, the exact instruction, one streamed proposal, preview, per-hunk acceptance, `PASS docstring lists false values` | 0:06–0:53 | Accept path shown; no reject demonstrated, so claim only the accept anchor |
| A2 Agent mode | 10 | Prompt names no files; agent finds `src/flask/cli.py`, `tests/test_cli.py`, `docs/api.rst`, `docs/cli.rst`; hunks accepted; `PASS loaded application config is masked JSON` | 0:57–2:31 | Full anchor for discovery and multi-file edits |
| A3 Streaming and cancellation | 10 | Token deltas and tool events stream visibly, `Stop` mid-turn, status `Stopped. Pending changes discarded.`, nothing written | 3:21–3:49 | Cancellation anchor; streaming visible at 1:07–1:46 |
| B1 Context assembly | 15 | Context line shows `7979 / 8000` and `7995 / 8000` tokens plus the strategy text during both runs | 0:18–0:27, 1:07–1:46 | Budget visible; selection reasons appear on screen but are not narrated |
| B2 Diff safety | 10 | Diff preview before acceptance, hunk-level accept, unreviewed hunks left pending | 0:27–0:53, 1:46–2:09 | Undo is not demonstrated on camera, so do not claim the undo anchor |
| B3 Resilience | 10 | Unreachable provider gives `Run failed` with `[Model Error] Cannot connect to API: bad port`, zero proposals, clean workspace, `PASS Task C clean unchanged filesystem` | 2:31–3:21 | Clear-error anchor only; no automatic fallback configured |
| B4 TrueForge integration depth | 10 | Tool calls and results appear in the Finn panel; the TrueForge session UI is not shown | n/a | UNCLAIMED. Show the TrueForge turn list before claiming this |
| C1 Video | 10 | A, then B, then C in order, each followed by its verifier output, speeds labelled 18x and 20x during model work | whole file | Meets the ordering and legibility requirement |
| C2 Write-up | 15 | Source is `examples/write-up.html`; identity, cost and final video URL need the operator | n/a | Pending PDF export |

## Anchor caveats

- The 7-point B4 anchor requires TrueForge tool approval driving diff review. Finn enforces review in the editor instead, so that anchor stays unclaimed.
- The A3 clip is a real streamed turn that was stopped; the C failure does not substitute for it.
- The B run is sped up 20x while the model works. The instruction, the hunk review and the verification run at normal speed, and no cut hides an instruction-to-diff transition.
- The C error message comes from a provider whose base URL is unreachable on port 9, which TrueForge reports as `bad port`.

## Evidence manifest

- Recording: `finn-demo-vo.mp4`, 233 s, 7.8 MB, H.264 1280x800 with AAC narration.
- Flask full SHA: `22d924701a6ae2e4cd01e9a15bbaf3946094af65`.
- Finn revision on screen: `8123ba2`.
- TrueForge: 0.185.0, local standalone on `127.0.0.1:8790`.
- Verification JSON: `a-result.json`, `b-result.json`, `c-result.json` beside the recording.
- TrueForge session ID for the B run: not exported. Capture it from the TrueForge UI before claiming B4.
- Measured cost: not recorded. The gateway reported zero billable cost for these turns; do not claim a dollar figure you did not measure.
- Remaining operator fields: public video URL, team identity, PDF export.
