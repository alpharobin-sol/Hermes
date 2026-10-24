import type React from "react"
import AppLayout from "@/components/app/layout/app-layout"
import { AlertsProvider } from "@/components/app/alerts"

// The app: the routes (/app), Portfolio, Settings and Docs, with the wallet, the menu and alerts
export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <AlertsProvider>
      <AppLayout>{children}</AppLayout>
    </AlertsProvider>
  )
}
