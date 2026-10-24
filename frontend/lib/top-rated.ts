import type { YieldRoute } from "@/lib/api/yield-api"

// Top rated: routes that score 80 or more and whose reserve isn't nearly all borrowed or held back (risk level low).
// The app opens on them, and the landing page shows them. Kept outside client components so the server can use it.
export const TOP_RATED_MIN_SCORE = 80

export function isTopRated(route: YieldRoute): boolean {
  return !!route.safety && route.safety.score >= TOP_RATED_MIN_SCORE && route.risk === "low"
}
