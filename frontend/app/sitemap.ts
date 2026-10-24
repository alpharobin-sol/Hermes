import type { MetadataRoute } from "next"
import { SITE_URL } from "@/lib/site"

// Hermes is one page
export default function sitemap(): MetadataRoute.Sitemap {
  // Rates change every minute, so the page counts as changed at every deploy
  return [{ url: `${SITE_URL}/`, lastModified: new Date(), changeFrequency: "hourly", priority: 1 }]
}
