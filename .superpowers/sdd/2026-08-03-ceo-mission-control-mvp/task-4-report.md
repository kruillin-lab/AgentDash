# Task 4 report — read-only CEO Mission Control

## Scope

- Replaced `/` with the read-only CEO Mission Control workspace and preserved the former overview at `/overview`.
- Added a pure, schema-validated board projection; only a GET route is exposed, using an unavailable adapter when no Hermes read bridge is configured.
- Added keyboard-selectable board cards, labelled inspector, responsive layout, and visibly disabled PM/action controls.

## TDD evidence

- RED: `npm run test:unit -- mission-control read-model` exited 1 before implementation because `MissionControlShell` and `read-model` did not exist. Existing suites in that run: 213 passing.
- GREEN focused: `npx vitest run --config vitest.config.ts src/server/mission-control/read-model.test.ts src/components/mission-control/mission-control.test.tsx` passed 8/8.
- GREEN full: `npm run test:unit` passed 223/223.
- Review correction: added negative cases proving a valid CEO-input request or successful task outcome for a different task cannot change the enclosing card's lane. Their RED run failed 2/2 before the identity binding; the focused read-model suite then passed 6/6.
- Overview preservation: the moved page now has the same Git object hash as the base root page (`11db4f6193893392eba9f6106ec4f4d6ac1ae06f`), including its EOF bytes.

## Verification

- `npm run lint` — pass, no warnings.
- `npm run typecheck` — pass.
- `npm run build` — pass; confirms `/`, `/overview`, and `/api/mission-control/board`.
- `git diff --check` — pass.
- Credential scan of the task diff — clean.
- `npm run mission-control:probe` — expected fail-closed NO-GO: no authority/provenance/state directory is configured, and the probe explicitly keeps the board read-only and denies activation/dispatch.
- Quality gate: `PASS_WITH_WARNINGS`.
  - Report: `C:\Users\kruil\Documents\Projects\.worktrees\agentdash-ceo-mission-control\.quality-gate\reports\gate-20260804T070158Z-11d43e6f.md`
  - JSON: `C:\Users\kruil\Documents\Projects\.worktrees\agentdash-ceo-mission-control\.quality-gate\runs\20260804T070158Z-11d43e6f.json`

## Remaining concern

The production route intentionally returns an empty unavailable board until a real `HermesPort.projectBoard()` adapter is configured. It does not synthesize demo work or expose mutation controls.
