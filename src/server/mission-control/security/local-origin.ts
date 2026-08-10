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
  const forwardedHost = headers.get("x-forwarded-host");
  const forwardedProto = headers.get("x-forwarded-proto");
  // Next synthesizes x-forwarded-host/-proto/-port/-for on EVERY request
  // (next/dist/server/base-server.js: `req.headers["x-forwarded-host"] ??= req.headers["host"]`),
  // so their presence proves nothing and rejecting on presence alone rejects every real
  // request. It assigns with `??=`, which means a client-supplied value survives instead of
  // being overwritten - so the question is whether each value is exactly what Next would
  // have synthesized for a direct connection. Anything else came from the caller.
  //
  // x-forwarded-for and x-forwarded-port are deliberately not checked: no decision here
  // consults them, and their synthesized values vary with the socket family.
  const hasSuppliedForwarding = headers.has("forwarded")
    || headers.has("x-forwarded-origin")
    || (forwardedHost !== null && forwardedHost !== host)
    || (forwardedProto !== null && forwardedProto !== "http");

  if (hasSuppliedForwarding || host === null || !MISSION_CONTROL_HOSTS.includes(host) || origin !== `http://${host}`) {
    return { ok: false, code: "invalid_local_authority" };
  }

  return { ok: true };
}
