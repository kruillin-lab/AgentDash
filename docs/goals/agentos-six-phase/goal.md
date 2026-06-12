# AgentOS Six-Phase Execution

## Objective

Turn the existing AgentDash redesign into AgentOS: a verified local workflow dashboard with Projects, Goals, Schedules, Recall, Inbox, session lifecycle controls, and project-to-agent launch glue.

## Original Request

Implement the approved AgentOS six-phase plan in AgentDash, preserve the redesign baseline, use a live GoalBuddy board, support Electron and hosted operation, and exclude deferred write actions.

## Intake Summary

- Input shape: `existing_plan`
- Audience: Luis, operating a Windows-based multi-agent development workflow
- Authority: `approved`
- Proof type: `test` + `demo` + `artifact`
- Completion proof: all six phase outcomes work in localhost and Electron, session controls are empirically verified, protected sources remain unchanged, and the AgentDash quality gate passes
- Goal oracle: verified APIs, automated parser tests, browser/Electron walkthroughs, session lifecycle evidence, protected-source snapshots, phase commits, and a final Judge receipt with `full_outcome_complete: true`
- Likely misfire: building attractive read-only cards while leaving session lifecycle, packaging, remote security, or source-system protections incomplete
- Blind spots considered: dirty baseline ownership, legacy `_brain` drift, PowerShell serialization, CLI resume differences, ConPTY interrupt behavior, Electron packaging, remote process-launch security, and prompt delivery timing
- Existing plan facts: preserved verbatim in `notes/AGENTOS_EXECUTION_PLAN.md`

## Goal Oracle

The oracle is:

`Projects, Goals, Schedules, Recall, Inbox, Resume, Interrupt, and launch glue work against live local sources in both localhost and Electron; service-mode startup works; protected sources are unchanged; tests and the normal quality gate pass.`

Planning or a single working view is not completion. The goal ends only when the final Judge maps phase receipts and verification to the complete oracle.

## Goal Kind

`existing_plan`

## Current Tranche

Complete P1 through P6 continuously in dependency order. Use one coherent Worker package per phase, with a Judge boundary before session lifecycle changes and a final Judge audit.

## Non-Negotiable Constraints

- `C:\Users\kruil\Documents\Projects\CodexBrain` is canonical; do not use legacy `_brain` as live data.
- Quality-gate sources, GoalBuddy files outside this goal, scheduled tasks, recall indexes, and inbox contents are read-only.
- Do not implement schedule triggering, inbox moves, or brain-log writes.
- Default binding is loopback. Non-loopback binding requires app authentication and CWD allowlisting.
- Keep Electron, localhost, and Windows-service startup paths supported.
- Do not install machine prerequisites without explicit approval.
- Keep each completed phase in a verified commit.

## Stop Rule

Stop only when the final Judge records `full_outcome_complete: true`, all required Worker cards are done, and the final quality-gate result and report path are recorded.

## Canonical Board

`docs/goals/agentos-six-phase/state.yaml`

## Run Command

```text
/goal Follow docs/goals/agentos-six-phase/goal.md.
```

