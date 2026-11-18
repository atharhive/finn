# Submission checklist

The official Round 1 deadline is **20 November 2026, 23:59 IST** (problem statement p. 10). Confirm organiser updates in the Techfest Competition Portal. Submit all three public links through that portal; private links are not scored and organisers will not request access.

## Eligibility and honest scope

- [ ] Every real agent turn runs through local **TrueForge**; Finn never calls the model provider directly.
- [ ] Editor read/search/propose-write/command capabilities are exposed as MCP tools and the agent chooses which to use.
- [ ] Model is configured in TrueForge and replaceable; demonstrate with another configured model if asked.
- [ ] Public repository includes the actual agent definition used (save/redact the B session inline spec; template is not proof of use).
- [ ] Starting point is declared accurately, including all reused upstream repositories and exact commit(s). Do not call a reused codebase “from scratch.”
- [ ] Preserve every upstream LICENSE/attribution, document the delta, and ensure the public licence is compatible.
- [ ] No API keys, bearer tokens, `.env` credentials, private/employer code or copied competition solutions in Git, logs, screenshots or video.
- [ ] Each participant is registered once; team up to five, all aged 18+ on registration. Confirm Team ID and eligible identity documents.

## Clean-clone setup and acceptance

- [ ] Follow root README from a clean clone and build/package/load the extension, not only unit tests.
- [ ] Install/start pinned TrueForge 0.185.0 locally; verify its UI is reachable.
- [ ] Configure a real working provider/model; replace all example model IDs and document exact reference(s).
- [ ] Prepare official `pallets/flask` tag `3.1.3`; verify full SHA `22d924701a6ae2e4cd01e9a15bbaf3946094af65`.
- [ ] Archive preparation manifest, Python dependency freeze, interpreter/tool versions and real baseline test output.
- [ ] A: exact selection/instruction, preview before disk writes, per-hunk acceptance/rejection, real off/n mixed-case probes and docstring.
- [ ] B: no files named; save baseline after A; agent discovers and edits ≥3 substantive implementation/test/docs files; show actual TrueForge turns/tools.
- [ ] B: real CLI test suite passes, `flask --help` lists `config`, command against a loaded app emits valid masked JSON; inspect new test and docs content.
- [ ] C: separate clean checkout; capture baseline; bad model-provider endpoint/key **inside TrueForge**, not merely bad Finn server URL; exact A repeated.
- [ ] C: editor responsive, clear error/retry or real configured fallback; clean final Git status and content hashes. Filesystem-only JSON is insufficient.
- [ ] Separately show tokens arriving, mid-generation cancellation, no half-applied edits and working undo; C error alone is not cancellation.
- [ ] Delete no evidence to conceal failed checks. New takes use new directories/filenames; never pad B with unrelated edits.

## Video — maximum 4 minutes

- [ ] Screen recording with VS Code visible; all three tasks A → B → C in order, each followed by legible actual verification.
- [ ] B briefly shows its real TrueForge session, turns and tool calls.
- [ ] No cut between giving an instruction and the diff appearing. Cut only model waiting time where consistent with this restriction; safest is continuous instruction-to-diff footage.
- [ ] Text and terminal output legible at normal playback; no hidden errors or synthetic passing outputs.
- [ ] Confirm runtime duration from final file metadata. Record timestamps **from the final cut**, not a planned timeline.
- [ ] Upload public/unlisted YouTube or Drive “anyone with the link can view”; test access logged out.

## Write-up — PDF, 1–3 pages

Use `examples/write-up.html` as a **draft source**, not a completed submission. Open in a browser and print A4 to PDF, background graphics enabled, browser headers/footers off. Its explicit three-page layout is designed for 3 pages; verify the exported PDF page count and legibility after replacing placeholders. Do not submit HTML instead of PDF.

- [ ] Eight headings, exactly in the required order: Team; Starting point; Architecture on TrueForge; How context is selected; Model setup; Scorecard; Tools used; Known limitations and what you would do with another month.
- [ ] Fill real member names, college/employer, GitHub handles and team ID.
- [ ] Fill upstream/fork commit(s), licences and meaningful changes; no invented provenance.
- [ ] Explain client→TrueForge→MCP architecture, editor-side approvals and harness features actually used.
- [ ] State retrieval strategy, units/budget, inclusion/exclusion trade-offs and visible evidence.
- [ ] Declare **every model used**, where it ran, approximate measured cost and model-switch steps. Zero cost is not a substitute for “not measured.”
- [ ] Scorecard has all nine criteria with accurate final video timestamps and bounded one-line claims. No self-awarded total without evidence.
- [ ] Declare development tools, including AI coding assistants, and distinguish build assistance from runtime models.
- [ ] Honest limitations; no claim that mocks, baseline probes, config files or clean snapshots equal end-to-end completion.
- [ ] Remove/replace every `FILL`, `NOT RECORDED`, `NOT CONFIGURED` placeholder before final submission; leave unsupported claims explicitly unclaimed instead of fabricating evidence.

## Repository and portal

- [ ] `https://github.com/atharhive/finn` public before deadline; anonymous clone/access verified.
- [ ] Root README setup steps work, declare provenance, preserve licences, include model example and agent-definition instructions.
- [ ] Run recorded quality gates from the current revision; archive exact outputs and describe remaining failures.
- [ ] Public PDF link opens logged out and is 1–3 pages; video link opens logged out and is ≤4 minutes.
- [ ] All three artefact URLs submitted in the Techfest Competition Portal before deadline; save receipt/confirmation.
- [ ] Rehearse explaining the code and repeating A live with an organiser-selected model for the 10-minute shortlist verification.

Optional social-media contest is independent: use actual project clip/link, required hashtags and organiser tags, and submit platform links by its separate official process. Do not mistake a social post for the Round 1 portal submission.
