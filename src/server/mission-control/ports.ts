import type {
  ActionCommandV1,
  AdapterResultEnvelopeV1,
  AttemptId,
  ArtifactId,
  CodeGConversationId,
  CodeGTaskId,
  CommandId,
  Digest,
  ExecutionMandateV1,
  EventId,
  FinalizationApplyResultV1,
  FinalizationCommandV1,
  FinalizationLookupResultV1,
  FinalizationPreflightV1,
  HarnessSessionId,
  MandateId,
  RequestId,
  ProjectId,
  RouteId,
  RouteEvidenceV1,
  TaskId,
  TaskSpecV1,
  Timestamp,
} from "@/lib/mission-control/contracts";
import type { TaskClass } from "@/lib/mission-control/contracts";

export interface PersistIntakeInput { readonly request_id: RequestId; readonly task_spec: TaskSpecV1; }
export interface PersistIntakeResult { readonly task_id: TaskId; readonly created: boolean; }
export interface EnsureArtifactInput { readonly task_id: TaskId; readonly digest: Digest; }
export interface EnsureArtifactResult { readonly artifact_id: ArtifactId; readonly digest: Digest; }
export interface ActivateMandateInput { readonly task_id: TaskId; readonly mandate: ExecutionMandateV1; }
export interface PrepareActionInput { readonly command: ActionCommandV1; }
export interface PreparedActionResult { readonly command_id: CommandId; readonly state: "prepared"; }
export interface BindWorkerSessionInput { readonly task_id: TaskId; readonly binding: CodeGBindingV1; }
export interface AppendRunEventInput { readonly task_id: TaskId; readonly event: AdapterResultEnvelopeV1; }
export interface CloseActionInput { readonly task_id: TaskId; readonly command: ActionCommandV1; }
export interface SetCEOInputInput { readonly task_id: TaskId; readonly reason: string; }
export interface TerminalIntentInput { readonly task_id: TaskId; readonly mandate_id: MandateId; readonly outcome: "succeeded" | "failed" | "timed_out" | "budget_exhausted" | "cancelled" | "route_unavailable" | "inconsistent"; }

export interface MissionControlBoardV1 { readonly schema_version: "agentdash.mission-control-board/v1"; readonly tasks: readonly TaskId[]; }

/** The three CodeG identities are deliberately separate and never inferred from one another. */
export interface CodeGBindingV1 { readonly task_id: TaskId; readonly attempt_id: AttemptId; readonly codeg_task_id: CodeGTaskId; readonly codeg_conversation_id: CodeGConversationId | null; readonly harness_session_id: HarnessSessionId | null; }
export type CodeGEnsureResult = { readonly kind: "found"; readonly binding: CodeGBindingV1 | null } | { readonly kind: "not_found"; readonly binding: null } | { readonly kind: "unknown"; readonly reason: string };
export type CodeGLookupResult = { readonly kind: "found"; readonly binding: CodeGBindingV1 } | { readonly kind: "not_found" } | { readonly kind: "unknown"; readonly reason: string };
export interface CodeGSnapshotV1 { readonly schema_version: "agentdash.codeg-snapshot/v1"; readonly state: "unknown" | "running" | "terminal"; readonly binding: CodeGBindingV1 | null; }
export interface CodeGActivityV1 { readonly cursor: string; readonly kind: "status" | "message" | "tool" | "terminal"; readonly at: Timestamp; }
export interface CodeGCancelResult { readonly state: "cancelled" | "not_found" | "unknown"; }

export interface ActivationDecisionV1 { readonly decision: "activate" | "approval_required" | "route_unavailable"; readonly reason: string; }
export interface ReviewedRecallV1 { readonly page_id: string; readonly title: string; readonly excerpt: string; readonly reviewed_at: Timestamp; }

export interface HermesPort {
  persistIntake(input: PersistIntakeInput): Promise<PersistIntakeResult>;
  ensureArtifact(input: EnsureArtifactInput): Promise<EnsureArtifactResult>;
  activateMandate(input: ActivateMandateInput): Promise<void>;
  prepareAction(input: PrepareActionInput): Promise<PreparedActionResult>;
  bindWorkerSession(input: BindWorkerSessionInput): Promise<void>;
  appendRunEvent(input: AppendRunEventInput): Promise<void>;
  closeAction(input: CloseActionInput): Promise<void>;
  setCEOInput(input: SetCEOInputInput): Promise<void>;
  commitTerminalIntent(input: TerminalIntentInput): Promise<void>;
  projectBoard(): Promise<MissionControlBoardV1>;
}
export interface CodeGPort {
  ensureWork(command: ActionCommandV1): Promise<CodeGEnsureResult>;
  lookupByCommandKey(key: string): Promise<CodeGLookupResult>;
  getSnapshot(binding: CodeGBindingV1): Promise<CodeGSnapshotV1>;
  activityAfter(binding: CodeGBindingV1, cursor: string | null): AsyncIterable<CodeGActivityV1>;
  cancelExact(binding: CodeGBindingV1, reason: string): Promise<CodeGCancelResult>;
  nativeSessionUri(binding: CodeGBindingV1): Promise<string | null>;
}
export interface FinalizationPort {
  preflight(command: FinalizationCommandV1): Promise<FinalizationPreflightV1>;
  apply(command: FinalizationCommandV1): Promise<FinalizationApplyResultV1>;
  lookup(command: FinalizationCommandV1): Promise<FinalizationLookupResultV1>;
}
export interface ActivationPolicyPort { decide(task: TaskSpecV1, mandate: ExecutionMandateV1, routes: RouteEvidenceV1[]): Promise<ActivationDecisionV1>; }
export interface AgentBrainPort { recallReviewed(query: string, project_id: ProjectId): Promise<ReviewedRecallV1[]>; }
export interface RouteRegistryPort { requireLevel5(route_id: RouteId, task_class: TaskClass, at: Timestamp): Promise<RouteEvidenceV1>; }
export interface RecoveryOutboxPort { journal(result: AdapterResultEnvelopeV1): Promise<void>; pending(): Promise<AdapterResultEnvelopeV1[]>; markDelivered(envelope_id: EventId, hermes_event_id: EventId): Promise<void>; }
