# Security policy

Finn executes against a local, explicitly trusted workspace. Model output is
untrusted. Read access is confined to that workspace; source changes remain
proposals until the user accepts individual hunks. Terminal commands require a
separate explicit approval and can execute arbitrary code with your account's
permissions. Review the executable and arguments, not only the agent's explanation.
An approved command is not a sandbox: it can modify files outside Finn's proposal
store. Use an isolated clone or container for untrusted repositories.

TrueForge local mode is intended for a single user's machine. Keep its service on
localhost. Finn's editor MCP bridge uses a random per-process bearer token and a
loopback-only listener. Do not expose either service through a public tunnel.
Model provider credentials belong in TrueForge's configuration, never in Finn
settings, the repository, screenshots or issue reports.

Report vulnerabilities privately through GitHub's private vulnerability reporting
when available. Do not publish secrets or exploitable workspace contents in an
issue. Finn is pre-release software; keep a clean Git baseline before a session.

## Dependencies

Run `npm audit --omit=dev` for production dependency findings and `npm audit` for
all development/packaging tooling. A clean production audit does not imply a clean
development-tool audit. Do not run the test runner's development server on a
public interface. Dependency alerts and unsupported runtime versions must be
reviewed before release.
