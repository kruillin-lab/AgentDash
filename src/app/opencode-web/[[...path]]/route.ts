export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextRequest } from "next/server"
import { resolveConfig } from "@/server/opencode/client"
import { loadEnvOverride } from "@/server/opencode/env"

/**
 * Reverse-proxy the opencode web UI through Mission Control.
 *
 * Strategy:
 *   1. Inject `<base href="/opencode-web/">` after `<meta charset…>` so every
 *      root-relative URL in the SPA resolves against the proxy.
 *   2. No JS/CSS rewriting — the SPA bundle passes through unmodified.
 *   3. No fetch / EventSource / WebSocket interceptor — the `<base>` tag
 *      covers the only hardcoded absolute URL (one placeholder string in a
 *      dialog, not functional code).
 *   4. All requests (HTML, JS, CSS, SSE, JSON, binary) stream or buffer
 *      depending on content-type, with Authorization injected server-side.
 */
export async function GET(req: NextRequest) {
  loadEnvOverride()
  const config = resolveConfig()
  if (!config.password) {
    return new Response("OPENCODE_SERVER_PASSWORD is not set. Add it to your .env and restart.", { status: 500 })
  }

  const url = new URL(req.url)
  const targetPath = url.pathname.replace(/^\/opencode-web/, "") || "/"
  const target = new URL(targetPath, config.baseUrl)
  target.search = url.search

  const reqHeaders = new Headers()
  const accept = req.headers.get("accept")
  if (accept) reqHeaders.set("accept", accept)
  const reqCt = req.headers.get("content-type")
  if (reqCt && req.method !== "GET" && req.method !== "HEAD") reqHeaders.set("content-type", reqCt)
  reqHeaders.set("host", new URL(config.baseUrl).host)
  reqHeaders.set("authorization", `Basic ${Buffer.from(`opencode:${config.password}`).toString("base64")}`)
  reqHeaders.set("accept-encoding", "identity") // need raw body for HTML injection

  let upstream: Response
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers: reqHeaders,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer().catch(() => null),
      redirect: "manual",
    })
  } catch (err: any) {
    return new Response(`opencode upstream unreachable: ${err?.message ?? String(err)}`, { status: 502 })
  }

  const outHeaders = new Headers()
  const upstreamCT = (upstream.headers.get("content-type") ?? "").toLowerCase()
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (lower === "set-cookie") return
    if (lower === "location" && value.startsWith(config.baseUrl)) { outHeaders.set(key, "/opencode-web" + value.slice(config.baseUrl.length)); return }
    if (["transfer-encoding", "connection", "keep-alive", "content-encoding", "content-length"].includes(lower)) return
    outHeaders.set(key, value)
  })

  // ── HTML: rewrite root-relative asset URLs to include the proxy
  // prefix, and inject a tiny fetch/EventSource/WebSocket interceptor that
  // rewrites absolute opcode server URLs back to the proxy path. This is
  // necessary because the opencode SPA hardcodes `http://localhost:4096` in
  // its API calls, and root-relative URLs only resolve correctly with the
  // proxy prefix.
  //
  // We do NOT inject `<base>` because it changes document.baseURI and can
  // confuse the SPA's client-side router.
  if (upstreamCT.includes("text/html")) {
    const text = await upstream.text()
    // Rewrite asset references so they load through the proxy.
    const withAssets = text
      .replaceAll('src="/assets/', `src="/opencode-web/assets/`)
      .replaceAll('href="/assets/', `href="/opencode-web/assets/`)
      .replaceAll('href="/favicon', `href="/opencode-web/favicon`)
      .replaceAll('href="/site.', `href="/opencode-web/site.`)
      .replaceAll('href="/apple-', `href="/opencode-web/apple-`)
      .replaceAll('href="/social-', `href="/opencode-web/social-`)
      .replaceAll('href="/manifest', `href="/opencode-web/manifest`)
    // Inject the URL-rewriting interceptor right before the SPA's own
    // inline scripts (so it runs first).
    const interceptor = `<script>(function(){
var _f=window.fetch;_fetch=_f;
window.fetch=function(u,i){
  if(typeof u==="string"&&u.startsWith("http://127.0.0.1:4096"))u="/opencode-web"+u.slice(21);
  else if(typeof u==="string"&&u.startsWith("http://localhost:4096"))u="/opencode-web"+u.slice(22);
  else if(u instanceof Request){var o={method:u.method,headers:u.headers,mode:u.mode,credentials:u.credentials,cache:u.cache,redirect:u.redirect,referrer:u.referrer,integrity:u.integrity,body:u.body};var nu=u.url;if(nu.startsWith("http://127.0.0.1:4096"))nu="/opencode-web"+nu.slice(21);else if(nu.startsWith("http://localhost:4096"))nu="/opencode-web"+nu.slice(22);return _f(nu,o)}
  return _f(u,i)
};
var _eS=window.EventSource;
window.EventSource=function(u,i){
  if(typeof u==="string"&&u.startsWith("http://127.0.0.1:4096"))u="/opencode-web"+u.slice(21);
  else if(typeof u==="string"&&u.startsWith("http://localhost:4096"))u="/opencode-web"+u.slice(22);
  return new _eS(u,i)
};window.EventSource.prototype=_eS.prototype;
var _ws=window.WebSocket;
window.WebSocket=function(u,p){
  if(typeof u==="string"&&u.startsWith("ws://127.0.0.1:4096"))u=u.replace("ws://127.0.0.1:4096","/opencode-web");
  return new _ws(u,p)
};window.WebSocket.prototype=_ws.prototype;
})();</script>`
    const injected = withAssets.replace(/<script\s/, interceptor + '\n  <script ')
    outHeaders.set("content-length", String(Buffer.byteLength(injected, "utf8")))
    return new Response(injected, { status: upstream.status, statusText: upstream.statusText, headers: outHeaders })
  }

  // ── Everything else: stream through as-is. Upstream body is consumed;
  // Next.js handles transfer-encoding (chunked) for us. ──
  if (upstream.body) {
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: outHeaders })
  }
  return new Response(null, { status: upstream.status, statusText: upstream.statusText, headers: outHeaders })
}

export const POST = GET
export const PUT = GET
export const DELETE = GET
export const PATCH = GET