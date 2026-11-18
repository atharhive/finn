# Contributing

Use Node 22.14 or newer and a current stable Rust toolchain.

1. Run `npm ci` and `cargo build -p finn_mcp`.
2. Add a failing behaviour test before changing code.
3. Implement the smallest complete behaviour, then refactor with tests green.
4. Run `npm run check`, `npm run test:rust`, and `npm run lint:rust`.
5. For editor changes, run `npm run test:vscode` in a real extension host.
6. Use a scoped Conventional Commit describing one cohesive change.

Keep the execution boundary intact: TrueForge owns inference, editor writes are
reviewed proposals, and production errors never switch to synthetic success.
Never hardcode benchmark solutions in production code. Preserve all third-party
licences and provenance when reusing code.
