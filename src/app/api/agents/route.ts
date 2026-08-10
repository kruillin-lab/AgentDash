export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { loadRegistry } from "@/server/agents/registry"

export async function GET() {
  return NextResponse.json({ items: await loadRegistry() })
}