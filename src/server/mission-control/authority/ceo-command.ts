import { z } from "zod";

import {
  ActivationQualificationV1Schema,
  ActivateMandateResultSchema,
  ActivationResultV1Schema,
  ActivationSnapshotV1Schema,
  ApprovalGrantV1Schema,
  CEOCommandV1Schema,
  DigestSchema,
  GetActivationQualificationResultSchema,
  LookupActivationByCommandResultSchema,
  MandateIdSchema,
  TaskIdSchema,
  approvalGrantFulfillsMandate,
  canonicalActivationCommandId,
  canonicalActivationQualificationDigest,
  canonicalizeActivationRoutes,
  canonicalDigest,
  type ActivationQualificationV1,
  type ActivationSnapshotV1,
  type ApprovalGrantV1,
  type CEOCommandV1,
  type CEOInputRequestV1,
  type ExecutionMandateV1,
} from "../../../lib/mission-control/contracts";
import type { CommandSessionV1 } from "../security/command-session";
import type { NonceStore } from "../security/nonce-store";
import type { HermesPort } from "../ports";
import { runNoStartChecks } from "../mandate/no-start";

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
type PendingActivationSnapshot = Extract<ActivationSnapshotV1, { status: "pending" }>;
type ActiveActivationSnapshot = Extract<ActivationSnapshotV1, { status: "active" }>;
type ExecutableActivationSnapshot = PendingActivationSnapshot | ActiveActivationSnapshot;
type AuthorityHermesPort = Pick<HermesPort, "getActivationSnapshot" | "qualifyActivation" | "lookupActivationByCommand" | "activateMandate">;

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

type CanonicalActivationSource = {
  source_snapshot_digest: string;
  request_digest: string;
  task_spec: ExecutableActivationSnapshot["task_spec"];
  mandate: ExecutionMandateV1;
  approval_request: CEOInputRequestV1;
};

function fail(code: CEOCommandErrorCode, message: string): never {
  throw new CEOCommandError(code, message);
}

function source(snapshot: ExecutableActivationSnapshot): CanonicalActivationSource {
  return snapshot.status === "pending"
    ? { source_snapshot_digest: snapshot.snapshot_digest, request_digest: snapshot.request_digest, task_spec: snapshot.task_spec, mandate: snapshot.mandate, approval_request: snapshot.approval_request }
    : { source_snapshot_digest: snapshot.source_snapshot_digest, request_digest: snapshot.request_digest, task_spec: snapshot.task_spec, mandate: snapshot.mandate, approval_request: snapshot.source_approval_request };
}

export function replayBindingDigest(
  session: CommandSessionV1,
  request: CEOInitialApprovalRequestV1,
  snapshot: ExecutableActivationSnapshot,
  qualificationDigest: string,
): z.infer<typeof DigestSchema> {
  return canonicalDigest({
    schema_version: "agentdash.initial-approval-replay-binding/v1",
    authenticated_session_id: session.session_id,
    session_issued_at: session.issued_at,
    session_expires_at: session.expires_at,
    replay_nonce: request.replay_nonce,
    decision_type: request.decision_type,
    canonical_source_digest: canonicalDigest(source(snapshot)),
    qualification_digest: qualificationDigest,
    displayed_task_spec_revision: request.displayed_task_spec_revision,
    displayed_task_spec_digest: request.displayed_task_spec_digest,
    proposed_mandate_id: request.proposed_mandate_id,
    proposed_mandate_digest: request.proposed_mandate_digest,
  });
}

function validateDisplayedBindings(request: CEOInitialApprovalRequestV1, snapshot: ExecutableActivationSnapshot): void {
  const bound = source(snapshot);
  const taskSpecDigest = canonicalDigest(bound.task_spec);
  const mandateDigest = canonicalDigest(bound.mandate);
  const approval = bound.approval_request;
  if (request.task_id !== bound.mandate.task_id
    || request.displayed_task_spec_revision !== bound.task_spec.plan_revision
    || request.displayed_task_spec_digest !== taskSpecDigest
    || request.proposed_mandate_id !== bound.mandate.mandate_id
    || request.proposed_mandate_digest !== mandateDigest
    || bound.mandate.task_spec_revision.plan_revision !== bound.task_spec.plan_revision
    || bound.mandate.task_spec_revision.task_spec_digest !== taskSpecDigest
    || bound.mandate.authority_source.kind !== "approval_precommit"
    || approval.task_id !== request.task_id
    || approval.task_spec_revision !== request.displayed_task_spec_revision
    || approval.task_spec_digest !== request.displayed_task_spec_digest
    || approval.proposed_mandate_id !== request.proposed_mandate_id
    || approval.proposed_mandate_digest !== request.proposed_mandate_digest
    || approval.decision_type !== request.decision_type
    || approval.active_mandate_id !== null
    || approval.completed_attempt_receipt_ids.length !== 0
    || !approval.no_unapproved_action_running) {
    fail("activation_conflict", "The displayed approval bindings are stale or mismatched.");
  }
}

function parsedDeadline(timestamp: string): number {
  const value = Date.parse(timestamp);
  return Number.isSafeInteger(value) ? value : fail("activation_unavailable", "The activation deadline is invalid.");
}

function validatePendingSource(snapshot: PendingActivationSnapshot): void {
  if (snapshot.readiness.kind !== "approval_required"
    || canonicalDigest(snapshot.readiness.task_spec) !== canonicalDigest(snapshot.task_spec)
    || canonicalDigest(snapshot.readiness.mandate) !== canonicalDigest(snapshot.mandate)
    || canonicalDigest(snapshot.readiness.activation.request) !== canonicalDigest(snapshot.approval_request)
    || snapshot.readiness.request_digest !== snapshot.request_digest
    || snapshot.readiness.budget_policy_digest !== canonicalDigest(snapshot.budget_policy)
    || parsedDeadline(snapshot.approval_request.expires_at) > parsedDeadline(snapshot.mandate.expiry)) {
    fail("activation_conflict", "The pending source snapshot is not an exact approval-ready tuple.");
  }
}

function validatePendingDeadlines(snapshot: PendingActivationSnapshot, currentTime: number): void {
  const approvalExpiresAt = parsedDeadline(snapshot.approval_request.expires_at);
  const mandateExpiresAt = parsedDeadline(snapshot.mandate.expiry);
  if (!Number.isSafeInteger(currentTime) || approvalExpiresAt <= currentTime || mandateExpiresAt <= currentTime) {
    fail("activation_expired", "The pending mandate or approval request has expired.");
  }
}

function validateConsumedAt(consumedAt: number, snapshot: ExecutableActivationSnapshot, qualification: ActivationQualificationV1): void {
  const bound = source(snapshot);
  if (!Number.isSafeInteger(consumedAt)
    || consumedAt >= parsedDeadline(bound.approval_request.expires_at)
    || consumedAt >= parsedDeadline(bound.mandate.expiry)
    || consumedAt >= parsedDeadline(qualification.valid_until)) {
    fail("activation_expired", "The persisted nonce consumption is outside the approval authority window.");
  }
}

function qualificationFor(
  snapshot: PendingActivationSnapshot,
  routeRegistryRevision: number,
  routes: ActivationQualificationV1["routes"],
): ActivationQualificationV1 {
  const taskSpecDigest = canonicalDigest(snapshot.task_spec);
  const mandateDigest = canonicalDigest(snapshot.mandate);
  const canonicalRoutes = canonicalizeActivationRoutes(routes);
  const routeExpiries = canonicalRoutes.map((route) => parsedDeadline(route.expires_at));
  const validUntil = Math.min(parsedDeadline(snapshot.approval_request.expires_at), parsedDeadline(snapshot.mandate.expiry), ...routeExpiries);
  const subject = {
    source_snapshot_digest: snapshot.snapshot_digest,
    request_digest: snapshot.request_digest,
    task_id: snapshot.mandate.task_id,
    task_spec_digest: taskSpecDigest,
    mandate_id: snapshot.mandate.mandate_id,
    mandate_digest: mandateDigest,
    approval_request_digest: canonicalDigest(snapshot.approval_request),
    budget_policy_digest: canonicalDigest(snapshot.budget_policy),
    route_registry_revision: routeRegistryRevision,
    routes: canonicalRoutes,
    route_snapshot_digest: canonicalDigest(canonicalRoutes),
    valid_until: new Date(validUntil).toISOString(),
  };
  return ActivationQualificationV1Schema.parse({
    schema_version: "agentdash.activation-qualification/v1",
    ...subject,
    qualification_digest: canonicalActivationQualificationDigest(subject),
  });
}

function validateQualification(snapshot: ExecutableActivationSnapshot, qualification: ActivationQualificationV1): void {
  const bound = source(snapshot);
  if (qualification.source_snapshot_digest !== bound.source_snapshot_digest
    || qualification.request_digest !== bound.request_digest
    || qualification.task_id !== bound.mandate.task_id
    || qualification.task_spec_digest !== canonicalDigest(bound.task_spec)
    || qualification.mandate_id !== bound.mandate.mandate_id
    || qualification.mandate_digest !== canonicalDigest(bound.mandate)
    || qualification.approval_request_digest !== canonicalDigest(bound.approval_request)
    || qualification.budget_policy_digest !== bound.mandate.budget_policy_digest) {
    fail("activation_conflict", "The activation qualification does not bind the immutable source snapshot.");
  }
}

function materializeAuthority(
  session: CommandSessionV1,
  request: CEOInitialApprovalRequestV1,
  snapshot: ExecutableActivationSnapshot,
  qualification: ActivationQualificationV1,
  bindingDigest: string,
  consumedAt: number,
): { command: CEOCommandV1; grant: ApprovalGrantV1 } {
  const bound = source(snapshot);
  const approvedAt = new Date(consumedAt).toISOString();
  const expiresAtMs = Math.min(session.expires_at, parsedDeadline(bound.approval_request.expires_at), parsedDeadline(bound.mandate.expiry), parsedDeadline(qualification.valid_until));
  if (!Number.isSafeInteger(consumedAt) || !Number.isSafeInteger(expiresAtMs) || expiresAtMs <= consumedAt) fail("activation_expired", "The approval authority has expired.");
  const expiresAt = new Date(expiresAtMs).toISOString();
  const commandId = canonicalActivationCommandId(DigestSchema.parse(bindingDigest));
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
    source_snapshot_digest: bound.source_snapshot_digest,
    qualification_digest: qualification.qualification_digest,
    created_at: approvedAt,
    expires_at: expiresAt,
  });
  const mandate = bound.mandate;
  if (mandate.authority_source.kind !== "approval_precommit") fail("activation_conflict", "The mandate has no approval precommit.");
  const orderedRouteIds = bound.task_spec.route_plan.flatMap((phase) => phase.route_id === null ? [] : [phase.route_id]);
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
    source_snapshot_digest: bound.source_snapshot_digest,
    qualification_digest: qualification.qualification_digest,
    approved_at: approvedAt,
    expires_at: expiresAt,
  });
  if (!approvalGrantFulfillsMandate(mandate, grant)) fail("activation_conflict", "The grant does not fulfill the precommitted mandate.");
  return { command, grant };
}

function exactResult(result: ActivationResultV1, command: CEOCommandV1, grant: ApprovalGrantV1, mandate: ExecutionMandateV1, qualification: ActivationQualificationV1): ActivationResultV1 {
  if (result.task_id !== command.task_id
    || result.command_id !== command.command_id
    || result.authority_id !== grant.authority_id
    || result.task_spec_digest !== command.displayed_task_spec_digest
    || result.mandate_digest !== canonicalDigest(mandate)
    || result.source_snapshot_digest !== command.source_snapshot_digest
    || result.qualification_digest !== qualification.qualification_digest
    || result.activated_at !== command.created_at) {
    fail("activation_unavailable", "The activation result does not match the deterministic command.");
  }
  return ActivationResultV1Schema.parse(result);
}

function activationResultFor(command: CEOCommandV1, grant: ApprovalGrantV1, mandate: ExecutionMandateV1, qualification: ActivationQualificationV1): ActivationResultV1 {
  return ActivationResultV1Schema.parse({
    schema_version: "agentdash.activation-result/v1",
    task_id: command.task_id,
    command_id: command.command_id,
    authority_id: grant.authority_id,
    task_spec_digest: command.displayed_task_spec_digest,
    mandate_digest: canonicalDigest(mandate),
    source_snapshot_digest: command.source_snapshot_digest,
    qualification_digest: qualification.qualification_digest,
    activated_at: command.created_at,
  });
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
    const rawSnapshot = await this.dependencies.hermes.getActivationSnapshot(request.task_id);
    const parsedSnapshot = ActivationSnapshotV1Schema.safeParse(rawSnapshot);
    if (!parsedSnapshot.success) fail("activation_unavailable", "The activation snapshot is malformed.");
    const snapshot = parsedSnapshot.data;
    if (snapshot.status === "not_found") fail("activation_not_found", "The approval target does not exist.");
    validateDisplayedBindings(request, snapshot);

    if (snapshot.status === "active") {
      validateQualification(snapshot, snapshot.qualification);
      validateConsumedAt(snapshot.consumed_at, snapshot, snapshot.qualification);
      const bindingDigest = replayBindingDigest(session, request, snapshot, snapshot.qualification.qualification_digest);
      if (snapshot.replay_binding_digest !== bindingDigest) fail("activation_conflict", "The mandate is already active under a different command.");
      const authority = materializeAuthority(session, request, snapshot, snapshot.qualification, bindingDigest, snapshot.consumed_at);
      const result = exactResult(snapshot.result, authority.command, authority.grant, snapshot.mandate, snapshot.qualification);
      if (canonicalDigest(snapshot.command) !== canonicalDigest(authority.command) || canonicalDigest(snapshot.grant) !== canonicalDigest(authority.grant)) {
        fail("activation_conflict", "The active command replay is not byte-identical.");
      }
      const nonce = await this.dependencies.nonces.lookup({ session_id: session.session_id, nonce: request.replay_nonce, expires_at: session.expires_at, binding_digest: bindingDigest });
      if (nonce.status !== "replayed_same" || nonce.consumed_at !== snapshot.consumed_at) fail("activation_conflict", "The active command requires the original replay-bound nonce record.");
      return result;
    }

    validatePendingSource(snapshot);
    const trustedNow = this.now().getTime();
    validatePendingDeadlines(snapshot, trustedNow);
    const rawQualification = GetActivationQualificationResultSchema.safeParse(await this.dependencies.hermes.qualifyActivation({
      source_snapshot_digest: snapshot.snapshot_digest,
      request_digest: snapshot.request_digest,
      task_id: snapshot.mandate.task_id,
      task_spec_digest: canonicalDigest(snapshot.task_spec),
      mandate_digest: canonicalDigest(snapshot.mandate),
      approval_request_digest: canonicalDigest(snapshot.approval_request),
      budget_policy_digest: canonicalDigest(snapshot.budget_policy),
    }));
    if (!rawQualification.success || rawQualification.data.status === "unavailable") fail("activation_unavailable", "Current route qualification is unavailable.");
    if (rawQualification.data.status === "conflict") fail("activation_conflict", "The activation source changed during qualification.");
    const qualification = qualificationFor(snapshot, rawQualification.data.route_registry_revision, rawQualification.data.routes);
    validateQualification(snapshot, qualification);
    const noStart = runNoStartChecks({ task_spec: snapshot.task_spec, mandate: snapshot.mandate, routes: qualification.routes, budget_policy: snapshot.budget_policy, now: new Date(trustedNow).toISOString() });
    if (!noStart.ready) fail("activation_unavailable", "Fresh no-start qualification rejected activation.");

    const bindingDigest = replayBindingDigest(session, request, snapshot, qualification.qualification_digest);
    const nonce = await this.dependencies.nonces.consume({ session_id: session.session_id, nonce: request.replay_nonce, expires_at: session.expires_at, binding_digest: bindingDigest });
    if (nonce.status === "expired") fail("activation_expired", "The replay nonce or command session has expired.");
    if (nonce.status === "replayed_conflict") fail("replay_conflict", "The replay nonce is bound to a different command.");
    if (!("consumed_at" in nonce)) fail("activation_unavailable", "The replay nonce state is unavailable.");
    validateConsumedAt(nonce.consumed_at, snapshot, qualification);
    const authority = materializeAuthority(session, request, snapshot, qualification, bindingDigest, nonce.consumed_at);
    const expectedResult = activationResultFor(authority.command, authority.grant, snapshot.mandate, qualification);
    if (nonce.status === "replayed_same") {
      let rawLookup: unknown;
      try {
        rawLookup = await this.dependencies.hermes.lookupActivationByCommand(authority.command.command_id);
      } catch {
        fail("activation_unavailable", "The authoritative activation lookup is unavailable.");
      }
      const lookup = LookupActivationByCommandResultSchema.safeParse(rawLookup);
      if (!lookup.success) fail("activation_unavailable", "The authoritative activation lookup is malformed.");
      if (lookup.data.status === "found") {
        return exactResult(lookup.data.result, authority.command, authority.grant, snapshot.mandate, qualification);
      }
    }
    const activated = ActivateMandateResultSchema.safeParse(await this.dependencies.hermes.activateMandate({
      expected_snapshot_digest: snapshot.snapshot_digest,
      request_digest: snapshot.request_digest,
      task_id: request.task_id,
      source_task_spec: snapshot.task_spec,
      task_spec_digest: request.displayed_task_spec_digest,
      mandate_digest: request.proposed_mandate_digest,
      source_approval_request: snapshot.approval_request,
      qualification,
      replay_binding_digest: bindingDigest,
      consumed_at: nonce.consumed_at,
      command: authority.command,
      grant: authority.grant,
      mandate: snapshot.mandate,
      result: expectedResult,
    }));
    if (!activated.success) fail("activation_unavailable", "The activation result is malformed.");
    if (activated.data.status === "conflict") fail("activation_conflict", "The activation or route-registry snapshot changed.");
    const { status: _status, ...result } = activated.data;
    return exactResult(result, authority.command, authority.grant, snapshot.mandate, qualification);
  }
}
