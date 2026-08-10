import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { z } from "zod";

import {
  ExactRouteV1Schema,
  GitCommitIdSchema,
  RouteIdSchema,
  TaskClassSchema,
  TimestampSchema,
  canonicalJson,
} from "../../../lib/mission-control/contracts";
import {
  evaluateRoute,
  type RouteEvaluationPolicyCatalogV1,
  type RouteEvaluationResult,
  type ScoredRouteRun,
} from "./evaluator";
import type { CandidateRoute, RouteInventory } from "./inventory";

const AllowedOperationSchema = z.enum(["read", "write_disposable", "execute_tests", "emit_receipt"]);

const QualificationEnvelopeShape = {
  schema_version: z.literal("agentdash.qualification-envelope/v1"),
  origin: z.literal("operator_cli"),
  operator_session_id: z.string().regex(/^[A-Za-z0-9._:-]{16,128}$/),
  route_id: RouteIdSchema,
  exact_route: ExactRouteV1Schema,
  task_class: TaskClassSchema,
  level: z.union([z.literal(4), z.literal(5)]),
  fixture_set_version: z.string().min(1),
  disposable_board: z.object({ board_id: z.string().min(1), path: z.string().min(1).max(4096) }).strict(),
  workspace: z.object({ project_id: z.string().min(1), path: z.string().min(1).max(4096), disposable: z.literal(true) }).strict(),
  ceilings: z.object({
    max_cost_usd: z.number().finite().nonnegative(),
    max_runtime_ms: z.number().int().positive(),
    max_provider_tokens: z.number().int().nonnegative(),
  }).strict(),
  allowed_operations: z.array(AllowedOperationSchema).min(1),
  candidate_bridge_proofs: z.object({ hermes_commit: GitCommitIdSchema, codeg_commit: GitCommitIdSchema }).strict(),
  mode: z.literal("qualification"),
  issued_at: TimestampSchema,
  expires_at: TimestampSchema,
  nonce: z.string().regex(/^[A-Za-z0-9._:-]{16,128}$/),
};

function validateEnvelopeLifetime(
  value: { allowed_operations: string[]; issued_at: string; expires_at: string },
  context: z.RefinementCtx,
): void {
  if (new Set(value.allowed_operations).size !== value.allowed_operations.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["allowed_operations"], message: "allowed operations must be unique" });
  const issued = Date.parse(value.issued_at);
  const expires = Date.parse(value.expires_at);
  if (expires <= issued || expires - issued > 15 * 60 * 1_000) context.addIssue({ code: z.ZodIssueCode.custom, path: ["expires_at"], message: "qualification envelope lifetime must be positive and at most 15 minutes" });
}

const UnsignedQualificationEnvelopeV1Schema = z.object(QualificationEnvelopeShape).strict().superRefine(validateEnvelopeLifetime);

export type UnsignedQualificationEnvelopeV1 = z.infer<typeof UnsignedQualificationEnvelopeV1Schema>;

export const QualificationEnvelopeV1Schema = z.object({
  ...QualificationEnvelopeShape,
  signature: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().superRefine(validateEnvelopeLifetime);
export type QualificationEnvelopeV1 = z.infer<typeof QualificationEnvelopeV1Schema>;

export interface QualificationNonceStore {
  consume(nonce: string, expiresAt: string): Promise<boolean>;
}

export interface QualificationExecutor {
  (input: { envelope: UnsignedQualificationEnvelopeV1; candidate: CandidateRoute }): Promise<readonly ScoredRouteRun[]>;
}

export function signQualificationEnvelope(envelope: UnsignedQualificationEnvelopeV1, secret: string): string {
  if (secret.length < 32) throw new TypeError("Qualification signing secret must be at least 32 characters.");
  return createHmac("sha256", secret).update(canonicalJson(envelope), "utf8").digest("hex");
}

function signatureMatches(envelope: QualificationEnvelopeV1, secret: string): boolean {
  const { signature, ...unsigned } = envelope;
  const expected = Buffer.from(signQualificationEnvelope(unsigned, secret), "hex");
  const supplied = /^[a-f0-9]{64}$/.test(signature) ? Buffer.from(signature, "hex") : Buffer.alloc(32);
  return timingSafeEqual(expected, supplied);
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export class QualificationRunner {
  constructor(private readonly options: {
    secret: string;
    stateDir: string;
    inventory: RouteInventory;
    policy: RouteEvaluationPolicyCatalogV1;
    disposableRoots: readonly string[];
    expectedBridgeProofs: { hermes_commit: string; codeg_commit: string };
    nonceStore: QualificationNonceStore;
    execute: QualificationExecutor;
    now?: () => number;
  }) {
    if (options.secret.length < 32) throw new TypeError("Qualification signing secret must be at least 32 characters.");
    if (options.disposableRoots.length === 0) throw new TypeError("At least one disposable qualification root is required.");
  }

  private async validateDisposablePath(path: string): Promise<string> {
    if (!isAbsolute(path)) throw new Error("Qualification paths must be absolute disposable paths.");
    const realCandidate = await realpath(resolve(path));
    const realRoots = await Promise.all(this.options.disposableRoots.map(async (root) => realpath(resolve(root))));
    if (!realRoots.some((root) => isWithin(root, realCandidate))) throw new Error("Qualification path is outside the disposable roots.");
    return realCandidate;
  }

  async run(rawEnvelope: QualificationEnvelopeV1, invocation: { source: "operator_cli" | "chat" | "api" }): Promise<RouteEvaluationResult> {
    if (invocation.source !== "operator_cli") throw new Error("Qualification may be invoked only by the operator CLI.");
    const envelope = QualificationEnvelopeV1Schema.parse(rawEnvelope);
    if (!signatureMatches(envelope, this.options.secret)) throw new Error("Qualification envelope signature is invalid.");
    const { signature: _signature, ...unsigned } = envelope;
    const now = (this.options.now ?? Date.now)();
    if (Date.parse(unsigned.issued_at) > now || Date.parse(unsigned.expires_at) <= now) throw new Error("Qualification envelope is not currently valid.");

    if (unsigned.candidate_bridge_proofs.hermes_commit !== this.options.expectedBridgeProofs.hermes_commit
      || unsigned.candidate_bridge_proofs.codeg_commit !== this.options.expectedBridgeProofs.codeg_commit) {
      throw new Error("Qualification candidate bridge proof does not match the gated bridge commits.");
    }
    if (unsigned.fixture_set_version !== this.options.policy.fixture_set_version) throw new Error("Qualification fixture set is not the active policy fixture set.");
    const candidate = this.options.inventory.requireCandidate(unsigned.route_id);
    if (this.options.inventory.matchExact(unsigned.exact_route)?.route_id !== candidate.route_id) throw new Error("Qualification exact route tuple does not match the inventory candidate.");
    if (!candidate.task_classes.includes(unsigned.task_class)) throw new Error("Qualification task class is not a candidate hypothesis.");
    const taskPolicy = this.options.policy.task_classes[unsigned.task_class];
    if (unsigned.ceilings.max_cost_usd > taskPolicy.max_cost_usd || unsigned.ceilings.max_runtime_ms > taskPolicy.max_runtime_ms) throw new Error("Qualification envelope ceilings exceed the route policy.");

    const [realBoard, realWorkspace] = await Promise.all([
      this.validateDisposablePath(unsigned.disposable_board.path),
      this.validateDisposablePath(unsigned.workspace.path),
    ]);
    if (realBoard === realWorkspace) throw new Error("Qualification board and workspace must use separate disposable paths.");
    if (!await this.options.nonceStore.consume(unsigned.nonce, unsigned.expires_at)) throw new Error("Qualification envelope replay was rejected.");

    const runs = await this.options.execute({ envelope: unsigned, candidate });
    if (runs.some((run) => run.cost_usd > unsigned.ceilings.max_cost_usd
      || run.runtime_ms > unsigned.ceilings.max_runtime_ms
      || run.provider_tokens > unsigned.ceilings.max_provider_tokens)) {
      throw new Error("Qualification execution exceeded its signed envelope ceiling.");
    }
    const result = evaluateRoute({
      candidate,
      policy: this.options.policy,
      task_class: unsigned.task_class,
      level: unsigned.level,
      evaluated_at: new Date(now).toISOString(),
      current_config_digest: unsigned.exact_route.config_digest,
      runs,
    });
    if (result.decision === "eligible") {
      const evidenceDir = join(this.options.stateDir, "route-evidence");
      await mkdir(evidenceDir, { recursive: true });
      await writeFile(join(evidenceDir, `${result.evidence.evidence_digest}.json`), `${JSON.stringify(result.evidence)}\n`, { encoding: "utf8", flag: "wx" });
    } else if (result.revocation) {
      const revocationDir = join(this.options.stateDir, "route-revocations");
      await mkdir(revocationDir, { recursive: true });
      await writeFile(join(revocationDir, `${result.revocation.revocation_digest}.json`), `${JSON.stringify(result.revocation)}\n`, { encoding: "utf8", flag: "wx" });
    }
    return result;
  }
}
