import type { Metadata } from "next"
import { PortfolioPage } from "@/components/app/portfolio-page"

// About one wallet, so search engines leave it out
export const metadata: Metadata = {
  title: "Portfolio · Hermes",
  alternates: { canonical: "/portfolio" },
  robots: { index: false, follow: true },
}

export default function Portfolio() {
  return <PortfolioPage />
}
