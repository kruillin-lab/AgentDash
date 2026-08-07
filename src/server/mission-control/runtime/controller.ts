import "server-only";

import { z } from "zod";

import type { ActionCommandAdvanceResult } from "./action-command";
import type { RecoveryOutbox } from "./outbox";
import type { ControllerOwner, OwnerLease } from "./owner-lock";

// ---------------------------------------------------------------------------
// Dispatch mode
//
// Production dispatch stays disabled until the Task 17 promotion manifest
// proves every gate. The four modes are exhaustive; anything unrecognized
// fails closed to `disabled`.
// ---------------------------------------------------------------------------

export const DispatchModeSchema = z.enum(["disabled", "qualification", "candidate", "enabled"]);
export type DispatchMode = z.infer<typeof DispatchModeSchema>;

export function parseDispatchMode(raw: unknown): DispatchMode {
  const parsed = DispatchModeSchema.safeParse(raw);
  return parsed.success ? parsed.data : "disabled";
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

function gateDecision(mode: DispatchMode, kind: ControllerWorkKind): DispatchGateDecision {
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
}
