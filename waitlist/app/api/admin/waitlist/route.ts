import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase-admin"
import { isAdminPanelEnabled } from "@/lib/admin"

const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || "180476"

export async function GET(req: NextRequest) {
  if (!isAdminPanelEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const passcode = req.headers.get("x-admin-passcode") || req.nextUrl.searchParams.get("passcode")

  if (passcode !== ADMIN_PASSCODE) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("waitlist")
      .select("id, email, alias, created_at")
      .order("created_at", { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      entries: data,
      total: data?.length ?? 0,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch waitlist" },
      { status: 500 }
    )
  }
}
