# Finn fixed-task demo runbook

## Scope and evidence policy

The official Forge-a-thon problem statement (Round 1, pp. 4–8) fixes **pallets/flask tag `3.1.3`, commit `22d924701a6ae2e4cd01e9a15bbaf3946094af65`**. Record A, B, C in that order. These scripts prepare and verify a real checkout; **they do not run an agent, generate a solution, inject implementation code, or prove UI behaviour**. Finn must make the edits through its VS Code UI and TrueForge. The only generated Python fixture is a tiny external Flask app holding synthetic configuration values for the Task B output probe.

Current evidence: preparation was exercised on the official checkout; baseline `tests/test_cli.py` passed **58 tests**. Unmodified Flask correctly fails the A/B acceptance probes. Clean before/after filesystem comparison works for C, but that alone is **not** a resilience demonstration. No successful model-backed fixed-task run has been recorded; configure a model before rehearsing. Do not turn unit tests, mock-server tests, or a successful extension activation into a claim of successful A/B/C.

## 1. Prepare an isolated workspace

Prerequisites: Node as specified in `package.json`, Git, Python 3.9+ compatible with Flask, network access to GitHub/PyPI, and `uv` (preferred) or working `python -m venv`/pip. Build/install Finn using the root README. In a terminal at the Finn repository:

```sh
node scripts/prepare-demo.mjs --help
node scripts/prepare-demo.mjs --dir "$HOME/finn-demo-take-1"
```

Use a **new directory outside Finn** on every take. Never point this command at your source repository. It refuses existing destinations and never resets/deletes a checkout. It clones the exact release into `flask/` (A/B) and `flask-c/` (C), validates the full SHA and expected prefix, creates `.venv/` outside both Git workspaces, installs Flask editable and CLI test dependencies, and executes the baseline tests. `demo.json` records paths/commit/baseline status; `python-freeze.txt` captures actual resolved dependencies. The Flask revision is pinned; the Python dependency ranges are not a cross-platform lock. Archive the freeze, Python version, OS and logs with your evidence. Recreate resolved dependencies with your package manager's normal freeze-install flow if exact transitive replay is needed.

`--python /path/to/python` selects the interpreter. `--skip-tests` is only for diagnosis: its manifest explicitly says `not-run`, not acceptance. If a clone/install fails, read the printed command, fix GitHub/PyPI/certificate/venv access, and select a new directory. Partial directories are left intact for inspection; there is deliberately no destructive `--force` mode. PowerShell: replace `$HOME/...` with an absolute Windows path; the Node scripts choose `Scripts/python.exe` automatically.

## 2. Configure real TrueForge 0.185.0

```sh
npm run trueforge
```

This pins `@truefoundry/trueforge@0.185.0`. Use the local URL it prints (Finn defaults to `http://127.0.0.1:8790`). In TrueForge Settings configure a real catalog model or OpenAI-compatible provider. Keys belong in TrueForge's local settings only, never Finn settings or Git. For a local endpoint, adapt `examples/model-provider.sdk.json`: replace `baseUrl` and the upstream `modelId` with an endpoint/model actually served on your machine. `local/demo-model` is the corresponding reference, **not a bundled working model**. An endpoint must support tool use for agent mode.

These examples use the **TypeScript SDK's camelCase input shape**, verified with the installed 0.185.0 serializers in `tests/demo/examples.test.ts`; they are **not** invented YAML config files or raw HTTP request bodies. Programmatic setup, if desired, is `client.settings.modelProviders.create({ manifest })`; read back with `client.settings.modelProviders.get(manifest.name)` before claiming it configured. The SDK performs the wire-name conversion. Prefer the UI when entering credentials. Verify the provider/model appears in TrueForge and a real user turn succeeds before recording.

Set VS Code user settings `finn.trueforgeUrl` to the live local server and `finn.model` to the configured `provider/model` reference. Use **Finn: Restart Connections** after changing model/server settings. Leave `finn.fallbackModel` empty for the basic C failure recording. Finn registers a loopback, bearer-protected remote editor MCP server and creates an inline TrueForge agent automatically. It does **not** need a manually registered named agent. `examples/finn-agent.sdk.json` documents that definition; replace its runtime MCP name only if using it programmatically. The actual MCP name/token are per connection: do not copy the placeholder into a live session. The session's persisted inline spec is the authoritative definition used in the recording. Export/archive it with secrets redacted.

Editor tools: `assemble_context`, `read_file`, `search_workspace`, `propose_edit`, `run_command`. Proposals are in-memory until reviewed. Commands require explicit editor approval. The example intentionally has `requireApprovalForTools: []` because approval is enforced by Finn's editor boundary, **not TrueForge tool-approval events**; do not claim that scoring anchor. Default sandbox is disabled; optional skills may alter it. Budgeted retrieval and TrueForge compaction are implementation features; claim visibility/depth only after showing them in the live session.

## 3. Task A — inline edit

Open the prepared `flask/` directory in the Finn extension host, trust only this disposable repository, open `src/flask/helpers.py`, select the entire `get_debug_flag` function, press Ctrl+I / Cmd+I, and give this exact instruction:

> Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.

Keep the instruction-to-diff sequence continuous. Show a real preview and per-hunk review; reject a hunk if demonstrating rejection, then rerun/re-propose as necessary. Accept only the intended change. Show working undo and reaccept/re-run before verifying; do not leave the task undone.

From the Finn repository terminal (the Python environment is selected by `demo.json`):

```sh
node scripts/verify-demo.mjs --dir "$HOME/finn-demo-take-1" --task a \
  --output "$HOME/finn-demo-take-1/a-result.json"
```

This executes the official `FLASK_DEBUG=off ... print(get_debug_flag())` probe, then actually calls the function for off/OFF/oFf/n/N plus prior false and truthy regression cases, and inspects the real docstring. The extra docstring check expects empty/unset behaviour to be documented too. Exit 0 means these mechanical checks passed, not that Finn produced the diff. Preserve the on-screen source selection, instruction, preview, acceptance, undo and terminal result.

## 4. Task B — agent mode, no named files

After A is accepted and verified, take a content-hash baseline **before** sending B:

```sh
node scripts/verify-demo.mjs --dir "$HOME/finn-demo-take-1" --task snapshot-b \
  --output "$HOME/finn-demo-take-1/b-before.json"
```

In Finn's agent panel, with no `@file`, `@symbol`, filenames or attached selection, send exactly:

> Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as "***". It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands.

Let the agent discover files. Show chosen context/budget/reasons, streaming, and multi-file proposals; review and accept each intended hunk. Open the run's **real TrueForge session** and show turns plus MCP tool calls. Record the session identifier; redact access tokens and keys, not tool evidence. Run:

```sh
node scripts/verify-demo.mjs --dir "$HOME/finn-demo-take-1" --task b \
  --baseline "$HOME/finn-demo-take-1/b-before.json" \
  --output "$HOME/finn-demo-take-1/b-result.json"
```

The harness compares actual content hashes to B's baseline (A does not count), requires three distinct edits spanning `src/`, `tests/`, `docs/`, executes `pytest tests/test_cli.py -q` without cache writes, runs `python -m flask --help`, then loads an external synthetic app and invokes the **actual** `flask config` command. Output must be a JSON object, mask every sensitive key as exactly `***`, and retain benign string/number values. It never implements the command or adds task tests. Review the new test and command docs on screen: merely having three unrelated edits is not substantive coverage. A correct baseline test run alone must not pass B.

## 5. Task C — separate clean workspace

Switch the extension host to prepared **`flask-c/`**, not the A/B workspace. Do not commit/reset A/B merely to obtain a clean status. With no editor edits pending, capture:

```sh
node scripts/verify-demo.mjs --dir "$HOME/finn-demo-take-1" --task snapshot-c \
  --output "$HOME/finn-demo-take-1/c-before.json"
```

In **TrueForge** configure an unreachable model-provider endpoint such as the SDK-shaped `examples/task-c-provider.sdk.json` (`http://127.0.0.1:1/v1`). If TrueForge validates and refuses this provider at setup, use a provider accepted by its settings with an invalid test key instead. Keep the TrueForge harness itself reachable: changing only `finn.trueforgeUrl` proves a different failure. Select `task-c-unreachable/unreachable` in `finn.model` if that provider was saved, clear fallback for this basic path, restart Finn connections, reselect `get_debug_flag`, and repeat the exact A instruction.

Record a clear model/provider error and continued editor interaction (move cursor/type in a disposable untitled buffer, switch tabs, open commands). Show cancellation separately during a working streamed run if claiming immediate cancellation; an already failed request does not demonstrate cancellation. Do not accept source changes during C. Then run:

```sh
node scripts/verify-demo.mjs --dir "$HOME/finn-demo-take-1" --task c \
  --baseline "$HOME/finn-demo-take-1/c-before.json" \
  --output "$HOME/finn-demo-take-1/c-result.json"
git -C "$HOME/finn-demo-take-1/flask-c" status --short
```

The C check requires an originally clean status, same repository/commit, same tracked and nonignored untracked file hashes/modes, and clean final status. Ignored caches and Git internals are not hashed; this is not a forensic whole-disk audit. A passing C report explicitly means **filesystem unchanged**, not “resilience demonstrated.” Only the recording proves the failed model run, error/retry/fallback and responsiveness. Restore working model settings after recording. Do not claim automatic fallback unless a second real configured model is shown taking over without user action.

## 6. Evidence and troubleshooting

Every `--output` is exclusive-create; choose a new filename for a rerun. Keep output outside both checkouts to avoid contaminating status; outputs go wherever explicitly requested. Nonzero means incomplete/failed checks; all relevant B probes still execute even if its edit count fails. The harness is synchronous in its own terminal process, not inside the extension UI.

- `Unknown model` / empty model: configure a provider in TrueForge, choose its full reference, restart Finn. A reachable harness is not a configured model.
- `config` absent / JSON parse failure: Task B has not been accepted, wrong environment, or implementation output is invalid. Read actual output; do not patch Flask with demo scripts.
- Less than three edits: confirm baseline was before B, inspect source/test/docs proposals and rerun through the agent. Never pad the diff with unrelated files.
- C dirty: preserve evidence and find the unexpected write. Prepare a new take; never hide it with a reset.
- PyPI/venv failures: install Python venv/pip or `uv`, check network/certificates, retry in a new destination. Optional packages are resolved at preparation time and recorded in the freeze.

Before publishing, complete [scorecard.md](scorecard.md), [submission-checklist.md](submission-checklist.md), and the three-page print source `examples/write-up.html`. Timestamps remain `NOT RECORDED` until a real final video exists.
