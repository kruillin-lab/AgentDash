import { describe, expect, test, vi } from "vitest";

import { WorkspaceRegistry } from "./registry";

const root = "C:\\work\\AgentDash";
const config = {
  schema_version: "agentdash.mission-control-projects/v1" as const,
  projects: [{ project_id: "agentdash", allowed_roots: [root], expected_real_root: root, expected_folder_id: "folder:42" }],
};

function registry(overrides: Partial<ConstructorParameters<typeof WorkspaceRegistry>[0]> = {}) {
  return new WorkspaceRegistry({
    config,
    realpath: vi.fn(async (path: string) => path),
    listFolders: vi.fn(async () => [{ id: 42, path: root, parent_id: null, kind: "project" }]),
    ...overrides,
  });
}

describe("WorkspaceRegistry", () => {
  test("resolves one allowlisted real project root and normalizes Windows case", async () => {
    await expect(registry().resolve("agentdash", "c:\\WORK\\agentdash")).resolves.toEqual({
      project_id: "agentdash",
      requested_root: "c:\\WORK\\agentdash",
      real_root: root,
      folder_id: "folder:42",
    });
  });

  test("rejects a junction whose real target escapes the allowlist", async () => {
    const realpath = vi.fn(async (path: string) => path.toLowerCase().includes("junction") ? "C:\\other\\secret" : path);
    await expect(registry({ realpath }).resolve("agentdash", "C:\\work\\junction")).rejects.toThrow(/real path/i);
  });

  test.each([
    "\\\\server\\share\\AgentDash",
    "//server/share/AgentDash",
    "\\rooted\\AgentDash",
    "C:relative\\AgentDash",
    "\\\\?\\C:\\work\\AgentDash",
    "\\\\.\\C:\\work\\AgentDash",
    "C:\\work\\AgentDash:stream",
    "C:\\other\\AgentDash",
    "relative\\AgentDash",
  ])("rejects device, UNC, ADS, nonallowlisted, or non-drive-absolute root %s", async (requested) => {
    await expect(registry().resolve("agentdash", requested)).rejects.toThrow();
  });

  test("rejects a configured root whose canonical target changed", async () => {
    const realpath = vi.fn(async (path: string) => path.toLowerCase() === root.toLowerCase() ? "C:\\other\\retargeted" : path);
    await expect(registry({ realpath }).resolve("agentdash", root)).rejects.toThrow(/configured real path/i);
  });

  test("rejects a missing Codeg folder", async () => {
    await expect(registry({ listFolders: vi.fn(async () => []) }).resolve("agentdash", root)).rejects.toThrow(/missing/i);
  });

  test("rejects duplicate Codeg folders for the same real root", async () => {
    const listFolders = vi.fn(async () => [
      { id: 42, path: root, parent_id: null, kind: "project" },
      { id: 43, path: "c:\\WORK\\AGENTDASH", parent_id: null, kind: "project" },
    ]);
    await expect(registry({ listFolders }).resolve("agentdash", root)).rejects.toThrow(/duplicate/i);
  });

  test("rejects a stale configured Codeg folder identity", async () => {
    const listFolders = vi.fn(async () => [{ id: 99, path: root, parent_id: null, kind: "project" }]);
    await expect(registry({ listFolders }).resolve("agentdash", root)).rejects.toThrow(/stale/i);
  });

  test("requires a pinned Codeg folder identity before resolution", async () => {
    const unpinned = {
      ...config,
      projects: [{ ...config.projects[0], expected_folder_id: null }],
    };
    await expect(registry({ config: unpinned }).resolve("agentdash", root)).rejects.toThrow(/pinned/i);
  });

  test.each([
    { id: 42, path: root, parent_id: 7, kind: "project" },
    { id: 42, path: root, parent_id: null, kind: "worktree" },
    { id: 42, path: root, parent_id: null, kind: "chat" },
  ])("rejects a non-root project-folder record %#", async (folder) => {
    await expect(registry({ listFolders: vi.fn(async () => [folder]) }).resolve("agentdash", root)).rejects.toThrow(/missing/i);
  });

  test("rejects a workspace that changes between approval and submission", async () => {
    let moved = false;
    const realpath = vi.fn(async (path: string) => moved && path.toLowerCase() === root.toLowerCase() ? "C:\\work\\AgentDash-moved" : path);
    const workspaces = registry({ realpath });
    const binding = await workspaces.resolve("agentdash", root);
    moved = true;
    await expect(workspaces.assertCurrent(binding)).rejects.toThrow(/changed/i);
  });
});
