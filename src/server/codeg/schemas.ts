import { z } from "zod";

const timestamp = z.string().datetime({ offset: true });
const nullableString = z.string().nullable();
const nullableInteger = z.number().int().nullable();

export const CodeGRawBindingSchema = z.object({
  workTaskId: z.string().regex(/^work_task:[1-9]\d*$/),
  runSeq: z.number().int().nonnegative(),
  conversationId: z.string().regex(/^conversation:[1-9]\d*$/).nullable(),
  connectionId: nullableString,
  harnessSessionId: nullableString,
  nativeUri: nullableString,
  folderId: z.string().regex(/^folder:[1-9]\d*$/),
  folderRealPath: z.string().min(1),
}).strict();
export type CodeGRawBinding = z.infer<typeof CodeGRawBindingSchema>;

export const CodeGRawTaskSchema = z.object({
  id: z.number().int().positive(),
  external_key: nullableString,
  folder_id: z.number().int().positive(),
  title: z.string().min(1),
  config: z.unknown().nullable(),
  status: z.enum(["todo", "queued", "running", "awaiting_input", "review", "merging", "done", "failed", "canceled"]),
  failure_reason: nullableString,
  last_error: nullableString,
  run_seq: z.number().int().nonnegative(),
  sort_order: z.number().int(),
  worktree_folder_id: nullableInteger,
  conversation_id: nullableInteger,
  connection_id: nullableString,
  base_branch: nullableString,
  base_sha: nullableString,
  work_branch: nullableString,
  cleanup_state: nullableString,
  verdict: nullableString,
  result_summary: nullableString,
  files_changed: nullableInteger,
  additions: nullableInteger,
  deletions: nullableInteger,
  merge_commit: nullableString,
  preflight: z.unknown().nullable(),
  archived_at: timestamp.nullable(),
  latest_progress: z.string().optional(),
  created_at: timestamp,
  updated_at: timestamp,
  started_at: timestamp.nullable(),
  settled_at: timestamp.nullable(),
  finished_at: timestamp.nullable(),
}).strict();
export type CodeGRawTask = z.infer<typeof CodeGRawTaskSchema>;

export const CodeGEnsureResponseSchema = z.object({
  created: z.boolean(),
  task: CodeGRawTaskSchema,
  binding: CodeGRawBindingSchema,
}).strict();

export const CodeGLookupResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("found"), task: CodeGRawTaskSchema, binding: CodeGRawBindingSchema }).strict(),
  z.object({ status: z.literal("not_found") }).strict(),
]);

export const CodeGSnapshotResponseSchema = z.object({
  binding: CodeGRawBindingSchema,
  task: CodeGRawTaskSchema,
  sourceCommit: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/).nullable(),
  sourceTree: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/).nullable(),
  worktreeRealPath: z.string().min(1).nullable(),
  changedFiles: z.array(z.object({
    file: z.string().min(1).max(4096),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
  }).strict()).nullable(),
}).strict();

export const CodeGExecutionFactsSchema = z.object({
  runtimeMs: z.number().int().nonnegative().nullable(),
  runtimeLimitMs: z.number().int().positive().nullable(),
  contextTokensUsed: z.number().int().nonnegative().nullable(),
  contextWindowSize: z.number().int().positive().nullable(),
  observedCostUsd: z.number().nonnegative().nullable(),
}).strict();

export const CodeGEventEnvelopeSchema = z.object({
  seq: z.number().int().positive(),
  connection_id: z.string().min(1),
  type: z.string().min(1),
}).catchall(z.unknown());

export const CodeGActivityResponseSchema = z.object({
  binding: CodeGRawBindingSchema,
  live: z.boolean(),
  resetRequired: z.boolean(),
  nextCursor: z.number().int().nonnegative(),
  facts: CodeGExecutionFactsSchema,
  events: z.array(CodeGEventEnvelopeSchema),
}).strict();
