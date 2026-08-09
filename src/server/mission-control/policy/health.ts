import "server-only";

import { parseDispatchMode, type DispatchMode } from "../runtime/dispatch-mode";
import { evaluateAutoEligibility, type AutoEligibilitySnapshotV1 } from "./auto";

// ---------------------------------------------------------------------------
// Mission Control health projection
//
// A redacted, truthful projection of the dispatch and auto-launch posture. It
// never manufactures evidence: with no current proof manifest the dispatch gate
// reports its fail-closed mode and auto-launch reports ineligible with the
// exhaustive reason list. Proof ids and expiries are surfaced only as redacted
// identifiers, never credentials or evidence payloads.
// ---------------------------------------------------------------------------

export interface MissionControlHealthV1 {
  generated_at: string;
  dispatch: { mode: DispatchMode; ready: boolean; reasons: string[] };
  auto_launch: { eligible: boolean; reasons: string[] };
  proofs: Array<{ id: string; expires_at: string | null }>;
}

export interface MissionControlHealthInput {
  now: string;
  /**
   * The mode actually IN FORCE, as resolved by the controller — never the raw
   * MISSION_CONTROL_DISPATCH value on its own. The env var may only RESTRICT the
   * durable promotion record (see resolveDispatchMode), so reporting it directly
   * lets health display `enabled` while the controller is `disabled`. Still
   * normalized fail-closed here, so an unknown value reads as `disabled`.
   */
  dispatch_mode: unknown;
  /** Current proof manifest rows (redacted). Empty when no evidence exists. */
  proofs?: Array<{ id: string; expires_at: string | null }>;
  /** The auto-eligibility snapshot; null when no proven snapshot exists. */
  auto_snapshot?: AutoEligibilitySnapshotV1 | null;
}

export function buildMissionControlHealth(input: MissionControlHealthInput): MissionControlHealthV1 {
  const mode = parseDispatchMode(input.dispatch_mode);
  const proofs = input.proofs ?? [];

  // Dispatch is ready only in `enabled` with every gate proven. With no proof
  // manifest the conjunction is incomplete and dispatch stays not-ready.
  const dispatchReasons: string[] = [];
  if (mode !== "enabled") dispatchReasons.push(`Dispatch mode is ${mode}; production dispatch requires enabled.`);
  if (proofs.length === 0) dispatchReasons.push("No current gate evidence manifest; the proof conjunction is incomplete.");

  const auto = input.auto_snapshot
    ? evaluateAutoEligibility(input.auto_snapshot)
    : { eligible: false, reasons: ["No proven auto-eligibility snapshot exists."] };

  return {
    generated_at: input.now,
    dispatch: { mode, ready: dispatchReasons.length === 0, reasons: dispatchReasons },
    auto_launch: { eligible: auto.eligible, reasons: auto.reasons },
    proofs: proofs.map((proof) => ({ id: proof.id, expires_at: proof.expires_at })),
  };
}
