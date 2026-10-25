import type { MetadataRoute } from "next"
import { SITE_URL } from "@/lib/site"
import { YieldAPI } from "@/lib/api/yield-api"
import { routePath } from "@/lib/route-copy"

// The landing page, the routes and the docs. Portfolio and Settings are about one wallet or device, so they stay out.
// Each live route has its own page. If the API is down, the sitemap lists the fixed pages alone.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const routes = await YieldAPI.getRoutes(undefined, { revalidate: 3600, signal: AbortSignal.timeout(10_000) }).catch(() => [])
  // Rates change every minute, so the pages count as changed at every deploy
  return [
    { url: `${SITE_URL}/`, lastModified: new Date(), changeFrequency: "hourly", priority: 1 },
    { url: `${SITE_URL}/app`, lastModified: new Date(), changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE_URL}/routes`, lastModified: new Date(), changeFrequency: "hourly", priority: 0.8 },
    ...routes.map((route) => ({
      url: `${SITE_URL}${routePath(route)}`,
      lastModified: new Date(),
      changeFrequency: "hourly" as const,
      priority: 0.7,
    })),
    { url: `${SITE_URL}/docs`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.6 },
  ]
}
