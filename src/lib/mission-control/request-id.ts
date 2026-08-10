import { z } from "zod";

export const CEORequestIdSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  "request_id must be a canonical UUID v4",
);

export type CEORequestId = z.infer<typeof CEORequestIdSchema>;

export function createCEORequestId(): CEORequestId {
  return CEORequestIdSchema.parse(globalThis.crypto.randomUUID());
}
