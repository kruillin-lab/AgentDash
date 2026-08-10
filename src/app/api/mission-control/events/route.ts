export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { z } from "zod";

// Server-sent events for worker activity. Accepts an `after` resume cursor and
// emits only strict activity envelopes. While the runtime is dormant and no
// live CodeG bridge is connected, the stream sends one honest unavailable
// envelope and closes; it never fabricates activity.
const ActivityEnvelopeV1Schema = z.object({
  schema_version: z.literal("agentdash.activity-envelope/v1"),
  cursor: z.string().nullable(),
  kind: z.string().min(1),
  unavailable_reason: z.string().min(1).nullable(),
}).strict();

function encode(envelope: unknown): string {
  return `data: ${JSON.stringify(ActivityEnvelopeV1Schema.parse(envelope))}\n\n`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const after = url.searchParams.get("after");

  const stream = new ReadableStream<string>({
    start(controller) {
      // Bounded: one honest envelope, then close. No live bridge is connected.
      controller.enqueue(encode({ schema_version: "agentdash.activity-envelope/v1", cursor: after, kind: "unavailable", unavailable_reason: "CodeG activity bridge is not configured." }));
      controller.close();
    },
    cancel() {
      // Client disconnected; nothing to clean up while dormant.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
