import "server-only";

import { createHash } from "node:crypto";
import { win32 } from "node:path";
import { z } from "zod";

import type { ProjectId, ReviewedRecallV1 } from "../../lib/mission-control/contracts";
import { ReviewedRecallV1Schema } from "../../lib/mission-control/contracts";
import type { AgentBrainPort } from "../mission-control/ports";

const CandidateSchema = z.object({
  source_kind: z.literal("reviewed_page"),
  page_id: z.string().min(1).max(256),
  path: z.string().min(1),
  excerpt: z.string().min(1).max(4096),
  reviewed_at: z.string().datetime({ offset: true }),
}).strict();

export type ReviewedPageCandidate = z.infer<typeof CandidateSchema>;

export type ReviewedAgentBrainOptions = Readonly<{
  agentBrainRoot: string;
  searchReviewed: (query: string, project_id: ProjectId) => Promise<readonly unknown[]>;
  realpath: (path: string) => Promise<string>;
  readFile: (path: string) => Promise<string>;
  maxResults?: number;
}>;

function isWithin(root: string, candidate: string): boolean {
  const relative = win32.relative(root, candidate);
  return relative !== "" && !relative.startsWith(`..${win32.sep}`) && relative !== ".." && !win32.isAbsolute(relative);
}

export class ReviewedAgentBrain implements AgentBrainPort {
  private readonly maxResults: number;

  constructor(private readonly options: ReviewedAgentBrainOptions) {
    if (!win32.isAbsolute(options.agentBrainRoot)) throw new Error("AgentBrain root must be absolute.");
    this.maxResults = options.maxResults ?? 8;
    if (!Number.isSafeInteger(this.maxResults) || this.maxResults <= 0 || this.maxResults > 32) throw new Error("AgentBrain result bound is invalid.");
  }

  async recallReviewed(query: string, project_id: ProjectId): Promise<ReviewedRecallV1[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery || normalizedQuery.length > 2_000) throw new Error("AgentBrain recall query is invalid.");
    const rootReal = await this.options.realpath(this.options.agentBrainRoot);
    const pagesReal = await this.options.realpath(win32.join(rootReal, "pages"));
    if (!isWithin(rootReal, pagesReal)) throw new Error("AgentBrain reviewed pages root is invalid.");

    const candidates = await this.options.searchReviewed(normalizedQuery, project_id);
    const recalls: ReviewedRecallV1[] = [];
    for (const untrusted of candidates.slice(0, this.maxResults)) {
      const parsed = CandidateSchema.safeParse(untrusted);
      if (!parsed.success) throw new Error("AgentBrain recall accepts reviewed pages only.");
      const candidate = parsed.data;
      const candidateReal = await this.options.realpath(candidate.path);
      if (!isWithin(pagesReal, candidateReal) || win32.extname(candidateReal).toLowerCase() !== ".md") throw new Error("AgentBrain recall accepts reviewed pages only.");
      const content = await this.options.readFile(candidateReal);
      if (!content.includes(candidate.excerpt)) throw new Error("AgentBrain reviewed excerpt does not match its source page.");
      recalls.push(ReviewedRecallV1Schema.parse({
        page_id: candidate.page_id,
        page_digest: createHash("sha256").update(content, "utf8").digest("hex"),
        excerpt: candidate.excerpt,
        reviewed_at: candidate.reviewed_at,
      }));
    }
    return recalls;
  }
}
