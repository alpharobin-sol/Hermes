"use client"

import type React from "react"

import { AppHeader } from "./app-header"
import { AppFooter } from "./app-footer"
import { LoadingProvider } from "./loading-context"
import WalletAdapterProvider from "@/components/app/providers/WalletAdapterProvider"

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <WalletAdapterProvider>
      <LoadingProvider>
        <div className="flex min-h-screen flex-col bg-background">
          <AppHeader />
          <main className="flex-1">{children}</main>
          <AppFooter />
        </div>
      </LoadingProvider>
    </WalletAdapterProvider>
  )
}
