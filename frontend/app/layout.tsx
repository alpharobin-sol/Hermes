import type React from "react"
import type { Metadata } from "next"
import { Cormorant_Garamond, Geist_Mono, Outfit } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"
import "./styles/wallet-adapter.css"
import { ThemeProvider } from "@/components/theme-provider"
import AppLayout from "@/components/app/layout/app-layout"



const cormorantGaramond = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700"],
})

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-body",
})

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: "Hermes - Yield Aggregator for Solana",
  description: "Compare live Solana yields across liquid staking and lending, then deposit from your own wallet.",
  icons: {
    icon: [
      {
        url: "/brand/hermes-icon-light-32x32.png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/brand/hermes-icon-dark-32x32.png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/brand/hermes-icon.svg",
        type: "image/svg+xml",
      },
    ],
    apple: "/brand/hermes-apple-icon.png",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${cormorantGaramond.variable} ${outfit.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider>
          <AppLayout>{children}</AppLayout></ThemeProvider>
        <Analytics />
      </body>
    </html>
  )
}
