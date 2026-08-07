import "server-only";

import { win32 } from "node:path";
import { z } from "zod";

import type { CodeGWorkspaceBindingV1 } from "../../../lib/mission-control/contracts";
import { CodeGWorkspaceBindingV1Schema } from "../../../lib/mission-control/contracts";

const ProjectConfigSchema = z.object({
  project_id: z.string().min(1),
  allowed_roots: z.array(z.string().min(1)).min(1),
  expected_folder_id: z.string().regex(/^folder:[1-9]\d*$/).nullable(),
}).strict();

export const MissionControlProjectsConfigSchema = z.object({
  schema_version: z.literal("agentdash.mission-control-projects/v1"),
  projects: z.array(ProjectConfigSchema).min(1),
}).strict().superRefine((value, context) => {
  const ids = new Set<string>();
  for (const [index, project] of value.projects.entries()) {
    if (ids.has(project.project_id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["projects", index, "project_id"], message: "duplicate project id" });
    ids.add(project.project_id);
  }
});

export type MissionControlProjectsConfig = z.infer<typeof MissionControlProjectsConfigSchema>;

export type CodeGFolderRecord = Readonly<{
  id: number;
  path: string;
  parent_id: number | null;
  kind: string;
}>;

export type WorkspaceRegistryOptions = Readonly<{
  config: MissionControlProjectsConfig;
  realpath: (path: string) => Promise<string>;
  listFolders: () => Promise<readonly CodeGFolderRecord[]>;
}>;

function isUnc(path: string): boolean {
  return path.startsWith("\\\\") || path.startsWith("//");
}

function normalized(path: string): string {
  return win32.normalize(path).replace(/[\\/]+$/, "").toLocaleLowerCase("en-US");
}

function requireLocalAbsolute(path: string): void {
  if (isUnc(path) || !win32.isAbsolute(path)) throw new Error("Workspace root must be an absolute local Windows path.");
}

export class WorkspaceRegistry {
  private readonly config: MissionControlProjectsConfig;

  constructor(private readonly options: WorkspaceRegistryOptions) {
    this.config = MissionControlProjectsConfigSchema.parse(options.config);
    for (const project of this.config.projects) for (const root of project.allowed_roots) requireLocalAbsolute(root);
  }

  async resolve(project_id: string, requested_root: string): Promise<CodeGWorkspaceBindingV1> {
    requireLocalAbsolute(requested_root);
    const project = this.config.projects.find((entry) => entry.project_id === project_id);
    if (!project) throw new Error("Workspace project is not allowlisted.");

    const requestedReal = await this.options.realpath(requested_root);
    requireLocalAbsolute(requestedReal);
    const allowedReal = await Promise.all(project.allowed_roots.map(async (root) => {
      const value = await this.options.realpath(root);
      requireLocalAbsolute(value);
      return value;
    }));
    if (!allowedReal.some((root) => normalized(root) === normalized(requestedReal))) throw new Error("Workspace real path is outside the project allowlist.");

    const matches: Array<{ folder: CodeGFolderRecord; real: string }> = [];
    for (const folder of await this.options.listFolders()) {
      if (!Number.isSafeInteger(folder.id) || folder.id <= 0 || folder.parent_id !== null || folder.kind === "chat") continue;
      requireLocalAbsolute(folder.path);
      const real = await this.options.realpath(folder.path);
      requireLocalAbsolute(real);
      if (normalized(real) === normalized(requestedReal)) matches.push({ folder, real });
    }
    if (matches.length === 0) throw new Error("Codeg project folder is missing for the workspace real path.");
    if (matches.length !== 1) throw new Error("Codeg has duplicate project folders for the workspace real path.");

    const match = matches[0];
    const folderId = `folder:${match.folder.id}`;
    if (project.expected_folder_id !== null && project.expected_folder_id !== folderId) throw new Error("Configured Codeg folder identity is stale.");
    return CodeGWorkspaceBindingV1Schema.parse({
      project_id,
      requested_root,
      real_root: match.real,
      folder_id: folderId,
    });
  }

  async assertCurrent(binding: CodeGWorkspaceBindingV1): Promise<void> {
    const current = await this.resolve(binding.project_id, binding.requested_root);
    if (current.folder_id !== binding.folder_id || normalized(current.real_root) !== normalized(binding.real_root)) throw new Error("Workspace changed between approval and submission.");
  }
}
