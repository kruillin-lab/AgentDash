import { describe, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";

import { ReviewedAgentBrain } from "./recall";

const brainRoot = "C:\\Projects\\AgentBrain";
const pagePath = `${brainRoot}\\pages\\operating-model.md`;
const page = "# Operating model\n\nThe PM proposes work and never executes it.";
const pageDigest = createHash("sha256").update(page, "utf8").digest("hex");

function brain(candidate = {
  source_kind: "reviewed_page" as const,
  page_id: "operating-model.md",
  path: pagePath,
  page_digest: pageDigest,
  excerpt: "The PM proposes work and never executes it.",
  reviewed_at: "2026-08-06T12:00:00.000Z",
}) {
  return new ReviewedAgentBrain({
    agentBrainRoot: brainRoot,
    expectedPagesRealPath: `${brainRoot}\\pages`,
    searchReviewed: vi.fn(async () => [candidate]),
    realpath: vi.fn(async (path: string) => path),
    readFile: vi.fn(async () => page),
  });
}

describe("ReviewedAgentBrain", () => {
  test("returns digest-bound excerpts from reviewed durable pages", async () => {
    const result = await brain().recallReviewed("PM isolation", "agentdash" as never);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ page_id: "operating-model.md", excerpt: "The PM proposes work and never executes it.", reviewed_at: "2026-08-06T12:00:00.000Z" });
    expect(result[0].page_digest).toBe(pageDigest);
  });

  test.each(["state", "raw", "dream", "CodexBrain.retired", "ClaudeBrain.retired"])("rejects forbidden %s source", async (segment) => {
    const candidate = {
      source_kind: "reviewed_page" as const,
      page_id: "forbidden.md",
      path: `${brainRoot}\\${segment}\\forbidden.md`,
      page_digest: pageDigest,
      excerpt: "The PM proposes work and never executes it.",
      reviewed_at: "2026-08-06T12:00:00.000Z",
    };
    await expect(brain(candidate).recallReviewed("PM", "agentdash" as never)).rejects.toThrow(/reviewed pages/i);
  });

  test("rejects a page symlink whose real target escapes AgentBrain pages", async () => {
    const reviewed = brain();
    const escaped = new ReviewedAgentBrain({
      agentBrainRoot: brainRoot,
      expectedPagesRealPath: `${brainRoot}\\pages`,
      searchReviewed: vi.fn(async () => [{ source_kind: "reviewed_page", page_id: "escape.md", path: `${brainRoot}\\pages\\escape.md`, page_digest: createHash("sha256").update("secret").digest("hex"), excerpt: "secret", reviewed_at: "2026-08-06T12:00:00.000Z" }]),
      realpath: vi.fn(async (path: string) => path.endsWith("escape.md") ? "C:\\outside\\escape.md" : path),
      readFile: vi.fn(async () => "secret"),
    });
    await expect(escaped.recallReviewed("secret", "agentdash" as never)).rejects.toThrow(/reviewed pages/i);
    expect(reviewed).toBeDefined();
  });

  test("rejects transcript substitution even when it has a page-looking path", async () => {
    const candidate = {
      source_kind: "transcript" as const,
      page_id: "operating-model.md",
      path: pagePath,
      page_digest: pageDigest,
      excerpt: "The PM proposes work and never executes it.",
      reviewed_at: "2026-08-06T12:00:00.000Z",
    };
    await expect(brain(candidate as never).recallReviewed("PM", "agentdash" as never)).rejects.toThrow(/reviewed page/i);
  });

  test("rejects excerpts that are not present in the reviewed source", async () => {
    const candidate = { source_kind: "reviewed_page" as const, page_id: "operating-model.md", path: pagePath, page_digest: pageDigest, excerpt: "invented answer", reviewed_at: "2026-08-06T12:00:00.000Z" };
    await expect(brain(candidate).recallReviewed("PM", "agentdash" as never)).rejects.toThrow(/excerpt/i);
  });

  test("derives page identity from the reviewed relative path", async () => {
    await expect(brain({
      source_kind: "reviewed_page",
      page_id: "spoofed.md",
      path: pagePath,
      page_digest: pageDigest,
      excerpt: "The PM proposes work and never executes it.",
      reviewed_at: "2026-08-06T12:00:00.000Z",
    }).recallReviewed("PM", "agentdash" as never)).rejects.toThrow(/page identity/i);
  });

  test("rejects a stale reviewed-page digest", async () => {
    await expect(brain({
      source_kind: "reviewed_page",
      page_id: "operating-model.md",
      path: pagePath,
      page_digest: "0".repeat(64),
      excerpt: "The PM proposes work and never executes it.",
      reviewed_at: "2026-08-06T12:00:00.000Z",
    }).recallReviewed("PM", "agentdash" as never)).rejects.toThrow(/digest/i);
  });

  test("rejects a retargeted reviewed pages root", async () => {
    const retargeted = new ReviewedAgentBrain({
      agentBrainRoot: brainRoot,
      expectedPagesRealPath: `${brainRoot}\\pages`,
      searchReviewed: vi.fn(async () => []),
      realpath: vi.fn(async (path: string) => path.endsWith("pages") ? "C:\\outside\\pages" : path),
      readFile: vi.fn(async () => page),
    });
    await expect(retargeted.recallReviewed("PM", "agentdash" as never)).rejects.toThrow(/pinned/i);
  });

  test("rejects a page that changes identity while it is read", async () => {
    let pageChecks = 0;
    const replaced = new ReviewedAgentBrain({
      agentBrainRoot: brainRoot,
      expectedPagesRealPath: `${brainRoot}\\pages`,
      searchReviewed: vi.fn(async () => [{ source_kind: "reviewed_page", page_id: "operating-model.md", path: pagePath, page_digest: pageDigest, excerpt: "The PM proposes work and never executes it.", reviewed_at: "2026-08-06T12:00:00.000Z" }]),
      realpath: vi.fn(async (path: string) => {
        if (path === pagePath && ++pageChecks > 1) return "C:\\outside\\replacement.md";
        return path;
      }),
      readFile: vi.fn(async () => page),
    });
    await expect(replaced.recallReviewed("PM", "agentdash" as never)).rejects.toThrow(/changed/i);
  });
});
