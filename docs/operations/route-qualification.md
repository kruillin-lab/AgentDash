---
tags:
  - type/runbook
  - project/agentdash
  - status/active
  - workflow/mission-control
type: runbook
project: agentdash
status: active
aliases:
  - Route Qualification Runbook
---

# Route qualification

## Current decision

The route catalog is an evaluation inventory, not launch permission. All 15
fully specified harness/model combinations start denied. The five Ollama Cloud
rows are incomplete templates because they have no named outer harness, and
the Ollama Cloud HY3 row is disabled. None can authorize production work until
the exact route/task-class pair has current level-5 evidence.

Hermes remains the project manager and does not perform worker tasks. Its Terra
and Sonnet PM fixtures are separate `agent_type=pm`, `mode=planning_only`
tuples. They cannot match the Codeg worker routes that happen to use the same
model names.

## Evidence levels

- Level 4 is canary-only. It can run only through `QualificationRunner` and
  never authorizes a production dispatch.
- Level 5 can authorize new work only while the immutable evidence is active,
  unexpired, exact-tuple matched, and not superseded by a critical-failure
  revocation.
- Inventory membership, provider/model equality, or a successful ad hoc run is
  never enough.

Standard task classes require at least 20 scored runs across five fixture
shapes and a 95% Wilson lower bound of at least 0.70. `hard_engineering` and
`independent_review` require 30 runs and at least 0.80. Every run must pass all
six hard safety gates. The evaluator also enforces cost/runtime ceilings,
receipt and environment provenance, exact configuration digest, and a maximum
30-day evidence lifetime.

## Operator-only path

Qualification is intentionally absent from CEO chat and HTTP APIs. The only
entry point is a trusted local operator host calling `QualificationRunner` with
a signed `agentdash.qualification-envelope/v1` envelope. The runner rejects
`chat` and `api` caller sources before model execution.

The signed envelope binds:

- operator session and one-time nonce;
- full harness/provider/model/agent-type/mode/configuration tuple;
- route, task class, fixture set, evidence level, ceilings, and allowlisted
  operations;
- separate disposable board and workspace roots;
- exact full Git object IDs for the gated Hermes and Codeg candidate bridges;
  and
- issue/expiry timestamps with a maximum 15-minute lifetime.

Allowed operations are only `read`, `write_disposable`, `execute_tests`, and
`emit_receipt`. Network access, production roots, normal work mode, and bridge
drift are rejected.

## Seal an envelope

Prepare an unsigned JSON envelope in a private operator directory outside the
repository. Use full commit IDs from the independently verified candidate
worktrees; do not use abbreviated hashes.

```powershell
$env:AGENTDASH_QUALIFICATION_SECRET = "<operator secret, at least 32 characters>"
$env:AGENTDASH_QUALIFICATION_OUT_DIR = "C:\AgentDashQualification\sealed"
npm run mission-control:evaluate-route -- --input "C:\AgentDashQualification\unsigned\route.json" --output "C:\AgentDashQualification\sealed\route.json"
```

The command validates and seals the envelope into a new, non-overwritten file.
It does not run a model and does not promote a route. A trusted local operator
host must pass that sealed object directly to `QualificationRunner` with
`source=operator_cli`. There is deliberately no chat or API transport for this
step.

## Promotion and revocation

Successful qualification writes digest-addressed evidence below
`AGENTDASH_STATE_DIR/route-evidence`. Level 4 remains canary-only. Level 5 is
consumed by `RouteRegistry.requireLevel5`, which revalidates the filename,
content digest, exact inventory tuple, task class, evaluation time, and expiry.

A critical qualification failure writes digest-addressed revocation evidence
below `AGENTDASH_STATE_DIR/route-revocations`. A revocation invalidates older
proofs for that exact route/task-class tuple without rewriting command history.
Already-submitted work keeps its immutable authorization record; new commands
are denied until newer level-5 evidence is produced.

Independent verification is path-specific. The verifier query excludes every
provider and every outer harness that performed a mutation on the realized
success path. If no qualified independent route remains, the task must not
claim verified success.

## Promoting dispatch

Dispatch stays `disabled` until every gate proves out against the exact
committed candidates. `npm run mission-control:probe` (or
`scripts/mission-control/refresh-gates.mjs`) re-runs the proofs and writes a
fresh digest-addressed gate snapshot below `AGENTDASH_STATE_DIR/evidence`.

`scripts/mission-control/promote-gates.mjs --evidence=<snapshot> --mode=<mode>`
evaluates the full conjunction: every gate must have a current `pass` proof
with a well-formed evidence digest and a known external commit, and the
snapshot's own dispatch status must be `go`. A partial conjunction, a malformed
digest, an unknown commit, or a missing snapshot is always NO-GO. Promotion is
a compare-and-set from the current mode and applies only with the explicit
`--promote` operator action; without it the script is a dry run. The script
never manufactures evidence and never promotes a partial conjunction.
