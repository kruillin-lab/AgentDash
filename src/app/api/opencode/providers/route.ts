export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { OpenCodeClient } from "@/server/opencode/client"

export async function GET() {
  try {
    const res = await OpenCodeClient.fromEnv().listProviders()
    const items = unwrapList(res.items) ?? unwrapList(res.data) ?? []
    return NextResponse.json({ items })
  } catch (err: any) {
    return NextResponse.json({ error: { code: "OPENCODE_PROVIDERS_FAILED", message: err?.message ?? String(err) } }, { status: 502 })
  }
}

function unwrapList(v: unknown): any[] | null {
  if (Array.isArray(v)) return v
  if (v && typeof v === "object" && Array.isArray((v as any).data)) return (v as any).data
  return null
}