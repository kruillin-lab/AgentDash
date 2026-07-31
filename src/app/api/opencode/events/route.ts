export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { OpenCodeClient, parseSseChunk } from "@/server/opencode/client"

/**
 * SSE proxy for OpenCode's /event stream. Keeps the OpenCode password on the
 * server; the browser subscribes to this route with no auth header.
 *
 * We re-emit parsed events as `data: <json>\n\n`, one per OpenCode event, plus
 * periodic keepalives so the connection stays open through idle periods.
 */
export async function GET() {
  const client = OpenCodeClient.fromEnv()
  const upstreamUrl = client.eventStreamUrl()

  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let aborted = false
      const keepalive = setInterval(() => {
        if (aborted) return
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`))
        } catch {
          /* closed */
        }
      }, 15000)

      let upstream: Response
      try {
        upstream = await fetch(upstreamUrl, {
          method: "GET",
          headers: {
            accept: "text/event-stream",
            ...(client.config_.password
              ? { authorization: "Basic " + Buffer.from(`opencode:${client.config_.password}`).toString("base64") }
              : {}),
          },
        })
      } catch (err) {
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: "OpenCode server unreachable", error: String(err) })}\n\n`))
        controller.close()
        clearInterval(keepalive)
        return
      }

      if (!upstream.ok || !upstream.body) {
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ status: upstream.status, message: "OpenCode /event rejected" })}\n\n`))
        controller.close()
        clearInterval(keepalive)
        return
      }

      const reader = upstream.body.getReader()
      let buffer = ""
      try {
        while (!aborted) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          // Try to flush complete blocks.
          const blocks = buffer.split(/\r?\n\r?\n/)
          buffer = blocks.pop() ?? ""
          for (const block of blocks) {
            const events = parseSseChunk(block + "\n\n")
            for (const ev of events) {
              const payload = JSON.stringify(ev)
              controller.enqueue(encoder.encode(`event: ${ev.type}\ndata: ${payload}\n\n`))
            }
          }
        }
      } catch (err) {
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: "stream read failed", error: String(err) })}\n\n`))
      } finally {
        clearInterval(keepalive)
        aborted = true
        try { reader.releaseLock() } catch {}
        try { controller.close() } catch {}
      }
    },
    cancel() {
      // ReadableStream cancel — upstream reader cleanup happens via the loop's
      // `done` check on the next read; nothing else to do here.
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  })
}