export const MISSION_CONTROL_HOST = "127.0.0.1:3007";
export const MISSION_CONTROL_ORIGIN = "http://127.0.0.1:3007";

/**
 * The one loopback service is reachable under either name a browser may use for it.
 * Deliberately NOT widened further: `[::1]:3007` and `0.0.0.0:3007` stay rejected, the
 * first because the server binds IPv4 and the second because it names every interface
 * rather than the loopback.
 */
export const MISSION_CONTROL_HOSTS: readonly string[] = [MISSION_CONTROL_HOST, "localhost:3007"];

export type LocalAuthorityResult = { ok: true } | { ok: false; code: "invalid_local_authority" };

/**
 * Accepts only a local browser authority. Forwarded headers are rejected rather than
 * trusted because the service has no proxy.
 *
 * A request must also be internally consistent: the Origin must name the very Host the
 * request was sent to. Accepting both loopback names without that pairing would let a
 * page served on one name drive the other, which the browser treats as a genuinely
 * cross-origin request and would send without a preflight.
 */
export function validateLocalMissionControlAuthority(headers: Headers): LocalAuthorityResult {
  const host = headers.get("host");
  const origin = headers.get("origin");
  const hasForwardedAuthority = ["forwarded", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-origin"].some(
    (header) => headers.has(header),
  );

  if (hasForwardedAuthority || host === null || !MISSION_CONTROL_HOSTS.includes(host) || origin !== `http://${host}`) {
    return { ok: false, code: "invalid_local_authority" };
  }

  return { ok: true };
}
