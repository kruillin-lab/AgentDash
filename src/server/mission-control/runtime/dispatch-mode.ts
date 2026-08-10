import { z } from "zod";

// ---------------------------------------------------------------------------
// Dispatch mode (edge-safe)
//
// This module is intentionally free of Node-only imports so it can be bundled
// into every Next.js runtime graph (Node, edge, client) — instrumentation.ts
// reads the mode here. Production dispatch stays disabled until the Task 17
// promotion manifest proves every gate. The four modes are exhaustive; anything
// unrecognized fails closed to `disabled`.
// ---------------------------------------------------------------------------

export const DispatchModeSchema = z.enum(["disabled", "qualification", "candidate", "enabled"]);
export type DispatchMode = z.infer<typeof DispatchModeSchema>;

export function parseDispatchMode(raw: unknown): DispatchMode {
  const parsed = DispatchModeSchema.safeParse(raw);
  return parsed.success ? parsed.data : "disabled";
}

// ---------------------------------------------------------------------------
// Resolving the effective mode
//
// The durable promotion record written by `promote-gates --promote` is the only
// thing that can GRANT authority: it is the compare-and-set result of a proven
// gate conjunction bound to a PromotionManifestV1. The environment variable may
// only ever RESTRICT that further, which keeps the runbook's rollback path
// (MISSION_CONTROL_DISPATCH=disabled) working without letting an env var
// escalate past the mode the manifest actually proved.
//
// Authority is ordered, and the least-authority value wins.
// ---------------------------------------------------------------------------

const AUTHORITY_ORDER: readonly DispatchMode[] = ["disabled", "qualification", "candidate", "enabled"];

function authorityRank(mode: DispatchMode): number {
  return AUTHORITY_ORDER.indexOf(mode);
}

export function resolveDispatchMode(input: { storedMode: DispatchMode | null | undefined; envMode: unknown }): DispatchMode {
  const stored = parseDispatchMode(input.storedMode ?? "disabled");
  // An absent env value does not restrict anything; an invalid one fails closed.
  const envPresent = input.envMode !== undefined && input.envMode !== null && input.envMode !== "";
  if (!envPresent) return stored;
  const env = parseDispatchMode(input.envMode);
  return authorityRank(env) < authorityRank(stored) ? env : stored;
}

// ---------------------------------------------------------------------------
// Controller work kinds and the dispatch gate
//
//  - model_backed:  normal chat/board model dispatch (requires `enabled`)
//  - qualification: operator-signed canary/evaluation envelopes on disposable
//                   resources (requires `qualification` or `enabled`)
//  - candidate:     deterministic/no-model fixtures on production controller
//                   paths (requires `candidate` or `enabled`)
// ---------------------------------------------------------------------------

export type ControllerWorkKind = "model_backed" | "qualification" | "candidate";

export type DispatchGateDecision = Readonly<{ allowed: boolean; reason: string }>;

export function gateDecision(mode: DispatchMode, kind: ControllerWorkKind): DispatchGateDecision {
  if (mode === "enabled") return { allowed: true, reason: "Production dispatch is enabled." };
  if (mode === "disabled") return { allowed: false, reason: "Mission control dispatch is disabled." };
  if (mode === "qualification") {
    return kind === "qualification"
      ? { allowed: true, reason: "Operator-signed qualification envelope on disposable resources." }
      : { allowed: false, reason: "Qualification mode accepts only signed qualification envelopes." };
  }
  // candidate
  return kind === "candidate"
    ? { allowed: true, reason: "Deterministic no-model candidate fixture." }
    : { allowed: false, reason: "Candidate mode accepts only deterministic no-model fixtures." };
}
