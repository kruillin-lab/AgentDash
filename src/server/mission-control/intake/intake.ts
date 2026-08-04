import {
  DigestSchema,
  RequestIdSchema,
  TaskIdSchema,
  canonicalDigest,
  type IntakeReadinessV1,
  type LookupIntakeResult,
  type PersistIntakeInput,
} from "../../../lib/mission-control/contracts";
import {
  CEOIntakeRequestV1Schema,
  IntakeAckV1Schema,
  type CEOIntakeRequestV1,
  type IntakeAckV1,
  type IntakeReadinessBrowser,
  type PublicReasonV1,
} from "../../../lib/mission-control/intake-api";
import {
  PMOutputError,
  parsePMTurnOutputForInput,
  type HermesPM,
  type PMTurnOutputV1,
} from "../../hermes/pm";
import type { PMTurnInputV1 } from "../pm-prompt";
import type { HermesPort } from "../ports";
import {
  canonicalIntakeArtifactDigestFromReadiness,
  canonicalizeCEOIntakeRequest,
  compileIntake,
  type CompileIntakeInput,
  type CompileIntakeResult,
} from "./compiler";
import {
  type AuthorizedIntakeArtifactV1,
  type CardExistingAckV1,
  type CEOConversationPort,
  type CEOConversationClaimResult,
} from "./conversation";
import type { ServerIntakeContextPort, ServerIntakeContextV1 } from "./context";

type IntakeHermesPort = Pick<HermesPort, "lookupIntake" | "persistIntake">;

export type IntakeControllerErrorCode =
  | "invalid_request"
  | "request_id_conflict"
  | "intake_pending"
  | "pm_unavailable"
  | "invalid_pm_output"
  | "intake_unavailable";

export class IntakeControllerError extends Error {
  constructor(readonly code: IntakeControllerErrorCode, message: string) {
    super(message);
    this.name = "IntakeControllerError";
  }
}

export interface IntakeControllerDependencies {
  conversation: CEOConversationPort;
  context: ServerIntakeContextPort;
  pm: HermesPM;
  hermes: IntakeHermesPort;
  compile?: (input: CompileIntakeInput) => CompileIntakeResult;
  now?: () => Date;
}

type ActiveClaim = {
  claim_id: string;
  claim_generation: number;
  staged_pm: PMTurnOutputV1 | null;
  authorized_artifact: AuthorizedIntakeArtifactV1 | null;
};

function fail(code: IntakeControllerErrorCode, message: string): never {
  throw new IntakeControllerError(code, message);
}

function publicReasons(reasons: readonly { code: string; message: string }[]): PublicReasonV1[] {
  return reasons.map(({ code, message }) => ({ code, message }));
}

function summarizeReadiness(readiness: IntakeReadinessV1): IntakeReadinessBrowser {
  switch (readiness.kind) {
    case "blocked_no_start":
      return { kind: "blocked_no_start", reasons: publicReasons(readiness.no_start.reasons) };
    case "approval_required":
      return { kind: "approval_required", reasons: [], decision_type: "initial_mandate_approval" };
    case "auto_activated":
      return { kind: "auto_activated", reasons: [], authority_id: readiness.activation.receipt.authority_id };
  }
}

function conversationAck(requestId: string, pm: PMTurnOutputV1): IntakeAckV1 {
  return IntakeAckV1Schema.parse({
    schema_version: "agentdash.intake-ack/v1",
    request_id: requestId,
    pm,
    result: { kind: "conversation_only" },
    board_refresh: false,
    select_task_id: null,
  });
}

function clarificationAck(
  requestId: string,
  pm: PMTurnOutputV1,
  reasons: readonly { code: string; message: string }[],
): IntakeAckV1 {
  return IntakeAckV1Schema.parse({
    schema_version: "agentdash.intake-ack/v1",
    request_id: requestId,
    pm,
    result: { kind: "clarification_required", reasons: publicReasons(reasons) },
    board_refresh: false,
    select_task_id: null,
  });
}

function cardAck(
  requestId: string,
  readiness: IntakeReadinessV1,
  result: "card_created" | "card_existing",
): IntakeAckV1 {
  return IntakeAckV1Schema.parse({
    schema_version: "agentdash.intake-ack/v1",
    request_id: requestId,
    pm: readiness.pm,
    result: { kind: result, task_id: readiness.task_id, readiness: summarizeReadiness(readiness) },
    board_refresh: true,
    select_task_id: readiness.task_id,
  });
}

function pmInput(message: string, context: ServerIntakeContextV1): PMTurnInputV1 {
  return {
    message,
    history: context.pm_context.history,
    reviewed_recall: context.pm_context.reviewed_recall,
    capability_facts: context.pm_context.capability_facts,
    status_facts: context.pm_context.status_facts,
  };
}

export class IntakeController {
  private readonly compile: (input: CompileIntakeInput) => CompileIntakeResult;
  private readonly now: () => Date;

  constructor(private readonly dependencies: IntakeControllerDependencies) {
    this.compile = dependencies.compile ?? compileIntake;
    this.now = dependencies.now ?? (() => new Date());
  }

  async handle(rawRequest: CEOIntakeRequestV1): Promise<IntakeAckV1> {
    const parsed = CEOIntakeRequestV1Schema.safeParse(rawRequest);
    if (!parsed.success) fail("invalid_request", "The intake request is invalid.");

    let identity: ReturnType<typeof canonicalizeCEOIntakeRequest>;
    try {
      identity = canonicalizeCEOIntakeRequest(parsed.data);
    } catch {
      fail("invalid_request", "The intake request is invalid.");
    }

    const claimed = await this.dependencies.conversation.claimTurn({
      request_id: RequestIdSchema.parse(identity.request.request_id),
      request_digest: DigestSchema.parse(identity.request_digest),
    });
    const active = await this.resolveClaim(claimed, identity.request.request_id, identity.request_digest);
    if ("ack" in active) return active.ack;

    let pm: PMTurnOutputV1;
    let context: ServerIntakeContextV1 | null = null;
    if (active.staged_pm) {
      pm = active.staged_pm;
    } else {
      try {
        const history = await this.dependencies.conversation.committedHistory();
        context = await this.dependencies.context.load({ committed_history: history });
        const input = pmInput(identity.normalized_message, context);
        const envelope = await this.dependencies.pm.turn(input, {});
        pm = parsePMTurnOutputForInput(input, envelope);
      } catch (error) {
        this.rethrowBoundaryError(error);
      }

      const staged = await this.dependencies.conversation.stagePMResult(
        active.claim_id,
        active.claim_generation,
        identity.request_digest,
        pm,
      );
      const stagedDigest = canonicalDigest(pm);
      if ((staged.status !== "staged" && staged.status !== "existing")
        || (staged.staged_pm_digest !== undefined && staged.staged_pm_digest !== stagedDigest)) {
        fail("intake_unavailable", "The intake claim could not stage its PM result.");
      }
    }

    if (pm.proposal.intent === "conversation_only") {
      if (active.authorized_artifact) {
        fail("intake_unavailable", "A conversation-only result cannot replace an authorized card artifact.");
      }
      const ack = conversationAck(identity.request.request_id, pm);
      await this.complete(active, ack);
      return ack;
    }

    let artifact: AuthorizedIntakeArtifactV1;
    if (active.authorized_artifact) {
      if (active.authorized_artifact.request_digest !== identity.request_digest
        || active.authorized_artifact.staged_pm_digest !== canonicalDigest(pm)
        || active.authorized_artifact.artifact_digest !== active.authorized_artifact.readiness.artifact_digest
        || active.authorized_artifact.request_digest !== active.authorized_artifact.readiness.request_digest) {
        fail("intake_unavailable", "The authorized intake artifact does not match the active claim.");
      }
      artifact = active.authorized_artifact;
    } else {
      if (!context) {
        try {
          const history = await this.dependencies.conversation.committedHistory();
          context = await this.dependencies.context.load({ committed_history: history });
        } catch (error) {
          this.rethrowBoundaryError(error);
        }
      }

      const compiled = this.compile({
        request: identity.request,
        pm_output: pm,
        compilation_policy: context.compilation_policy,
        compilation_policy_digest: context.compilation_policy_digest,
        activation: context.activation,
        now: this.now().toISOString(),
      });
      if (compiled.status === "clarification_required") {
        const ack = clarificationAck(identity.request.request_id, pm, compiled.reasons);
        await this.complete(active, ack);
        return ack;
      }
      if (compiled.request_digest !== identity.request_digest
        || compiled.task_id !== compiled.readiness.task_id
        || compiled.artifact_digest !== compiled.readiness.artifact_digest) {
        fail("intake_unavailable", "The compiled intake identity is inconsistent.");
      }
      artifact = {
        request_digest: DigestSchema.parse(compiled.request_digest),
        staged_pm_digest: DigestSchema.parse(canonicalDigest(pm)),
        artifact_digest: DigestSchema.parse(compiled.artifact_digest),
        readiness: compiled.readiness,
      };
    }

    const authorized = await this.dependencies.conversation.authorizeCardPersistence({
      claim_id: active.claim_id,
      claim_generation: active.claim_generation,
      artifact,
    });
    if (authorized.status !== "authorized" && authorized.status !== "existing") {
      fail("intake_unavailable", "The intake claim could not authorize card persistence.");
    }
    const authorizedArtifact = authorized.authorized_artifact;
    if (canonicalDigest(authorizedArtifact) !== canonicalDigest(artifact)
      || authorizedArtifact.request_digest !== identity.request_digest
      || authorizedArtifact.staged_pm_digest !== canonicalDigest(pm)
      || authorizedArtifact.artifact_digest !== authorizedArtifact.readiness.artifact_digest
      || authorizedArtifact.request_digest !== authorizedArtifact.readiness.request_digest) {
      fail("intake_unavailable", "The intake claim returned a different authorized artifact.");
    }

    const persistInput: PersistIntakeInput = {
      request_id: RequestIdSchema.parse(identity.request.request_id),
      request_digest: DigestSchema.parse(identity.request_digest),
      claim_id: active.claim_id,
      claim_generation: active.claim_generation,
      staged_pm_digest: DigestSchema.parse(authorizedArtifact.staged_pm_digest),
      card_authorization_digest: DigestSchema.parse(authorized.card_authorization_digest),
      artifact_digest: DigestSchema.parse(authorizedArtifact.artifact_digest),
      readiness: authorizedArtifact.readiness,
    };
    const persisted = await this.dependencies.hermes.persistIntake(persistInput);
    if (persisted.status !== "created" && persisted.status !== "existing") {
      fail("intake_unavailable", "The intake card could not be persisted.");
    }
    if (persisted.request_digest !== identity.request_digest
      || persisted.task_id !== authorizedArtifact.readiness.task_id
      || persisted.artifact_digest !== authorizedArtifact.artifact_digest
      || canonicalDigest(persisted.readiness) !== canonicalDigest(authorizedArtifact.readiness)) {
      fail("intake_unavailable", "The persisted intake winner does not match the authorized artifact.");
    }

    const ack = cardAck(
      identity.request.request_id,
      persisted.readiness,
      persisted.status === "created" ? "card_created" : "card_existing",
    );
    await this.complete(active, ack);
    return ack;
  }

  private async resolveClaim(
    claim: CEOConversationClaimResult,
    requestId: string,
    requestDigest: string,
  ): Promise<ActiveClaim | { ack: IntakeAckV1 }> {
    if (claim.status === "existing") return { ack: IntakeAckV1Schema.parse(claim.ack) };
    if (claim.status === "conflict") fail("request_id_conflict", "This request ID is already bound to different content.");
    if (claim.status === "claimed") {
      const persisted = await this.dependencies.hermes.lookupIntake(requestId);
      if (persisted.status === "found") {
        if (persisted.request_digest !== requestDigest) {
          fail("request_id_conflict", "This request ID is already bound to different content.");
        }
        return {
          ack: await this.reconcileCommittedCard(
            { claim_id: claim.claim_id, claim_generation: claim.claim_generation, staged_pm: null, authorized_artifact: null },
            requestId,
            requestDigest,
            persisted,
          ),
        };
      }
      return { claim_id: claim.claim_id, claim_generation: claim.claim_generation, staged_pm: null, authorized_artifact: null };
    }

    const persisted = await this.dependencies.hermes.lookupIntake(requestId);
    if (persisted.status === "found") {
      if (persisted.request_digest !== requestDigest) {
        fail("request_id_conflict", "This request ID is already bound to different content.");
      }
      return {
        ack: await this.reconcileCommittedCard(
          { claim_id: claim.claim_id, claim_generation: claim.observed_generation, staged_pm: claim.staged_pm, authorized_artifact: claim.authorized_artifact },
          requestId,
          requestDigest,
          persisted,
        ),
      };
    }

    if (Date.parse(claim.lease_expires_at) > this.now().getTime()) {
      fail("intake_pending", "This intake request is already being processed.");
    }
    const takeover = await this.dependencies.conversation.takeoverTurn(claim.claim_id, claim.observed_generation);
    if (takeover.status === "rejected") fail("intake_pending", "This intake request is already being processed.");
    if (takeover.status === "resume_staged") {
      return { claim_id: takeover.claim_id, claim_generation: takeover.claim_generation, staged_pm: takeover.staged_pm, authorized_artifact: takeover.authorized_artifact };
    }
    return { claim_id: takeover.claim_id, claim_generation: takeover.claim_generation, staged_pm: null, authorized_artifact: null };
  }

  private async reconcileCommittedCard(
    claim: ActiveClaim,
    requestId: string,
    requestDigest: string,
    persisted: Extract<LookupIntakeResult, { status: "found" }>,
  ): Promise<IntakeAckV1> {
    const artifact: AuthorizedIntakeArtifactV1 = {
      request_digest: persisted.request_digest,
      staged_pm_digest: canonicalDigest(persisted.readiness.pm),
      artifact_digest: persisted.artifact_digest,
      readiness: persisted.readiness,
    };
    let recomputedArtifactDigest: string;
    let expectedTaskId: string;
    try {
      expectedTaskId = TaskIdSchema.parse(`task-${requestDigest}`);
      recomputedArtifactDigest = canonicalIntakeArtifactDigestFromReadiness(artifact.readiness);
    } catch {
      fail("request_id_conflict", "This request ID is bound to a conflicting durable intake card.");
    }
    if (artifact.request_digest !== requestDigest
      || artifact.readiness.request_digest !== requestDigest
      || artifact.artifact_digest !== artifact.readiness.artifact_digest
      || artifact.readiness.task_spec.request_id !== requestId
      || persisted.task_id !== artifact.readiness.task_id
      || persisted.task_id !== expectedTaskId
      || artifact.artifact_digest !== recomputedArtifactDigest) {
      fail("request_id_conflict", "This request ID is bound to a conflicting durable intake card.");
    }
    const ack = cardAck(requestId, artifact.readiness, "card_existing");
    if (ack.result.kind !== "card_existing") fail("intake_unavailable", "The durable intake repair acknowledgement is invalid.");
    const cardExistingAck = ack as CardExistingAckV1;
    const repaired = await this.dependencies.conversation.reconcileCommittedCard({
      claim_id: claim.claim_id,
      claim_generation: claim.claim_generation,
      artifact,
      ack: cardExistingAck,
    });
    if (repaired.status === "conflict") {
      fail("request_id_conflict", "This request ID is bound to conflicting durable intake state.");
    }
    if ((repaired.status !== "created" && repaired.status !== "existing")
      || canonicalDigest(repaired.authorized_artifact) !== canonicalDigest(artifact)
      || canonicalDigest(repaired.ack) !== canonicalDigest(ack)) {
      fail("intake_unavailable", "The durable intake card could not be reconciled into the active claim.");
    }
    return IntakeAckV1Schema.parse(repaired.ack);
  }

  private async complete(claim: ActiveClaim, ack: IntakeAckV1): Promise<void> {
    const completed = await this.dependencies.conversation.completeTurn(claim.claim_id, claim.claim_generation, ack);
    if (completed.status === "created") return;
    if (completed.status === "existing" && completed.ack
      && canonicalDigest(completed.ack) === canonicalDigest(ack)) return;
    fail("intake_unavailable", "The intake outcome could not be committed.");
  }

  private rethrowBoundaryError(error: unknown): never {
    if (error instanceof IntakeControllerError) throw error;
    if (error instanceof PMOutputError || (error instanceof Error && "code" in error && error.code === "invalid_pm_output")) {
      fail("invalid_pm_output", "Invalid PM output.");
    }
    if (error instanceof Error && "code" in error && error.code === "pm_unavailable") {
      fail("pm_unavailable", "The isolated project manager is unavailable.");
    }
    fail("intake_unavailable", "The durable intake service is unavailable.");
  }
}
