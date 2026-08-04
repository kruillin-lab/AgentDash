export const MISSION_CONTROL_HOST = "127.0.0.1:3007";
export const MISSION_CONTROL_ORIGIN = "http://127.0.0.1:3007";

export type LocalAuthorityResult = { ok: true } | { ok: false; code: "invalid_local_authority" };

/**
 * Accepts only the one local browser authority used by the MVP. Forwarded
 * headers are rejected rather than trusted because the service has no proxy.
 */
export function validateLocalMissionControlAuthority(headers: Headers): LocalAuthorityResult {
  const host = headers.get("host");
  const origin = headers.get("origin");
  const hasForwardedAuthority = ["forwarded", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-origin"].some(
    (header) => headers.has(header),
  );

  if (hasForwardedAuthority || host !== MISSION_CONTROL_HOST || origin !== MISSION_CONTROL_ORIGIN) {
    return { ok: false, code: "invalid_local_authority" };
  }

  return { ok: true };
}
