import { z } from "zod";

import { DigestSchema, canonicalDigest } from "./common";

const normalizedRelativePathSchema = z.string().min(1).superRefine((value, context) => {
  const segments = value.split("/");
  if (
    value.includes("\\")
    || value.startsWith("/")
    || /^[A-Za-z]:/.test(value)
    || /[\u0000-\u001f\u007f]/.test(value)
    || segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "path must be a normalized safe relative POSIX path" });
  }
});

export const MutationTypeInternalSchema = z.enum(["no_change_close", "artifact_delivery", "local_patch", "approved_merge"]);

const mutationEntrySchema = z.object({
  path: normalizedRelativePathSchema,
  operation: z.enum(["add", "modify", "delete"]),
  before_digest: DigestSchema.nullable(),
  after_digest: DigestSchema.nullable(),
}).strict().superRefine((value, context) => {
  const valid = value.operation === "add"
    ? value.before_digest === null && value.after_digest !== null
    : value.operation === "modify"
      ? value.before_digest !== null && value.after_digest !== null && value.before_digest !== value.after_digest
      : value.before_digest !== null && value.after_digest === null;
  if (!valid) context.addIssue({ code: z.ZodIssueCode.custom, message: `${value.operation} mutation carries an invalid digest state` });
});

export const MutationManifestInternalSchema = z.object({
  mutation_type: MutationTypeInternalSchema,
  entries: z.array(mutationEntrySchema),
  diff_bytes: z.number().int().nonnegative(),
  manifest_digest: DigestSchema,
  patch_digest: DigestSchema,
}).strict().superRefine((value, context) => {
  if (new Set(value.entries.map((entry) => entry.path)).size !== value.entries.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["entries"], message: "mutation manifest paths must be unique" });
  }
  const expectedManifestDigest = canonicalDigest({ mutation_type: value.mutation_type, entries: value.entries, diff_bytes: value.diff_bytes, patch_digest: value.patch_digest });
  if (value.manifest_digest !== expectedManifestDigest) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["manifest_digest"], message: "mutation manifest digest does not match its canonical content" });
  }
  if (value.entries.length === 0 && value.diff_bytes !== 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["diff_bytes"], message: "an empty mutation manifest must have zero diff bytes" });
  }
  if (value.mutation_type === "local_patch" && (value.entries.length === 0 || value.diff_bytes === 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "a local patch must carry at least one changed file and positive diff bytes" });
  }
  if (value.mutation_type === "no_change_close") {
    const expectedPatchDigest = canonicalDigest({ mutation_type: "no_change_close", entries: [] });
    if (value.entries.length !== 0 || value.diff_bytes !== 0 || value.patch_digest !== expectedPatchDigest) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "no-change close requires the canonical empty mutation" });
    }
  }
});

export const MutationScopeInternalSchema = z.object({
  mutation_type: MutationTypeInternalSchema,
  allowed_path_prefixes: z.array(normalizedRelativePathSchema),
  max_files: z.number().int().nonnegative(),
  max_diff_bytes: z.number().int().nonnegative(),
  prohibited_changes: z.array(z.string()),
}).strict();

type MutationEnvelope = z.infer<typeof MutationScopeInternalSchema> & { mutation_manifest: z.infer<typeof MutationManifestInternalSchema> };

export const validateMutationEnvelope = (value: MutationEnvelope, context: z.RefinementCtx) => {
  if (value.mutation_type !== value.mutation_manifest.mutation_type) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "mutation manifest exceeds the allowed mutation type" });
  }
  if (value.mutation_manifest.entries.length > value.max_files) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["mutation_manifest", "entries"], message: "mutation manifest exceeds the file ceiling" });
  }
  if (value.mutation_manifest.diff_bytes > value.max_diff_bytes) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["mutation_manifest", "diff_bytes"], message: "mutation manifest exceeds the diff-byte ceiling" });
  }
  for (const [index, entry] of value.mutation_manifest.entries.entries()) {
    const contained = value.allowed_path_prefixes.some((prefix) => entry.path === prefix || entry.path.startsWith(`${prefix}/`));
    if (!contained) context.addIssue({ code: z.ZodIssueCode.custom, path: ["mutation_manifest", "entries", index, "path"], message: "mutation path is outside the allowed path prefixes" });
  }
  if (value.mutation_type === "no_change_close" && (value.max_files !== 0 || value.max_diff_bytes !== 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "no-change close requires zero mutation ceilings" });
  }
};
