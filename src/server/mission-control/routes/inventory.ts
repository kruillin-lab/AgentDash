import "server-only";

import { readFile } from "node:fs/promises";

import { z } from "zod";

import { ExactRouteV1Schema, RouteIdSchema, TaskClassSchema, type ExactRouteV1 } from "../../../lib/mission-control/contracts";

const EntrySchema = z.object({
  route_id: RouteIdSchema,
  status: z.enum(["candidate", "template", "disabled"]),
  outer_harness: z.string().min(1).nullable(),
  provider: z.string().min(1),
  model: z.string().min(1),
  agent_type: z.string().min(1),
  mode: z.string().min(1),
  config_digest: z.string().regex(/^[0-9a-f]{64}$/),
  task_classes: z.array(TaskClassSchema),
  hypothesis: z.string().min(1),
  constraint: z.string().min(1),
}).strict().superRefine((entry, context) => {
  if ((entry.status === "candidate") !== (entry.outer_harness !== null)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["outer_harness"], message: "only executable candidates may name an outer harness" });
  if (entry.status === "candidate" && entry.task_classes.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["task_classes"], message: "candidate routes require an evaluation hypothesis" });
  if (entry.status === "disabled" && entry.task_classes.length !== 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["task_classes"], message: "disabled routes cannot claim a role" });
});
const InventorySchema = z.object({ schema_version: z.literal("agentdash.route-inventory/v1"), revision: z.number().int().positive().safe(), entries: z.array(EntrySchema).length(21) }).strict().superRefine((value, context) => {
  const ids = new Set(value.entries.map((entry) => entry.route_id));
  if (ids.size !== value.entries.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["entries"], message: "route identities must be unique" });
  if (value.entries.filter((entry) => entry.status === "candidate").length !== 15 || value.entries.filter((entry) => entry.status === "template").length !== 5 || value.entries.filter((entry) => entry.status === "disabled").length !== 1) context.addIssue({ code: z.ZodIssueCode.custom, path: ["entries"], message: "inventory group counts do not match the approved catalog" });
});

export type RouteInventoryEntry = z.infer<typeof EntrySchema>;
export type CandidateRoute = RouteInventoryEntry & { status: "candidate"; outer_harness: string; exact_route: ExactRouteV1 };

function exactRoute(entry: RouteInventoryEntry): ExactRouteV1 | null {
  if (entry.status !== "candidate" || entry.outer_harness === null) return null;
  return ExactRouteV1Schema.parse({ outer_harness: entry.outer_harness, provider: entry.provider, model: entry.model, agent_type: entry.agent_type, mode: entry.mode, config_digest: entry.config_digest });
}

export class RouteInventory {
  readonly revision: number;
  readonly entries: readonly RouteInventoryEntry[];
  private readonly byId: ReadonlyMap<string, RouteInventoryEntry>;

  constructor(raw: unknown) {
    const parsed = InventorySchema.parse(raw);
    this.revision = parsed.revision;
    this.entries = Object.freeze(parsed.entries.map((entry) => Object.freeze(entry)));
    this.byId = new Map(this.entries.map((entry) => [entry.route_id, entry]));
  }

  requireCandidate(routeId: string): CandidateRoute {
    const entry = this.byId.get(routeId);
    const route = entry ? exactRoute(entry) : null;
    if (!entry || entry.status !== "candidate" || entry.outer_harness === null || route === null) throw new Error(`Route ${routeId} is not an executable candidate.`);
    return { ...entry, status: "candidate", outer_harness: entry.outer_harness, exact_route: route };
  }

  matchExact(route: ExactRouteV1): CandidateRoute | null {
    const parsed = ExactRouteV1Schema.parse(route);
    for (const entry of this.entries) {
      const candidate = exactRoute(entry);
      if (candidate && candidate.outer_harness === parsed.outer_harness && candidate.provider === parsed.provider && candidate.model === parsed.model && candidate.agent_type === parsed.agent_type && candidate.mode === parsed.mode && candidate.config_digest === parsed.config_digest) return this.requireCandidate(entry.route_id);
    }
    return null;
  }
}

export async function loadRouteInventory(path: string): Promise<RouteInventory> {
  return new RouteInventory(JSON.parse(await readFile(path, "utf8")));
}
