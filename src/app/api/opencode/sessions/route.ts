export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { OpenCodeClient, type OpenCodeError } from "@/server/opencode/client"

function errorResponse(err: unknown) {
  const e = err as OpenCodeError
  return NextResponse.json(
    { error: { code: "OPENCODE_REQUEST_FAILED", message: e?.message ?? String(err), body: e?.body } },
    { status: typeof e?.status === "number" ? e.status : 502 },
  )
}

// GET /api/opencode/sessions
export async function GET(req: Request) {
  const url = new URL(req.url)
  const limit = url.searchParams.get("limit")
  const order = url.searchParams.get("order") as "asc" | "desc" | null
  const search = url.searchParams.get("search") ?? undefined
  try {
    const data = await OpenCodeClient.fromEnv().listSessions({
      limit: limit ? Number(limit) : undefined,
      order: order ?? undefined,
      search: search ?? undefined,
    })
    // Normalize: installed v2 returns { data, cursor }; source-tree returns { items, cursor }.
    const items = data.items ?? data.data ?? []
    return NextResponse.json({ items, cursor: data.cursor })
  } catch (err) {
    return errorResponse(err)
  }
}