"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { AlertCircle, ArrowRight, ChevronDown, ExternalLink, Shield, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Token } from "./TokenSelector";
import { YieldAPI, type RiskTier, type SafetyScore, type YieldRoute } from "@/lib/api/yield-api";
import { formatNumber, formatPercent, formatUSD } from "@/lib/helpers/formatters";
import { IS_DEVNET } from "@/lib/network";
import { useLoading } from "./layout/loading-context";
import { DepositDialog } from "./deposit-dialog";

// Why the connected wallet can't cover the amount: more than it holds, or into the SOL kept for fees
export type BalanceIssue = "insufficient" | "fee-reserve" | null;

interface YieldRoutesProps {
  token: Token;
  amount: number;
  riskProfile: RiskTier;
  balanceIssue: BalanceIssue;
  onDeposited?: () => void;
}

type SortBy = "safety" | "apy";

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "safety", label: "Safety" },
  { value: "apy", label: "APY" },
];

const CATEGORY_LABELS: Record<YieldRoute["category"], string> = {
  "liquid-staking": "Liquid staking",
  lending: "Lending",
};

// Routes at or below the chosen risk level
function withinRisk(route: YieldRoute, profile: RiskTier): boolean {
  const order: RiskTier[] = ["low", "moderate", "high"];
  return order.indexOf(route.risk) <= order.indexOf(profile);
}

// Unscored routes sort last
const scoreOf = (route: YieldRoute) => route.safety?.score ?? -1;

function compareRoutes(sortBy: SortBy) {
  return (a: YieldRoute, b: YieldRoute) =>
    sortBy === "safety" ? scoreOf(b) - scoreOf(a) || b.apy - a.apy : b.apy - a.apy;
}

export function YieldRoutes({ token, amount, riskProfile, balanceIssue, onDeposited }: YieldRoutesProps) {
  const [routes, setRoutes] = useState<YieldRoute[]>([]);
  const [isLoading, setIsLoadingRoutes] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [depositRoute, setDepositRoute] = useState<YieldRoute | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("safety");
  const [openScore, setOpenScore] = useState<string | null>(null);
  const { setIsLoading } = useLoading();

  const { publicKey } = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();

  // Rates depend on the token only. Amount and risk are applied here.
  useEffect(() => {
    const controller = new AbortController();
    setIsLoadingRoutes(true);
    setIsLoading(true);
    setError(null);

    YieldAPI.getRoutes(token.symbol, { signal: controller.signal })
      .then((data) => setRoutes(data))
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setRoutes([]);
        setError(err instanceof Error ? err.message : "Failed to load yields");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoadingRoutes(false);
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [token.symbol, setIsLoading]);

  const handleDeposit = (route: YieldRoute) => {
    if (!publicKey) {
      setWalletModalVisible(true);
      return;
    }
    setDepositRoute(route);
  };

  if (isLoading) {
    return (
      <div className="relative p-1">
        <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-primary" />
        <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-primary" />
        <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-primary" />
        <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-primary" />

        <div className="card-base flex flex-col items-center justify-center gap-3 p-6 sm:p-8">
          <div className="text-center">
            <p className="text-heading">Finding routes...</p>
            <p className="text-caption mt-1">Checking live {token.symbol} rates</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="relative p-1">
        <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-destructive" />
        <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-destructive" />
        <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-destructive" />
        <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-destructive" />

        <div className="border border-destructive/10 bg-destructive/3 backdrop-blur-sm p-4 sm:p-8 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-destructive" />
          <div>
            <p className="font-semibold text-destructive">Failed to load yields</p>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  const visibleRoutes = routes.filter((route) => withinRisk(route, riskProfile)).sort(compareRoutes(sortBy));
  const sources = [...new Set(routes.map((route) => route.source))].join(", ");
  const bestApy = visibleRoutes.reduce<YieldRoute | null>((best, route) => (!best || route.apy > best.apy ? route : best), null);
  const topScore = visibleRoutes.reduce<YieldRoute | null>(
    (top, route) => (route.safety && (!top || scoreOf(route) > scoreOf(top)) ? route : top),
    null
  );

  if (visibleRoutes.length === 0) {
    return (
      <div className="card-base p-8 text-center">
        <p className="text-muted-foreground">
          {routes.length === 0
            ? `No ${token.symbol} routes in Hermes right now.`
            : `No ${token.symbol} routes at ${riskProfile} risk. Raise the risk level to see ${routes.length} more.`}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 bg-primary" />
          <span className="text-label">
            {visibleRoutes.length} {visibleRoutes.length === 1 ? "route" : "routes"}
            {visibleRoutes.length < routes.length && ` · ${routes.length - visibleRoutes.length} hidden by risk`}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] uppercase text-muted-foreground">Sort</span>
          <div className="flex items-center border border-border/50">
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setSortBy(option.value)}
                aria-pressed={sortBy === option.value}
                className={cn(
                  "px-2 py-0.5 font-mono text-[10px] uppercase transition-colors",
                  sortBy === option.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Routes */}
      <div className="space-y-2">
        {visibleRoutes.map((route, index) => {
          const yearly = amount * route.apy;
          const canDeposit = route.deposit !== null;
          const badges = [
            route === topScore && "Top Safety Score",
            route === bestApy && "Best APY",
          ].filter((badge): badge is string => Boolean(badge));
          const scoreOpen = openScore === route.id;

          return (
            <div
              key={route.id}
              className={cn("card-interactive group", index === 0 && "card-featured")}
            >
              {badges.length > 0 && (
                <div className="absolute -top-2 left-3 flex items-center gap-1">
                  {badges.map((badge) => (
                    <span key={badge} className="badge-primary">
                      {badge}
                    </span>
                  ))}
                </div>
              )}

              {/* Hover corners */}
              <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-transparent group-hover:border-primary/60 transition-colors" />
              <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-transparent group-hover:border-primary/60 transition-colors" />

              {/* Top row */}
              <div className="flex items-start justify-between gap-4 p-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 shrink-0 bg-secondary border border-border/50 flex items-center justify-center">
                    <span className="text-mono font-bold">{route.name.charAt(0)}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="text-heading truncate">{route.name}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {CATEGORY_LABELS[route.category]}
                      {route.receipt && ` · get ${route.receipt}`}
                    </div>
                    <SafetyBadge
                      safety={route.safety ?? null}
                      risk={route.risk}
                      open={scoreOpen}
                      onToggle={() => setOpenScore(scoreOpen ? null : route.id)}
                    />
                  </div>
                </div>

                <div className="flex items-start gap-4 sm:gap-6">
                  {/* Estimated returns at today's APY, in the deposit token */}
                  <div className="hidden min-[420px]:flex items-center gap-4 sm:gap-6 text-left">
                    <div className="stat-group">
                      <span className="stat-label">Monthly</span>
                      <span className="stat-value">
                        {formatNumber(yearly / 12)} {token.symbol}
                      </span>
                    </div>
                    <div className="stat-group">
                      <span className="stat-label">Yearly</span>
                      <span className="stat-value text-primary">
                        {formatNumber(yearly)} {token.symbol}
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="flex items-center gap-1 font-mono text-xl font-bold text-primary">
                      <TrendingUp className="w-4 h-4" />
                      {formatPercent(route.apy * 100)}
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground uppercase">APY</div>
                  </div>
                </div>
              </div>

              {/* Bottom row */}
              <div className="flex flex-row items-center justify-between gap-3 border-t border-border/30 p-3 pt-2">
                <div className="flex items-center gap-4 sm:gap-5 text-left">
                  <div className="flex flex-col">
                    <span className="font-mono text-[10px] uppercase text-muted-foreground">TVL</span>
                    <span className="font-mono text-xs text-foreground">{formatUSD(route.tvl)}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="font-mono text-[10px] uppercase text-muted-foreground">Source</span>
                    <span className="font-mono text-xs text-foreground">{route.source}</span>
                  </div>
                  {/* Lending: how much of the supply is lent out. Near 100%, withdrawals may have to wait. */}
                  {typeof route.utilization === "number" && (
                    <div className="flex flex-col" title="Share of the reserve that is borrowed">
                      <span className="font-mono text-[10px] uppercase text-muted-foreground">Borrowed</span>
                      <span
                        className={cn(
                          "font-mono text-xs",
                          route.utilization >= 0.95 ? "text-warning" : "text-foreground"
                        )}
                      >
                        {Math.min(100, Math.round(route.utilization * 100))}%
                      </span>
                    </div>
                  )}
                </div>

                <RouteAction
                  route={route}
                  highlight={index === 0 && canDeposit}
                  balanceIssue={balanceIssue}
                  onDeposit={() => handleDeposit(route)}
                />
              </div>

              {scoreOpen && route.safety && <SafetyBreakdown safety={route.safety} />}
            </div>
          );
        })}
      </div>

      <p className="px-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
        Rates from {sources}, refreshed every few minutes. Returns assume today&apos;s APY holds and are not guaranteed.
        The Safety Score adds four parts from live data, 25 points each: size, track record, 30-day outflows and exit.
        Tap a score to see why. It does not cover smart contract bugs or depegs. Risk level follows the score: low from 80,
        moderate from 60.
      </p>

      {depositRoute && (
        <DepositDialog
          open={!!depositRoute}
          onOpenChange={(open) => !open && setDepositRoute(null)}
          route={depositRoute}
          amount={amount}
          onDeposited={onDeposited}
        />
      )}
    </div>
  );
}

const SCORE_STYLES: Record<RiskTier, string> = {
  low: "badge-success",
  moderate: "badge-warning",
  high: "badge-destructive",
};

// The route's Safety Score. Its color is the risk level, which follows the score.
function SafetyBadge({
  safety,
  risk,
  open,
  onToggle,
}: {
  safety: SafetyScore | null;
  risk: RiskTier;
  open: boolean;
  onToggle: () => void;
}) {
  if (!safety) {
    return (
      <span
        className="badge-base mt-1 bg-muted/30 text-muted-foreground"
        title="Some of the data behind the score is unavailable right now. Risk level comes from TVL."
      >
        <Shield className="w-3 h-3" />
        Not scored
      </span>
    );
  }

  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      title="Safety Score: size, track record, 30-day outflows and exit"
      className={cn(SCORE_STYLES[risk], "mt-1 hover:opacity-80 transition-opacity")}
    >
      <Shield className="w-3 h-3" />
      Safety {safety.score}
      <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180")} />
    </button>
  );
}

// What each part of the score measured, with its points and source
function SafetyBreakdown({ safety }: { safety: SafetyScore }) {
  return (
    <div className="border-t border-border/30 px-3 py-3 space-y-3">
      {safety.parts.map((part) => (
        <div key={part.key}>
          <div className="flex items-center justify-between font-mono text-[10px] uppercase">
            <span className="text-muted-foreground">{part.label}</span>
            <span className="text-foreground">
              {part.points}/{part.max}
            </span>
          </div>
          <div className="mt-1 h-1 bg-muted/30">
            <div className="h-1 bg-primary" style={{ width: `${(part.points / part.max) * 100}%` }} />
          </div>
          <p className="mt-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
            {part.detail} Source: {part.source}.
          </p>
        </div>
      ))}
      <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
        Not covered: smart contract bugs and depegs.
      </p>
    </div>
  );
}

function RouteAction({
  route,
  highlight,
  balanceIssue,
  onDeposit,
}: {
  route: YieldRoute;
  highlight: boolean;
  balanceIssue: BalanceIssue;
  onDeposit: () => void;
}) {
  const base =
    "flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs font-medium transition-all whitespace-nowrap";
  const outline = "border border-border/50 text-foreground hover:border-primary/50 hover:text-primary";

  if (route.deposit && balanceIssue) {
    return (
      <button disabled className={cn(base, "border border-destructive/30 text-destructive cursor-not-allowed")}>
        Insufficient balance
      </button>
    );
  }

  if (route.deposit) {
    return (
      <button
        onClick={onDeposit}
        className={cn(base, highlight ? "bg-primary text-primary-foreground hover:bg-primary/90" : outline)}
      >
        Deposit
        {route.deposit === "beta" && !IS_DEVNET && <span className="text-[9px] uppercase opacity-70">Beta</span>}
        <ArrowRight className="w-3 h-3" />
      </button>
    );
  }

  // Protocol apps run on mainnet, so devnet mode has nothing to link to
  if (IS_DEVNET) {
    return (
      <button disabled title="This route has no devnet deployment" className={cn(base, outline, "opacity-50 cursor-not-allowed")}>
        Mainnet only
      </button>
    );
  }

  return (
    <a href={route.website} target="_blank" rel="noopener noreferrer" title={`Opens ${route.name} in a new tab`} className={cn(base, outline)}>
      Open app
      <ExternalLink className="w-3 h-3" />
    </a>
  );
}
