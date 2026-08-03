# Page-specific agent instructions

- Preserve established page workflows, navigation, and user-facing terminology.
- Keep destructive mutations behind their existing dry-run, confirmation, and refusal paths.
- Do not expose raw financial rows, secrets, tokens, backup contents, or local filesystem paths.
- Keep diagnostic or experimental UI clearly separated from normal workflow controls.
- Add focused tests for workflow changes and avoid unrelated page refactors.
- For current architecture and operating rules, see the repository root `AGENTS.md` and `docs/PROJECT_STATE.md`.
