import type { MetadataRoute } from "next"
import { SITE_URL } from "@/lib/site"

// The routes and the docs. Portfolio and Settings are about one wallet or device, so they stay out.
export default function sitemap(): MetadataRoute.Sitemap {
  // Rates change every minute, so the page counts as changed at every deploy
  return [
    { url: `${SITE_URL}/`, lastModified: new Date(), changeFrequency: "hourly", priority: 1 },
    { url: `${SITE_URL}/docs`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.6 },
  ]
}
