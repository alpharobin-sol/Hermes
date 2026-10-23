import type React from "react"
import type { Metadata } from "next"
import { Cinzel, Cormorant_Garamond, Inter } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"
import "./styles/wallet-adapter.css"
import { ThemeProvider } from "@/components/theme-provider"
import AppLayout from "@/components/app/layout/app-layout"
import { AlertsProvider } from "@/components/app/alerts"
import { SITE_URL } from "@/lib/site"

// Cormorant Garamond for headlines, Cinzel (Roman capitals) for rates and labels, Inter for sentences
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-cormorant",
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
})

const cinzel = Cinzel({
  subsets: ["latin"],
  variable: "--font-cinzel",
  weight: ["500", "600", "700"],
})

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: "/" },
  title: "Hermes - Yield Aggregator for Solana",
  description: "Compare live Solana yields across liquid staking and lending, then deposit from your own wallet.",
  appleWebApp: { capable: true, title: "Hermes", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/brand/favicon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/brand/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: "/brand/apple-icon.png",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    // next-themes sets the theme class on <html> before hydration
    <html lang="en" suppressHydrationWarning>
      <body className={`${cormorant.variable} ${cinzel.variable} ${inter.variable}`}>
        {/* Aurora is the default. Night is a choice in Settings, not taken from the system setting. */}
        <ThemeProvider defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          <AlertsProvider>
            <AppLayout>{children}</AppLayout>
          </AlertsProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  )
}
