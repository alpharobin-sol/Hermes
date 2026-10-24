import { YieldPanel } from "@/components/app/yield-panel"

// The app is the tool alone: the rate board and the deposit. The hero, how it works and the FAQ belong to the landing page.
export default function Home() {
  return (
    <div id="top">
      <h1 className="sr-only">Compare Solana yields. Deposit from your own wallet.</h1>
      <YieldPanel />
    </div>
  )
}
