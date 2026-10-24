import { YieldPanel } from "@/components/app/yield-panel"
import { YieldAPI, type YieldRoute } from "@/lib/api/yield-api"

// Rates render on the server too, so search engines and link previews see live routes instead of a loading state.
// The page regenerates at most once a minute, and the browser refreshes the rates as soon as it loads.
export const revalidate = 60

async function serverRoutes(): Promise<YieldRoute[] | null> {
  try {
    return await YieldAPI.getRoutes(undefined, { revalidate: 60, signal: AbortSignal.timeout(10_000) })
  } catch {
    // The API is asleep or down: the browser loads the rates as before
    return null
  }
}

// The app is the tool alone: the rate board and the deposit. The hero, how it works and the FAQ belong to the landing page.
export default async function Home() {
  return (
    <div id="top">
      <h1 className="sr-only">Compare Solana yields. Deposit from your own wallet.</h1>
      <YieldPanel initialRoutes={await serverRoutes()} />
    </div>
  )
}
