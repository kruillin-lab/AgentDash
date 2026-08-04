import { z } from "zod";

import {
  ActivationResultV1Schema,
  ApprovalGrantV1Schema,
  CEOCommandV1Schema,
  DigestSchema,
  MandateIdSchema,
  TaskIdSchema,
  approvalGrantFulfillsMandate,
  canonicalDigest,
  type ActivationSnapshotV1,
  type ApprovalGrantV1,
  type CEOCommandV1,
  type ExecutionMandateV1,
} from "../../../lib/mission-control/contracts";
import type { CommandSessionV1 } from "../security/command-session";
import type { NonceStore } from "../security/nonce-store";
import type { HermesPort } from "../ports";

export const CEOInitialApprovalRequestV1Schema = z.object({
  task_id: TaskIdSchema,
  replay_nonce: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  displayed_task_spec_revision: z.number().int().nonnegative(),
  displayed_task_spec_digest: DigestSchema,
  proposed_mandate_id: MandateIdSchema,
  proposed_mandate_digest: DigestSchema,
  decision_type: z.literal("initial_mandate_approval"),
}).strict();
export type CEOInitialApprovalRequestV1 = z.infer<typeof CEOInitialApprovalRequestV1Schema>;

type ActivationResultV1 = z.infer<typeof ActivationResultV1Schema>;
type AuthorityHermesPort = Pick<HermesPort, "getActivationSnapshot" | "lookupActivationByCommand" | "activateMandate">;

export type CEOCommandErrorCode =
  | "invalid_request"
  | "activation_not_found"
  | "activation_conflict"
  | "activation_expired"
  | "replay_conflict"
  | "activation_unavailable";

export class CEOCommandError extends Error {
  constructor(readonly code: CEOCommandErrorCode, message: string) {
    super(message);
    this.name = "CEOCommandError";
  }
}

export interface CEOCommandServiceDependencies {
  hermes: AuthorityHermesPort;
  nonces: NonceStore;
  now?: () => Date;
}

type CanonicalActivationSubject = {
  request_digest: string;
  task_spec: ActivationSnapshotV1 extends infer _T ? Extract<ActivationSnapshotV1, { status: "pending" | "active" }>["task_spec"] : never;
  mandate: ExecutionMandateV1;
};

function fail(code: CEOCommandErrorCode, message: string): never {
  throw new CEOCommandError(code, message);
}

function subject(snapshot: Extract<ActivationSnapshotV1, { status: "pending" | "active" }>): CanonicalActivationSubject {
  return { request_digest: snapshot.request_digest, task_spec: snapshot.task_spec, mandate: snapshot.mandate };
}

export function replayBindingDigest(
  session: CommandSessionV1,
  request: CEOInitialApprovalRequestV1,
  snapshot: Extract<ActivationSnapshotV1, { status: "pending" | "active" }>,
): string {
  return canonicalDigest({
    schema_version: "agentdash.initial-approval-replay-binding/v1",
    authenticated_session_id: session.session_id,
    session_issued_at: session.issued_at,
    session_expires_at: session.expires_at,
    replay_nonce: request.replay_nonce,
    decision_type: request.decision_type,
    canonical_subject_digest: canonicalDigest(subject(snapshot)),
    displayed_task_spec_revision: request.displayed_task_spec_revision,
    displayed_task_spec_digest: request.displayed_task_spec_digest,
    proposed_mandate_id: request.proposed_mandate_id,
    proposed_mandate_digest: request.proposed_mandate_digest,
  });
}

function validateDisplayedBindings(
  request: CEOInitialApprovalRequestV1,
  snapshot: Extract<ActivationSnapshotV1, { status: "pending" | "active" }>,
): void {
  const taskSpecDigest = canonicalDigest(snapshot.task_spec);
  const mandateDigest = canonicalDigest(snapshot.mandate);
  if (request.task_id !== snapshot.mandate.task_id
    || request.displayed_task_spec_revision !== snapshot.task_spec.plan_revision
    || request.displayed_task_spec_digest !== taskSpecDigest
    || request.proposed_mandate_id !== snapshot.mandate.mandate_id
    || request.proposed_mandate_digest !== mandateDigest
    || snapshot.mandate.task_spec_revision.plan_revision !== snapshot.task_spec.plan_revision
    || snapshot.mandate.task_spec_revision.task_spec_digest !== taskSpecDigest
    || snapshot.mandate.authority_source.kind !== "approval_precommit") {
    fail("activation_conflict", "The displayed approval bindings are stale or mismatched.");
  }
  if (snapshot.status === "pending") {
    const approval = snapshot.approval_request;
    if (approval.task_id !== request.task_id
      || approval.task_spec_revision !== request.displayed_task_spec_revision
      || approval.task_spec_digest !== request.displayed_task_spec_digest
      || approval.proposed_mandate_id !== request.proposed_mandate_id
      || approval.proposed_mandate_digest !== request.proposed_mandate_digest
      || approval.decision_type !== request.decision_type) {
      fail("activation_conflict", "The pending approval request does not match the displayed decision.");
    }
  }
}

function materializeAuthority(
  session: CommandSessionV1,
  request: CEOInitialApprovalRequestV1,
  snapshot: Extract<ActivationSnapshotV1, { status: "pending" | "active" }>,
  bindingDigest: string,
  consumedAt: number,
): { command: CEOCommandV1; grant: ApprovalGrantV1 } {
  const approvedAt = new Date(consumedAt).toISOString();
  const expiresAtMs = Math.min(session.expires_at, Date.parse(snapshot.mandate.expiry));
  if (!Number.isSafeInteger(consumedAt) || !Number.isSafeInteger(expiresAtMs) || expiresAtMs <= consumedAt) {
    fail("activation_expired", "The approval authority has expired.");
  }
  const expiresAt = new Date(expiresAtMs).toISOString();
  const commandId = `command-${canonicalDigest({ schema_version: "agentdash.ceo-command-id/v1", binding_digest: bindingDigest })}`;
  const command = CEOCommandV1Schema.parse({
    schema_version: "agentdash.ceo-command/v1",
    command_id: commandId,
    replay_nonce: request.replay_nonce,
    authenticated_session_id: session.session_id,
    csrf_valid: true,
    origin_valid: true,
    command_type: "approve",
    task_id: request.task_id,
    displayed_task_spec_revision: request.displayed_task_spec_revision,
    displayed_task_spec_digest: request.displayed_task_spec_digest,
    active_mandate_id: null,
    proposed_mandate_id: request.proposed_mandate_id,
    viewed_mandate_digest: request.proposed_mandate_digest,
    requested_decision: request.decision_type,
    created_at: approvedAt,
    expires_at: expiresAt,
  });
  const mandate = snapshot.mandate;
  if (mandate.authority_source.kind !== "approval_precommit") fail("activation_conflict", "The mandate has no approval precommit.");
  const orderedRouteIds = snapshot.task_spec.route_plan.flatMap((phase) => phase.route_id === null ? [] : [phase.route_id]);
  const grant = ApprovalGrantV1Schema.parse({
    schema_version: "agentdash.approval-grant/v1",
    authority_id: mandate.authority_source.authority_id,
    task_id: mandate.task_id,
    task_spec_revision: mandate.task_spec_revision.plan_revision,
    task_spec_digest: mandate.task_spec_revision.task_spec_digest,
    mandate_id: mandate.mandate_id,
    objective_digest: mandate.task_spec_revision.objective_digest,
    acceptance_digest: mandate.task_spec_revision.acceptance_digest,
    mandate_digest: canonicalDigest(mandate),
    ordered_route_ids: orderedRouteIds,
    capability_scope: mandate.capability_scope,
    capability_scope_digest: canonicalDigest(mandate.capability_scope),
    workspace_scope: mandate.workspace_scope,
    aggregate_budget: mandate.aggregate_budget,
    finalization_predicate: {
      mutation_type: mandate.finalization_step.mutation_type,
      mutation_manifest_digest: mandate.finalization_step.mutation_manifest.manifest_digest,
      max_external_mutation: mandate.finalization_step.mutation_type === "approved_merge",
    },
    approved_by: session.session_id,
    source_command_id: command.command_id,
    approved_at: approvedAt,
    expires_at: expiresAt,
  });
  if (!approvalGrantFulfillsMandate(mandate, grant)) fail("activation_conflict", "The grant does not fulfill the precommitted mandate.");
  return { command, grant };
}

function exactResult(result: ActivationResultV1, command: CEOCommandV1, grant: ApprovalGrantV1, mandate: ExecutionMandateV1): ActivationResultV1 {
  if (result.task_id !== command.task_id
    || result.command_id !== command.command_id
    || result.authority_id !== grant.authority_id
    || result.task_spec_digest !== command.displayed_task_spec_digest
    || result.mandate_digest !== canonicalDigest(mandate)) {
    fail("activation_unavailable", "The activation result does not match the deterministic command.");
  }
  return ActivationResultV1Schema.parse(result);
}

export class CEOCommandService {
  private readonly now: () => Date;

  constructor(private readonly dependencies: CEOCommandServiceDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async approveInitial(rawRequest: CEOInitialApprovalRequestV1, session: CommandSessionV1): Promise<ActivationResultV1> {
    const parsed = CEOInitialApprovalRequestV1Schema.safeParse(rawRequest);
    if (!parsed.success) fail("invalid_request", "The initial approval request is invalid.");
    const request = parsed.data;
    const snapshot = await this.dependencies.hermes.getActivationSnapshot(request.task_id);
    if (snapshot.status === "not_found") fail("activation_not_found", "The approval target does not exist.");
    validateDisplayedBindings(request, snapshot);
    if (snapshot.status === "pending") {
      const approvalExpiresAt = Date.parse(snapshot.approval_request.expires_at);
      const trustedNow = this.now().getTime();
      if (!Number.isSafeInteger(approvalExpiresAt)
        || !Number.isSafeInteger(trustedNow)
        || approvalExpiresAt <= trustedNow) {
        fail("activation_expired", "The pending approval request has expired.");
      }
    }
    const bindingDigest = replayBindingDigest(session, request, snapshot);

    if (snapshot.status === "active" && snapshot.replay_binding_digest !== bindingDigest) {
      fail("activation_conflict", "The mandate is already active under a different command.");
    }
    const nonce = await this.dependencies.nonces.consume({
      session_id: session.session_id,
      nonce: request.replay_nonce,
      expires_at: session.expires_at,
      binding_digest: bindingDigest,
    });
    if (nonce.status === "expired") fail("activation_expired", "The replay nonce or command session has expired.");
    if (nonce.status === "replayed_conflict") fail("replay_conflict", "The replay nonce is bound to a different command.");
    if (!("consumed_at" in nonce)) fail("activation_unavailable", "The replay nonce state is unavailable.");
    if (snapshot.status === "active" && nonce.status !== "replayed_same") {
      fail("activation_conflict", "The active command requires the original replay-bound nonce record.");
    }
    const authority = materializeAuthority(session, request, snapshot, bindingDigest, nonce.consumed_at);

    if (snapshot.status === "active") {
      if (snapshot.consumed_at !== nonce.consumed_at
        || canonicalDigest(snapshot.command) !== canonicalDigest(authority.command)
        || canonicalDigest(snapshot.grant) !== canonicalDigest(authority.grant)) {
        fail("activation_conflict", "The active command replay is not byte-identical.");
      }
      return exactResult(snapshot.result, authority.command, authority.grant, snapshot.mandate);
    }

    const prior = await this.dependencies.hermes.lookupActivationByCommand(authority.command.command_id);
    if (prior.status === "found") return exactResult(prior.result, authority.command, authority.grant, snapshot.mandate);
    const activated = await this.dependencies.hermes.activateMandate({
      expected_snapshot_digest: snapshot.snapshot_digest,
      task_id: request.task_id,
      task_spec_digest: request.displayed_task_spec_digest,
      mandate_digest: request.proposed_mandate_digest,
      command: authority.command,
      grant: authority.grant,
      mandate: snapshot.mandate,
    });
    if (activated.status === "conflict") fail("activation_conflict", "The activation snapshot changed.");
    const { status: _status, ...result } = activated;
    return exactResult(result, authority.command, authority.grant, snapshot.mandate);
  }
}
