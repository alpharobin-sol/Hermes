import type React from "react"
import type { Metadata } from "next"
import { Cinzel, Cormorant_Garamond, Inter } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"
import "./styles/wallet-adapter.css"
import { ThemeProvider } from "@/components/theme-provider"
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

const TITLE = "Hermes: Compare Live Solana Staking and Lending APYs"
const DESCRIPTION =
  "Compare live Solana staking and lending APYs, from JitoSOL and mSOL to Kamino and Jupiter Lend. Safety Score on every route. Deposit from your own wallet."
const X_HANDLE = "@Hermes_agg"

// The share image (opengraph-image.jpg, twitter-image.jpg) sits next to this file, and Next adds its tags.
// Search Console codes come from the environment, so the owner can paste them into Vercel without a code change.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: "/" },
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Hermes",
  category: "finance",
  keywords: [
    "Solana yield",
    "Solana staking APY",
    "liquid staking Solana",
    "JitoSOL APY",
    "mSOL APY",
    "Kamino Lend",
    "Jupiter Lend",
    "USDC yield Solana",
    "Solana yield aggregator",
    "Safety Score",
  ],
  openGraph: { type: "website", url: "/", siteName: "Hermes", title: TITLE, description: DESCRIPTION, locale: "en_US" },
  twitter: { card: "summary_large_image", site: X_HANDLE, creator: X_HANDLE, title: TITLE, description: DESCRIPTION },
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
    other: process.env.BING_SITE_VERIFICATION ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION } : undefined,
  },
  appleWebApp: { capable: true, title: "Hermes", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/brand/favicon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/brand/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: "/brand/apple-icon.png",
  },
}

// Who Hermes is, for search engines: the organization, the site and the app. "Hermes" alone is a crowded name,
// so the alternate names and the X account tie this Hermes to hermesagg.xyz.
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "Hermes",
      alternateName: ["Hermes Agg", "HermesAgg"],
      url: SITE_URL,
      logo: `${SITE_URL}/brand/icon-192.png`,
      sameAs: ["https://x.com/Hermes_agg", "https://t.me/+gYZPiesNgH85YzE8"],
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: "Hermes",
      alternateName: "Hermes Agg",
      url: SITE_URL,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@type": "WebApplication",
      name: "Hermes",
      url: `${SITE_URL}/app`,
      description: DESCRIPTION,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web",
      // Hermes charges no fee today
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
  ],
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
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }} />
        {/* Aurora is the default. Night is a choice in Settings, not taken from the system setting. */}
        <ThemeProvider defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          {/* The landing page (site) and the app (app) each bring their own header and footer */}
          {children}
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  )
}
