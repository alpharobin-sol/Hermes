"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import { useWalletModal } from "@solana/wallet-adapter-react-ui"
import { RefreshCw } from "lucide-react"

import { YieldAPI, type YieldRoute } from "@/lib/api/yield-api"
import { SOL_FEE_RESERVE, useTokenBalances } from "@/hooks/use-token-balances"
import { useLoading } from "./layout/loading-context"
import { NetworkPill } from "./layout/network-pill"
import { useLiveQuotes, type Horizon } from "./live-quotes"
import { RateBoard } from "./rate-board"
import { DepositPanel, type BalanceIssue } from "./deposit-panel"
import { DepositDialog } from "./deposit-dialog"
import { MobileDeposit } from "./mobile-deposit"
import { BASE_TOKENS } from "./tokens"
import { compareRoutes, isTopRated, type SortBy, type View } from "./safety"

const RATE_REFRESH_MS = 60 * 1000

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

// initialRoutes: live rates rendered on the server, so the page arrives with routes instead of a loading state
export function YieldPanel({ initialRoutes }: { initialRoutes?: YieldRoute[] | null }) {
  const { balances, isConnected, refresh: refreshBalances } = useTokenBalances()
  const { publicKey } = useWallet()
  const { setVisible: setWalletModalVisible } = useWalletModal()
  const { setIsLoading } = useLoading()

  const [routes, setRoutes] = useState<YieldRoute[]>(initialRoutes ?? [])
  const [loading, setLoading] = useState(!initialRoutes?.length)
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
  // How long the money stays in: what the routes' figures and the best quote count over
  const [horizon, setHorizon] = useState<Horizon>("1y")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const mobileCardRef = useRef<HTMLElement>(null)

  // Rates refresh every minute, like a live swap quote, without the loading state. A failed refresh keeps the
  // last rates.
  const [refreshing, setRefreshing] = useState(false)
  const refreshRates = () => {
    setRefreshing(true)
    return YieldAPI.getRoutes()
      .then((data) => {
        setRoutes(data)
        setError(null)
      })
      .catch(() => {})
      .finally(() => setRefreshing(false))
  }

  // Every route, once. Rates show before an amount is typed. Amount and view are applied here.
  // Rates from the server refresh quietly on load instead of showing the loading state again.
  const quietFirstLoad = useRef(!!initialRoutes?.length)
  useEffect(() => {
    if (quietFirstLoad.current) {
      quietFirstLoad.current = false
      refreshRates()
      return
    }
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

  // The minute refresh pauses while the deposit dialog is open, so the route under review never changes or drops out
  const reviewOpenRef = useRef(false)
  useEffect(() => {
    reviewOpenRef.current = reviewOpen
  }, [reviewOpen])
  useEffect(() => {
    const timer = setInterval(() => {
      if (reviewOpenRef.current || document.hidden) return
      refreshRates()
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

  const numericAmount = useMemo(() => {
    const parsed = Number.parseFloat(amount.replace(/,/g, ""))
    return isNaN(parsed) || parsed < 0 ? 0 : parsed
  }, [amount])

  // Live quotes for the amount on every route in view that Hermes deposits into. Paused while the dialog is open.
  const quoteIds = visibleRoutes
    .filter((route) => route.deposit)
    .map((route) => route.id)
    .sort()
  const live = useLiveQuotes(selectedToken.symbol, numericAmount, quoteIds, reviewOpen)

  // Keep the route's hold-back so the deposit can pay its fees and the accounts it opens
  const solReserve = selectedRoute?.solReserve ?? SOL_FEE_RESERVE
  const spendableBalance =
    selectedToken.symbol === "SOL" ? Math.max(0, selectedToken.balance - solReserve) : selectedToken.balance

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

  // A USDC or USDT deposit pays its fees and any first-deposit rent in SOL. The wallet's SOL when it is short of that.
  const solBalance = balances.SOL
  const solShort =
    isConnected && selectedToken.symbol !== "SOL" && selectedRoute?.solReserve != null && solBalance !== undefined && solBalance < selectedRoute.solReserve
      ? solBalance
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
      className="mx-auto flex max-w-[1200px] scroll-mt-24 flex-wrap items-start gap-5 px-4 pb-6 pt-3 md:gap-6 md:px-8 md:pb-10 lg:pt-10"
    >
      {/* Phones and tablets: a toolbar over the card, like a swap app's. Desktop shows the network in the header. */}
      <div className="-mb-2 flex basis-full items-center justify-between gap-3 lg:hidden">
        <NetworkPill />
        <button
          type="button"
          onClick={() => (error ? setReloadKey((key) => key + 1) : refreshRates())}
          disabled={loading || refreshing}
          aria-label="Refresh rates"
          title={updatedLabel(forToken) ? `Rates updated ${updatedLabel(forToken)}` : "Refresh rates"}
          className="grid size-8 place-items-center rounded-full border border-frame text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-60"
        >
          <RefreshCw className={loading || refreshing ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden="true" />
        </button>
      </div>

      <MobileDeposit
        ref={mobileCardRef}
        live={live}
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
        solShort={solShort}
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
        horizon={horizon}
        onHorizon={setHorizon}
        route={loading || error ? null : selectedRoute}
        onSelectRoute={setSelectedId}
        ratesStatus={loading ? "loading" : error ? "error" : "ready"}
        onConnect={() => setWalletModalVisible(true)}
        onReview={handleReview}
      />

      <RateBoard
        live={live}
        tokens={tokens.map(({ symbol, icon, count }) => ({ symbol, icon, count }))}
        token={selectedToken.symbol}
        onToken={handleToken}
        view={view}
        onView={setView}
        expanded={expanded}
        onExpandedChange={setExpanded}
        sortBy={sortBy}
        onSort={setSortBy}
        horizon={horizon}
        onHorizon={setHorizon}
        routes={visibleRoutes}
        totalForToken={forToken.length}
        selectedId={selectedRoute?.id ?? null}
        onSelect={handleSelect}
        amount={numericAmount}
        loading={loading}
        error={error}
        onRetry={() => setReloadKey((key) => key + 1)}
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
        solShort={solShort}
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
          liveQuote={live.byRoute[selectedRoute.id]}
          onDeposited={refreshBalances}
        />
      )}
    </section>
  )
}
