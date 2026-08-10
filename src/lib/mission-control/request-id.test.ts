import { describe, expect, test, vi } from "vitest";

import { CEORequestIdSchema, createCEORequestId } from "./request-id";

describe("browser CEO request identity", () => {
  test("creates one canonical UUID with the browser crypto source", () => {
    const randomUUID = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("123e4567-e89b-42d3-a456-426614174000");

    expect(createCEORequestId()).toBe("123e4567-e89b-42d3-a456-426614174000");
    expect(randomUUID).toHaveBeenCalledTimes(1);

    randomUUID.mockRestore();
  });

  test.each([
    "123e4567-e89b-42d3-a456-426614174000",
    "123E4567-E89B-42D3-A456-426614174000",
  ])("accepts a canonical UUID independent of letter case: %s", (requestId) => {
    expect(CEORequestIdSchema.parse(requestId)).toBe(requestId);
  });

  test.each([
    "request-123",
    "123e4567-e89b-12d3-a456-426614174000",
    "123e4567-e89b-42d3-c456-426614174000",
    "{123e4567-e89b-42d3-a456-426614174000}",
  ])("rejects a noncanonical request identity: %s", (requestId) => {
    expect(CEORequestIdSchema.safeParse(requestId).success).toBe(false);
  });
});
