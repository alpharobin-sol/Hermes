import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { isAdminPanelEnabled } from "@/lib/admin"

export const metadata: Metadata = {
  title: "Admin - Hermes Waitlist",
  robots: "noindex, nofollow",
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!isAdminPanelEnabled()) notFound()
  return children
}
