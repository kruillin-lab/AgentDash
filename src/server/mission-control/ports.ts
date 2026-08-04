import type {
  ActionCommandV1,
  ActivationDecisionV1,
  ActivateMandateInput,
  AdapterResultEnvelopeV1,
  AppendRunEventInput,
  BindWorkerSessionInput,
  CloseActionInput,
  CodeGActivityV1,
  CodeGBindingV1,
  CodeGCancelResult,
  CodeGEnsureResult,
  CodeGLookupResult,
  CodeGSnapshotV1,
  EnsureArtifactInput,
  EnsureArtifactResult,
  EventId,
  ExecutionMandateV1,
  FinalizationApplyResultV1,
  FinalizationCommandV1,
  FinalizationLookupResultV1,
  FinalizationPreflightV1,
  MissionControlBoardV1,
  PersistIntakeInput,
  PersistIntakeResult,
  PrepareActionInput,
  PreparedActionResult,
  ProjectId,
  ReviewedRecallV1,
  RouteEvidenceV1,
  RouteId,
  RunId,
  SetCEOInputInput,
  TaskClass,
  TaskSpecV1,
  TerminalIntentInput,
  Timestamp,
} from "@/lib/mission-control/contracts";

export type {
  ActivationDecisionV1,
  ActivateMandateInput,
  AppendRunEventInput,
  BindWorkerSessionInput,
  CloseActionInput,
  CodeGActivityV1,
  CodeGBindingV1,
  CodeGCancelResult,
  CodeGEnsureResult,
  CodeGLookupResult,
  CodeGSnapshotV1,
  CodeGWorkspaceBindingV1,
  EnsureArtifactInput,
  EnsureArtifactResult,
  MissionControlBoardV1,
  PersistIntakeInput,
  PersistIntakeResult,
  PrepareActionInput,
  PreparedActionResult,
  ReviewedRecallV1,
  SetCEOInputInput,
  TerminalIntentInput,
} from "@/lib/mission-control/contracts";

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

export interface ActivationPolicyPort {
  decide(task: TaskSpecV1, mandate: ExecutionMandateV1, routes: RouteEvidenceV1[]): Promise<ActivationDecisionV1>;
}

export interface AgentBrainPort {
  recallReviewed(query: string, project_id: ProjectId): Promise<ReviewedRecallV1[]>;
}

export interface RouteRegistryPort {
  requireLevel5(route_id: RouteId, task_class: TaskClass, at: Timestamp): Promise<RouteEvidenceV1>;
}

export interface RecoveryOutboxPort {
  journal(result: AdapterResultEnvelopeV1): Promise<void>;
  pending(): Promise<AdapterResultEnvelopeV1[]>;
  markDelivered(envelope_id: EventId, hermes_event_id: EventId): Promise<void>;
}
