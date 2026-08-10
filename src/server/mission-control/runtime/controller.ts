import "server-only";

import type { ExactRouteV1, FinalizationCommandV1, ReconciliationDeadlinesV1 } from "../../../lib/mission-control/contracts";
import { chooseContinuation, type ContinuationDecisionV1, type ContinuationInput } from "../controller/continuation";
import { buildFinalizationCommand, type BuildFinalizationCommandInput } from "../finalization/command";
import { proveVerifierIndependence, type IndependenceTier, type VerifierCandidate, type VerifierIndependenceProof } from "../verification/independence";
import type { ActionCommandAdvanceResult } from "./action-command";
import { Reconciler, type ReconciliationDecisionV1, type ReconciliationRecord } from "./reconciler";
import {
  DispatchModeSchema,
  gateDecision,
  parseDispatchMode,
  type ControllerWorkKind,
  type DispatchGateDecision,
  type DispatchMode,
} from "./dispatch-mode";
import type { RecoveryOutbox } from "./outbox";
import type { ControllerOwner, OwnerLease } from "./owner-lock";

// The dispatch-mode gate lives in the edge-safe `./dispatch-mode` module so
// instrumentation can read it without bundling this Node-only controller.
export { DispatchModeSchema, parseDispatchMode };
export type { ControllerWorkKind, DispatchGateDecision, DispatchMode };

// ---------------------------------------------------------------------------
// MissionControlController
//
// The dormant runtime controller. It owns the single scheduler lease, the
// recovery outbox, and the replay-safe command runner, and it refuses to
// advance any work its dispatch-mode gate does not allow. A process that is
// not the owner never schedules controller work.
// ---------------------------------------------------------------------------

interface CommandRunner {
  advance(commandId: string): Promise<ActionCommandAdvanceResult>;
}

export type MissionControlControllerOptions = Readonly<{
  mode: DispatchMode;
  owner?: ControllerOwner;
  outbox: RecoveryOutbox;
  runner: CommandRunner;
}>;

export class MissionControlController {
  readonly mode: DispatchMode;
  private readonly owner: ControllerOwner | null;
  // Retained for the recovery surface; the outbox is the durable overlay the
  // runner journals into and rehydrates from. Kept on the instance so startup
  // wiring and later reconciliation share one queue.
  private readonly outbox: RecoveryOutbox;
  private readonly runner: CommandRunner;
  private lease: OwnerLease | null = null;

  constructor(options: MissionControlControllerOptions) {
    this.mode = options.mode;
    this.owner = options.owner ?? null;
    this.outbox = options.outbox;
    this.runner = options.runner;
  }

  gate(kind: ControllerWorkKind): DispatchGateDecision {
    return gateDecision(this.mode, kind);
  }

  async start(): Promise<boolean> {
    if (this.lease !== null) return true;
    if (this.owner === null) return false;
    this.lease = await this.owner.acquire();
    return this.lease !== null;
  }

  async stop(): Promise<void> {
    const lease = this.lease;
    this.lease = null;
    await lease?.release();
  }

  get isOwner(): boolean {
    return this.lease !== null;
  }

  async advanceCommand(commandId: string): Promise<ActionCommandAdvanceResult> {
    const decision = this.gate("model_backed");
    if (!decision.allowed) throw new Error(`Mission control dispatch is disabled: ${decision.reason}`);
    if (this.lease === null) throw new Error("Only the controller owner may schedule controller work.");
    return this.runner.advance(commandId);
  }

  /**
   * Deterministically choose the next mechanism after an action closes. This is
   * a pure planner: it never calls a model or adapter, and it never interrupts
   * the CEO for technical retry, remediation, verification, or finalization
   * already inside the activated mandate. Dispatching a `schedule_action`
   * result still goes through the gated `advanceCommand`.
   */
  continueTask(input: ContinuationInput): ContinuationDecisionV1 {
    return chooseContinuation(input);
  }

  /**
   * Prove a verifier is independent of the realized mutating-route set for the
   * mandate's minimum tier. Pure and deterministic; a remediation that mutates
   * the artifact grows the realized set and invalidates earlier verification.
   */
  proveVerifierIndependence(realizedRoutes: ExactRouteV1[], candidate: VerifierCandidate, tier: IndependenceTier): VerifierIndependenceProof {
    return proveVerifierIndependence(realizedRoutes, candidate, tier);
  }

  /**
   * Build the strict FinalizationCommandV1 after successful verification. Pure
   * planner; the only mutation seam is the FinalizationPort, never this method.
   */
  buildFinalizationCommand(input: BuildFinalizationCommandInput): FinalizationCommandV1 {
    return buildFinalizationCommand(input);
  }

  /**
   * Deterministically advance a bounded reconciliation. Pure: while a record is
   * unresolved no new work may start, and when its numeric deadline or
   * observation budget expires the task terminalizes `inconsistent` — never a
   * false resolution. The durable `started_at` survives restart.
   */
  reconcileTask(now: string, record: ReconciliationRecord, limits: ReconciliationDeadlinesV1): ReconciliationDecisionV1 {
    return Reconciler.tick(now, record, limits);
  }
}
