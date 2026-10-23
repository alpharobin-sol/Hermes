"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import { useWalletModal } from "@solana/wallet-adapter-react-ui"

import { YieldAPI, type YieldRoute } from "@/lib/api/yield-api"
import { SOL_FEE_RESERVE, useTokenBalances } from "@/hooks/use-token-balances"
import { useLoading } from "./layout/loading-context"
import { RateBoard } from "./rate-board"
import { DepositPanel, type BalanceIssue } from "./deposit-panel"
import { DepositDialog } from "./deposit-dialog"
import { MobileDeposit } from "./mobile-deposit"
import { BASE_TOKENS } from "./tokens"
import { compareRoutes, isTopRated, type SortBy, type View } from "./safety"

const RATE_REFRESH_MS = 60 * 1000

// "A", "A and B", "A, B and C"
function listOf(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

// Round down so a quick amount never exceeds what the wallet can spend
function floorTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.floor(value * factor) / factor
}

// The oldest update among the routes shown, so the label never claims fresher rates than it has
function updatedLabel(routes: YieldRoute[]): string | null {
  const times = routes.map((route) => Date.parse(route.updatedAt)).filter((t) => !isNaN(t))
  if (times.length === 0) return null
  const oldest = new Date(Math.min(...times))
  return `${oldest.toISOString().slice(11, 16)} UTC`
}

export function YieldPanel() {
  const { balances, isConnected, refresh: refreshBalances } = useTokenBalances()
  const { publicKey } = useWallet()
  const { setVisible: setWalletModalVisible } = useWalletModal()
  const { setIsLoading } = useLoading()

  const [routes, setRoutes] = useState<YieldRoute[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [selectedSymbol, setSelectedSymbol] = useState(BASE_TOKENS[0].symbol)
  const [amount, setAmount] = useState("")
  // Top rated is the first screen. All routes is one tap away.
  const [view, setView] = useState<View>("top-rated")
  // Lists show the top three routes until "Show all"
  const [expanded, setExpanded] = useState(false)
  // Routes lead with the Safety Score. APY is one tap away.
  const [sortBy, setSortBy] = useState<SortBy>("safety")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const mobileCardRef = useRef<HTMLElement>(null)

  // Every route, once. Rates show before an amount is typed. Amount and view are applied here.
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setIsLoading(true)
    setError(null)

    YieldAPI.getRoutes(undefined, { signal: controller.signal })
      .then((data) => setRoutes(data))
      .catch((err) => {
        if (err?.name === "AbortError") return
        setRoutes([])
        setError(err instanceof Error ? err.message : "Failed to load yields")
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
          setIsLoading(false)
        }
      })

    return () => controller.abort()
  }, [reloadKey, setIsLoading])

  // Rates refresh every minute, like a live swap quote, without the loading state. A failed refresh keeps the
  // last rates. Paused while the deposit dialog is open, so the route under review never changes or drops out.
  const reviewOpenRef = useRef(false)
  useEffect(() => {
    reviewOpenRef.current = reviewOpen
  }, [reviewOpen])
  useEffect(() => {
    const timer = setInterval(() => {
      if (reviewOpenRef.current || document.hidden) return
      YieldAPI.getRoutes()
        .then((data) => {
          setRoutes(data)
          setError(null)
        })
        .catch(() => {})
    }, RATE_REFRESH_MS)
    return () => clearInterval(timer)
  }, [])

  // The token picker lists only tokens with at least one route. SOL shows while rates load.
  const tokens = useMemo(() => {
    const withRoutes = BASE_TOKENS.filter((token) => routes.some((route) => route.token === token.symbol))
    const list = withRoutes.length > 0 ? withRoutes : [BASE_TOKENS[0]]
    return list.map((token) => ({
      ...token,
      balance: balances[token.symbol] ?? 0,
      count: routes.filter((route) => route.token === token.symbol).length,
    }))
  }, [balances, routes])
  const selectedToken = tokens.find((token) => token.symbol === selectedSymbol) ?? tokens[0]

  const forToken = useMemo(
    () => routes.filter((route) => route.token === selectedToken.symbol).sort(compareRoutes(sortBy)),
    [routes, selectedToken.symbol, sortBy]
  )
  const visibleRoutes = view === "all" ? forToken : forToken.filter(isTopRated)
  const selectedRoute = visibleRoutes.find((route) => route.id === selectedId) ?? visibleRoutes[0] ?? null
  const sources = listOf([...new Set(forToken.map((route) => route.source))])

  const numericAmount = useMemo(() => {
    const parsed = Number.parseFloat(amount.replace(/,/g, ""))
    return isNaN(parsed) || parsed < 0 ? 0 : parsed
  }, [amount])

  // Keep some SOL back so the deposit can pay its own fees
  const spendableBalance =
    selectedToken.symbol === "SOL" ? Math.max(0, selectedToken.balance - SOL_FEE_RESERVE) : selectedToken.balance

  // Only judge the amount once the wallet's balance for this token has loaded
  const balanceKnown = isConnected && balances[selectedToken.symbol] !== undefined
  const balanceIssue: BalanceIssue =
    !balanceKnown || numericAmount <= 0
      ? null
      : numericAmount > selectedToken.balance
        ? "insufficient"
        : numericAmount > spendableBalance
          ? "fee-reserve"
          : null

  const quickAmount = (pct: string) => {
    const percentage = pct === "Max" ? 100 : Number.parseInt(pct.replace("%", ""))
    return floorTo((spendableBalance * percentage) / 100, 4)
  }

  const handleToken = (symbol: string) => {
    if (symbol === selectedToken.symbol) return
    // An amount typed for one token means nothing for another
    setSelectedSymbol(symbol)
    setSelectedId(null)
    setExpanded(false)
    setAmount("")
  }

  // On phones the list sits under the deposit card, so picking a route brings the card back into view
  const handleSelect = (id: string) => {
    setSelectedId(id)
    if (window.matchMedia("(max-width: 1023px)").matches) {
      mobileCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }

  const handleReview = () => {
    if (!publicKey) {
      setWalletModalVisible(true)
      return
    }
    setReviewOpen(true)
  }

  return (
    <section
      id="rates"
      aria-label="Rates"
      className="mx-auto flex max-w-[1200px] scroll-mt-24 flex-wrap items-start gap-5 px-4 pb-16 pt-3 md:gap-6 md:px-8 md:pb-24 md:pt-16"
    >
      <MobileDeposit
        ref={mobileCardRef}
        tokens={tokens}
        token={selectedToken}
        onToken={handleToken}
        amount={amount}
        onAmount={setAmount}
        numericAmount={numericAmount}
        isConnected={isConnected}
        balanceKnown={balanceKnown}
        spendable={spendableBalance}
        balanceIssue={balanceIssue}
        onQuickAmount={(pct) => setAmount(String(quickAmount(pct)))}
        isQuickActive={(pct) => balanceKnown && numericAmount > 0 && numericAmount === quickAmount(pct)}
        routes={visibleRoutes}
        totalForToken={forToken.length}
        view={view}
        onView={setView}
        expanded={expanded}
        onExpandedChange={setExpanded}
        sortBy={sortBy}
        onSort={setSortBy}
        route={loading || error ? null : selectedRoute}
        onSelectRoute={setSelectedId}
        ratesStatus={loading ? "loading" : error ? "error" : "ready"}
        updatedLabel={updatedLabel(forToken)}
        onConnect={() => setWalletModalVisible(true)}
        onReview={handleReview}
      />

      <RateBoard
        tokens={tokens.map(({ symbol, icon, count }) => ({ symbol, icon, count }))}
        token={selectedToken.symbol}
        onToken={handleToken}
        view={view}
        onView={setView}
        expanded={expanded}
        onExpandedChange={setExpanded}
        sortBy={sortBy}
        onSort={setSortBy}
        routes={visibleRoutes}
        totalForToken={forToken.length}
        selectedId={selectedRoute?.id ?? null}
        onSelect={handleSelect}
        amount={numericAmount}
        loading={loading}
        error={error}
        onRetry={() => setReloadKey((key) => key + 1)}
        sources={sources}
        updatedLabel={updatedLabel(forToken)}
        // On phones and tablets the card lists every route once an amount is typed, so this list steps aside
        className={numericAmount > 0 && !loading && !error ? "max-lg:hidden" : undefined}
      />

      <DepositPanel
        token={selectedToken}
        amount={amount}
        onAmount={setAmount}
        numericAmount={numericAmount}
        isConnected={isConnected}
        balanceKnown={balanceKnown}
        spendable={spendableBalance}
        balanceIssue={balanceIssue}
        onQuickAmount={(pct) => setAmount(String(quickAmount(pct)))}
        isQuickActive={(pct) => balanceKnown && numericAmount > 0 && numericAmount === quickAmount(pct)}
        route={loading || error ? null : selectedRoute}
        ratesStatus={loading ? "loading" : error ? "error" : "ready"}
        onConnect={() => setWalletModalVisible(true)}
        onReview={handleReview}
        className="max-lg:hidden"
      />

      {reviewOpen && selectedRoute && (
        <DepositDialog
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          route={selectedRoute}
          amount={numericAmount}
          onDeposited={refreshBalances}
        />
      )}
    </section>
  )
}
