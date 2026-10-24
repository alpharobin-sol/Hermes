import type { Metadata } from "next"
import { SettingsPage } from "@/components/app/settings-page"

export const metadata: Metadata = {
  title: "Settings · Hermes",
  alternates: { canonical: "/settings" },
  robots: { index: false, follow: true },
}

export default function Settings() {
  return <SettingsPage />
}
