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
  page_digest: z.string().regex(/^[0-9a-f]{64}$/),
  excerpt: z.string().min(1).max(4096),
  reviewed_at: z.string().datetime({ offset: true }),
}).strict();

export type ReviewedPageCandidate = z.infer<typeof CandidateSchema>;

export type ReviewedAgentBrainOptions = Readonly<{
  agentBrainRoot: string;
  expectedPagesRealPath: string;
  searchReviewed: (query: string, project_id: ProjectId) => Promise<readonly unknown[]>;
  realpath: (path: string) => Promise<string>;
  readFile: (path: string) => Promise<string>;
  maxResults?: number;
  maxPageBytes?: number;
}>;

function isWithin(root: string, candidate: string): boolean {
  const relative = win32.relative(root, candidate);
  return relative !== "" && !relative.startsWith(`..${win32.sep}`) && relative !== ".." && !win32.isAbsolute(relative);
}

function normalized(path: string): string {
  return win32.normalize(path).replace(/[\\/]+$/, "").toLocaleLowerCase("en-US");
}

function requireLocalDrivePath(path: string, label: string): void {
  if (path.includes("\0") || !/^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("//") || path.slice(2).includes(":")) {
    throw new Error(`${label} must be a drive-qualified local Windows path.`);
  }
}

export class ReviewedAgentBrain implements AgentBrainPort {
  private readonly maxResults: number;
  private readonly maxPageBytes: number;

  constructor(private readonly options: ReviewedAgentBrainOptions) {
    requireLocalDrivePath(options.agentBrainRoot, "AgentBrain root");
    requireLocalDrivePath(options.expectedPagesRealPath, "AgentBrain pinned pages root");
    this.maxResults = options.maxResults ?? 8;
    this.maxPageBytes = options.maxPageBytes ?? 512 * 1024;
    if (!Number.isSafeInteger(this.maxResults) || this.maxResults <= 0 || this.maxResults > 32) throw new Error("AgentBrain result bound is invalid.");
    if (!Number.isSafeInteger(this.maxPageBytes) || this.maxPageBytes <= 0 || this.maxPageBytes > 4 * 1024 * 1024) throw new Error("AgentBrain page-size bound is invalid.");
  }

  async recallReviewed(query: string, project_id: ProjectId): Promise<ReviewedRecallV1[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery || normalizedQuery.length > 2_000) throw new Error("AgentBrain recall query is invalid.");
    const rootReal = await this.options.realpath(this.options.agentBrainRoot);
    requireLocalDrivePath(rootReal, "AgentBrain real root");
    const pagesLexical = win32.join(this.options.agentBrainRoot, "pages");
    const pagesReal = await this.options.realpath(pagesLexical);
    requireLocalDrivePath(pagesReal, "AgentBrain reviewed pages root");
    if (normalized(pagesReal) !== normalized(this.options.expectedPagesRealPath)) throw new Error("AgentBrain reviewed pages root no longer matches its pinned target.");
    if (!isWithin(rootReal, pagesReal)) throw new Error("AgentBrain reviewed pages root is invalid.");

    const candidates = await this.options.searchReviewed(normalizedQuery, project_id);
    const recalls: ReviewedRecallV1[] = [];
    for (const untrusted of candidates.slice(0, this.maxResults)) {
      const parsed = CandidateSchema.safeParse(untrusted);
      if (!parsed.success) throw new Error("AgentBrain recall accepts reviewed pages only.");
      const candidate = parsed.data;
      if (!isWithin(pagesLexical, candidate.path)) throw new Error("AgentBrain recall accepts reviewed pages only.");
      const candidateReal = await this.options.realpath(candidate.path);
      if (!isWithin(pagesReal, candidateReal) || win32.extname(candidateReal).toLowerCase() !== ".md") throw new Error("AgentBrain recall accepts reviewed pages only.");
      const derivedPageId = win32.relative(pagesReal, candidateReal).split(win32.sep).join("/");
      if (candidate.page_id !== derivedPageId) throw new Error("AgentBrain reviewed page identity does not match its relative path.");
      const content = await this.options.readFile(candidateReal);
      if (Buffer.byteLength(content, "utf8") > this.maxPageBytes) throw new Error("AgentBrain reviewed page exceeds the configured byte bound.");
      const candidateRealAfterRead = await this.options.realpath(candidate.path);
      if (normalized(candidateRealAfterRead) !== normalized(candidateReal)) throw new Error("AgentBrain reviewed page changed identity while it was read.");
      const digest = createHash("sha256").update(content, "utf8").digest("hex");
      if (digest !== candidate.page_digest) throw new Error("AgentBrain reviewed page digest is stale.");
      if (!content.includes(candidate.excerpt)) throw new Error("AgentBrain reviewed excerpt does not match its source page.");
      recalls.push(ReviewedRecallV1Schema.parse({
        page_id: derivedPageId,
        page_digest: digest,
        excerpt: candidate.excerpt,
        reviewed_at: candidate.reviewed_at,
      }));
    }
    return recalls;
  }
}
