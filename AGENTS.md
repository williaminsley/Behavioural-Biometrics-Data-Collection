# AGENTS.md

## Project goal
This project focuses on behavioural biometrics data collection for continuous authentication research.

## Privacy requirements (strict)
- Never store raw typed text.
- Store only derived timings, interaction features, and aggregate behavioural metrics.
- Do not add any personally identifiable content capture.

## Export compatibility
- Export payloads must remain **schemaVersioned**.
- Keep export schemas stable across changes.
- If schema changes are unavoidable, bump schema version and document migration impact clearly.

## Code style and contribution expectations
- Prefer small PRs with a single purpose.
- Keep diffs minimal and avoid unrelated refactors.
- Add clear comments only where behaviour or intent is non-obvious.

## Run locally
- `package.json` was not found in this repository at the time of writing, so no npm scripts are currently detectable.
- When a Node build setup exists, use:
  - `npm install`
  - `npm run dev`
  - `npm run build`

## PR verification checklist
Include this checklist at the end of every PR description:
- [ ] No raw typed text is stored or exported.
- [ ] Export format remains schemaVersioned and stable.
- [ ] Changes are minimal and scoped.
- [ ] Local verification steps were run and documented.
- [ ] Any schema-impacting change is explicitly documented.
