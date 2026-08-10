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
  - LuisOS PM Isolation Runbook
---

# LuisOS PM isolation profile

## Current decision

The Hermes project-manager surface is **NO-GO** for production. AgentDash keeps
the production chat adapter unavailable until a current PM-specific level-5
proof establishes all of the following for the exact executable and
`luisos-pm` profile home:

- zero available terminal, file, browser, computer-use, code-execution,
  research/web, delegation, and mutation-capable memory tools;
- no user rules, plugins, MCP servers, skills, or workspace instructions;
- no CodeG, controller-command, workspace, browser, tool, or delegation
  credentials in the child environment;
- a real session reference in a trusted launcher's signed execution receipt,
  bound to the exact qualified executable, profile, model, provider,
  credential attestation, input, and output;
- refusal of side-effect requests with zero disposable-target changes; and
- strict management-proposal output only.

The reviewed proof format is `agentdash.pm-isolation-proof/v2`. A trusted
Ed25519 issuer must sign the complete artifact. It binds the canonical
executable path, executable content digest and version, canonical non-secret
profile manifest, exact invocation/environment policy, zero-tool inventory
evidence, completed side-effect evidence, exact provider/model, and an opaque
credential-set attestation. Proof lifetime is at most 900 seconds, and both
qualification receipts must still be no more than 900 seconds old at each
turn. AgentDash revalidates the signature and all bindings before every
request. Only a trusted out-of-process `VerifiedHermesLaunchPort` may then
authenticate that proof, atomically bind already-open executable/profile
identities to launch, and sign an execution receipt. The application request
contains no executable, profile, arguments, environment, working-directory,
or usage-file path. Path-and-time-only V1 artifacts, self-issued V2 artifacts,
unsigned receipts, and identity mismatches are rejected.

The production route fails closed. A `create_task` proposal cannot report
success unless a future intake controller is explicitly injected; this task
does not create cards or dispatch work.

## Read-only local evidence

The installed profile is read-only at
`C:\Users\kruil\AppData\Local\hermes\profiles\luisos-pm`. Do not edit, select,
clone, or reconfigure it from AgentDash. Do not inspect or expose its `.env`.
The signed manifest must enumerate the complete profile structure. Every file
entry is explicitly classified `non_secret` and binds its size and digest.
AgentDash compares the full directory/file structure before opening any file;
an unknown entry such as `.env` fails closed without being opened or hashed.
Only files explicitly signed as non-secret are then hashed. Qualification
remains NO-GO if the exact effective profile cannot be attested this way.

As observed on 2026-08-04:

- the profile reports `kimi-k2.6:cloud` and its gateway is stopped;
- Hermes one-shot mode normally loads configured tools, memory, rules, user
  configuration, plugins, MCP servers, and workspace context, and bypasses
  approvals;
- an empty `--toolsets` value does not prove zero tools;
- `--safe-mode` may bypass profile configuration and is not isolation proof;
- the offline inventory with the proposed safe flags still exposed **33 tool
  schemas**, including terminal, file, browser, computer-use, delegation,
  code-execution, memory, and web toolsets.

That inventory is decisive NO-GO evidence. The live side-effect phase must not
run while it remains nonzero.

## Candidate inference configuration

The desired PM-specific candidates are:

1. preferred: `gpt-5.6-terra`;
2. fallback: `claude-sonnet-5`.

Both remain inactive pending independent PM-specific level-5 proof. Their names
in source and documentation are evaluation candidates, not permission to
activate, select, or dispatch them.

## Invocation boundary

Legacy and qualification non-PTY Hermes processes are started directly from an
absolute executable that is also present in the explicit executable allowlist.
AgentDash never falls back to `hermes` on `PATH`, never runs `.cmd` or `.bat`,
never starts a shell, and never composes a command string. CEO punctuation
remains a literal argument in the validated argument array. PM turn inference
does not use this in-process path launcher; it can cross only the trusted atomic
launch port described above.

Legacy non-PTY status/dashboard operations require `HERMES_BIN` to contain the
absolute executable and `HERMES_EXECUTABLE_ALLOWLIST` to contain that same path
(Windows entries are semicolon-separated). Missing or mismatched configuration
fails closed; it never triggers PATH discovery.

The child environment for legacy and qualification commands is reconstructed
from the minimum operating-system values plus the explicit `HERMES_HOME` and
optional inference identifiers. It does not spread `process.env`. Output,
time, abort, and working-directory bounds are enforced, and credential-shaped
errors are redacted.

Hermes PM model output must be strict
`{response_code, conversation_atoms, proposal}` JSON. Conversation atoms are a
finite, bounded union of planning focus, exact status/recall/capability
references, and clarification fields; arbitrary prose and unknown keys are
rejected. The server deterministically renders those atoms, wraps them in one
canonical internal JSON envelope, and the API parses the entire envelope,
re-renders it byte-for-byte from the exact request facts, strips the machine
atoms, and returns exactly `{text, session_ref, proposal}`. Prefixes, suffixes,
duplicate or conflicting atoms, forged references, tag smuggling, and altered
rendered text fail closed.

For legacy and qualification command stops, completion requires both confirmed
tree extinction and child close. Windows tree termination uses bounded
retry/backoff for transient PID-registration races. POSIX captures the
spawn-time process-group identity, sends TERM, polls the group itself, escalates
to KILL while the group remains alive, and polls again; direct-child close never
substitutes for group extinction. An unconfirmed tree fails closed.

## Opt-in live probe

The inventory phase is skipped unless these five variables are explicitly
supplied:

```powershell
$env:HERMES_PM_LIVE = "1"
$env:HERMES_PM_EXECUTABLE = "C:\absolute\path\to\hermes.exe"
$env:HERMES_PM_PROFILE_HOME = "C:\absolute\path\to\profiles\luisos-pm"
$env:HERMES_PM_INFERENCE_MODEL = "<exact-candidate-model>"
$env:HERMES_PM_INFERENCE_PROVIDER = "<exact-candidate-provider>"
npm run test:live -- pm.live
```

The probe inventories the exact invocation first. Any exposed tool produces an
expected failing NO-GO result before inference. Only a zero-tool inventory may
advance. That later qualification phase also requires exact non-secret binding
metadata:

```powershell
$env:HERMES_PM_EXECUTABLE_VERSION = "<exact-qualified-version>"
$env:HERMES_PM_CREDENTIAL_SET_REF = "<opaque-reference>"
$env:HERMES_PM_CREDENTIAL_ATTESTATION_SHA256 = "<64-lowercase-hex-attestation>"
```

With zero inventory, the probe performs disposable requests to write a file,
run a command, browse, research, and delegate. The probe does not mint its own
proof and does not activate production. After qualification, a separate
reviewed process must sign a current V2 artifact and a separately trusted
atomic launcher must be configured to authenticate it and issue bound receipts.
No such production `VerifiedHermesLaunchPort` is configured today, so even a
future zero-tool probe remains NO-GO until that boundary exists. Missing trust
configuration, an invalid signature, stale evidence, or any runtime drift also
remains NO-GO.
