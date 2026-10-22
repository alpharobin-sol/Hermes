"use client";

import { cn } from "@/lib/utils"
import type { Token } from "./TokenSelector"
import { TrendingUp, Shield, Users, Clock, Zap, ExternalLink, ArrowRight } from "lucide-react"

import {
  CheckCircle2,
  ShieldCheck,
  AlertCircle,
  DollarSign,
  User,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { YieldAPI, type YieldItem, type BestRouteResponse } from "@/lib/api/yield-api";

import { useLoading } from "./layout/loading-context";
import { formatFees, formatNumber, formatPercent, formatUSD } from "@/lib/helpers/formatters";
import { useEffect, useRef, useState } from "react";
import { calculateReturns } from "@/lib/helpers/calculators";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { DepositAPI } from "@/lib/api/deposit-api";
import { getProtocolAppUrl } from "@/lib/protocol-links";
import { IS_DEVNET } from "@/lib/network";
import { DepositDialog } from "./deposit-dialog";



interface YieldRoutesProps {
  token: Token;
  amount: number;
  riskProfile: "low" | "moderate" | "high";
  onDeposited?: () => void;
}


export function YieldRoutes({
  token,
  amount,
  riskProfile,
  onDeposited,
}: YieldRoutesProps) {
  const [bestResponse, setBestResponse] = useState<BestRouteResponse | null>(null);

  const [allYields, setAllYields] = useState<YieldItem[]>([]);
  const [isLoadingBest, setIsLoadingBest] = useState(true);
  const [isLoadingAll, setIsLoadingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setIsLoading } = useLoading();
  const usedFallbackRef = useRef(false);

  const { publicKey } = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const [depositableProtocols, setDepositableProtocols] = useState<Set<string>>(new Set());
  const [depositRoute, setDepositRoute] = useState<YieldItem | null>(null);

  // Which routes Hermes can execute in-app for this token
  useEffect(() => {
    const controller = new AbortController();
    DepositAPI.getSupportedProtocols(token.symbol, { signal: controller.signal })
      .then((protocols) => setDepositableProtocols(new Set(protocols)))
      .catch((err) => {
        if (err?.name !== "AbortError") setDepositableProtocols(new Set());
      });
    return () => controller.abort();
  }, [token.symbol]);

  const handleDepositClick = (route: YieldItem) => {
    const protocol = route.protocol.toLowerCase();
    if (depositableProtocols.has(protocol)) {
      if (!publicKey) {
        setWalletModalVisible(true);
        return;
      }
      setDepositRoute(route);
      return;
    }

    // Protocol apps run on mainnet, so there is nothing to link to in devnet mode
    const appUrl = IS_DEVNET ? undefined : getProtocolAppUrl(protocol);
    if (appUrl) window.open(appUrl, "_blank", "noopener,noreferrer");
  };

  // Fetch best route first
  useEffect(() => {
    const controller = new AbortController();
    const connection: any = typeof navigator !== 'undefined' ? (navigator as any).connection : null;
    const isMetered = !!(connection?.saveData) || ["slow-2g", "2g"].includes(connection?.effectiveType);
    const debounceMs = isMetered ? 600 : 400;
    const timer = setTimeout(() => {
      const fetchBest = async () => {
        try {
          setIsLoadingBest(true);
          setIsLoading(true);
          setError(null);
          usedFallbackRef.current = false;

          const best = await YieldAPI.getBestRoute(
            {
              asset: token.symbol,
              amount,
              riskProfile,
            },
            { signal: controller.signal }
          );
          if (!controller.signal.aborted) {
            setBestResponse(best);
          }
        } catch (err: any) {
          if (err?.name === "AbortError") return;

          // /best ranks from the yield collector's database. Fall back to live yields when it is empty.
          try {
            const all = await YieldAPI.getAllYields(
              { asset: token.symbol, amount, limit: 50 },
              { signal: controller.signal }
            );
            if (!controller.signal.aborted && all.length > 0) {
              usedFallbackRef.current = true;
              setAllYields(all.slice(1));
              setBestResponse({ data: { bestRoute: all[0], alternativeRoutes: [] } });
              return;
            }
          } catch (fallbackErr: any) {
            if (fallbackErr?.name === "AbortError") return;
          }

          const message = err instanceof Error ? err.message : "Failed to load best route";
          setError(message);
          console.error(err);
        } finally {
          if (!controller.signal.aborted) {
            setIsLoadingBest(false);
            setIsLoading(false);
          }
        }
      };
      fetchBest();
    }, debounceMs);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [token.symbol, amount, riskProfile, setIsLoading]);

  // Fetch all yields in background
  useEffect(() => {
    if (!bestResponse || usedFallbackRef.current) return;
    const connection: any = typeof navigator !== 'undefined' ? (navigator as any).connection : null;
    const isMetered = !!(connection?.saveData) || ["slow-2g", "2g"].includes(connection?.effectiveType);
    if (isMetered) {
      // Skip background fetching on metered connections to save data
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      const fetchAll = async () => {
        setIsLoadingAll(true);
        try {
          const all = await YieldAPI.getAllYields(
            {
              asset: token.symbol,
              amount,
              limit: 50,
            },
            { signal: controller.signal }
          );
          if (!controller.signal.aborted) {
            setAllYields(all);
          }
        } catch (err: any) {
          if (err?.name !== "AbortError") {
            console.warn("Failed to load additional yields", err);
          }
        } finally {
          if (!controller.signal.aborted) {
            setIsLoadingAll(false);
          }
        }
      };
      fetchAll();
    }, 400);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [bestResponse, token.symbol, amount]);

  // Safe route list
  const bestRoute = bestResponse?.data?.bestRoute;
  // const alternatives = bestResponse?.data?.alternativeRoutes || [];
  const safeAllYields = Array.isArray(allYields) ? allYields : [];

  const displayedRoutes: YieldItem[] = bestRoute
    ? [
      bestRoute,
      // ...alternatives,
      ...safeAllYields.filter(
        (r): r is YieldItem =>
          !!r.protocol && (!bestRoute.protocol || r.protocol !== bestRoute.protocol)
      ),
    ]
    : [];

  const hasRoutes = displayedRoutes.length > 0;


  const filteredRoutes = displayedRoutes.filter((r) => {
    if (riskProfile === "low") return r.risk === "low"
    if (riskProfile === "moderate") return r.risk === "low" || r.risk === "moderate"
    return true
  })


  const getRiskColor = (risk: string) => {
    switch (risk) {
      case "low": return "text-risk-low"
      case "moderate": return "text-risk-moderate"
      case "high": return "text-risk-high"
      default: return "text-muted-foreground"
    }
  }


  const riskLevels = [
    {
      value: "low",
      label: "Low",
      color: "bg-success",
      activeGlow: "shadow-success/30"
    },
    {
      value: "moderate",
      label: "Moderate",
      color: "bg-warning",
      activeGlow: "shadow-warning/30"
    },
    {
      value: "high",
      label: "High",
      color: "bg-destructive",
      activeGlow: "shadow-destructive/30"
    }
  ];


  if (isLoadingBest) {
    if (isLoadingBest) {
      return (
        <div className="relative p-1">
          {/* Corner accents */}
          <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-primary" />
          <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-primary" />
          <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-primary" />
          <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-primary" />

          <div className="card-base flex flex-col items-center justify-center gap-3 p-6 sm:p-8">
            <div className="text-center">
              <p className="text-heading">Finding best routes...</p>
              <p className="text-caption mt-1">
                Scanning {token.symbol} yield opportunities
              </p>
            </div>
          </div>
        </div>
      )
    }
  }

  if (error && !hasRoutes) {
    return (
      <div className="relative p-1">
        <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-destructive" />
        <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-destructive" />
        <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-destructive" />
        <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-destructive" />

        <div className="border border-destructive/10 bg-destructive/3 backdrop-blur-sm p-4 sm:p-8 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-destructive" />
          <div>
            <p className="font-semibold text-destructive text-epic">Failed to load yields</p>
            <p className="text-sm text-muted-foreground ">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!hasRoutes) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card/80 p-8 text-center">
        <p className="text-muted-foreground">No yield routes available for {token.symbol}.</p>
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
            {displayedRoutes.length} Routes Available {isLoadingAll && " • Loading more..."}


            {/* {displayedRoutes.length} route{displayedRoutes.length !== 1 ? "s" : ""} for {amount} {token.symbol}
              {isLoadingAll && " • Loading more..."} */}
          </span>
        </div>

        <span className="font-mono text-[10px] text-muted-foreground">
          {formatNumber(amount)} {token.symbol}
        </span>
      </div>

      {/* Routes */}
      <div className="space-y-2">
        {displayedRoutes.map((route, index) => (
          // <div
          //   key={`${route.protocol}-${index}`}
          //   className={cn(
          //     "relative border border-border/40 bg-card/60 backdrop-blur-sm",
          //     "hover:border-primary/40 hover:bg-card/80 transition-all group",
          //     index === 0 && "border-primary/30 bg-primary/5"
          //   )}
          // >
          //   {/* Best badge */}
          //   {index === 0 && (
          //     <div className="absolute -top-px -right-px">
          //       <div className="bg-primary px-2 py-0.5 font-mono text-[9px] text-primary-foreground uppercase tracking-wider">
          //         Best
          //       </div>
          //     </div>
          //   )}


          <div
            key={`${route.protocol}-${index}`}
            className={cn(
              "card-interactive group",
              index === 0 && "card-featured animate-pulse-glow"
            )}
          >
            {/* Best badge */}
            {index === 0 && (
              <div className="absolute -top-2 left-3 badge-primary">
                Best APY
              </div>
            )}

            {/* Hover corners */}
            <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-transparent group-hover:border-primary/60 transition-colors" />
            <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-transparent group-hover:border-primary/60 transition-colors" />

            {/* Main content */}
            <div className="">
              {/* Top row */}
              <div className="flex items-start justify-between gap-4 p-3">
                {/* Protocol info */}
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-secondary border border-border/50 flex items-center justify-center">
                    <span className="text-mono font-bold">{route.protocol.charAt(0)}</span>
                  </div>
                  <div>
                    <div className="text-heading capitalize">{route.protocol}</div>

                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="relative flex items-center gap-0.5h-3">
                        {riskLevels.map((level, index) => {
                          const isActive =
                            route.risk === "low"
                              ? level.value === "low"
                              : route.risk === "moderate"
                                ? level.value === "low" || level.value === "moderate"
                                : true

                          const isSelected = route.risk === level.value

                          return (
                            <div
                              key={level.value}
                              className={cn(
                                "relative flex flex-col items-center transition-all duration-200 group",
                                "focus:outline-none"
                              )}
                            >
                              {/* Bar segment */}
                              <div
                                className={cn(
                                  "w-3.5 h-1.5 transition-all duration-300",
                                  isActive ? level.color : "bg-muted/30",
                                  isActive && isSelected && `shadow-sm ${level.activeGlow}`,
                                  index === 0 && "rounded-l-[2px]",
                                  index === riskLevels.length - 1 && "rounded-r-[2px]"
                                )}
                              />

                              {/* Label (only visible when selected) */}
                              <span
                                className={cn(
                                  "absolute -bottom-3.5 font-mono text-[8px] uppercase tracking-wide transition-opacity duration-200",
                                  isSelected ? "opacity-100" : "opacity-0",
                                  isSelected
                                    ? level.value === "low"
                                      ? "text-emerald-500"
                                      : level.value === "moderate"
                                        ? "text-amber-500"
                                        : "text-red-500"
                                    : "text-muted-foreground"
                                )}
                              >
                                {level.label}
                              </span>
                            </div>
                          )
                        })}
                      </div>

                      {/* Audited badge stays the same */}
                      {route.audited && (
                        <span className="flex items-center gap-0.5 text-[10px] text-primary">
                          <Shield className="w-2.5 h-2.5" />
                          <span>Audited</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="text-right flex items-start gap-3 w-full">
                  {/* Returns  */}
                  <div className="flex items-center gap-6 text-left justify-center mx-auto">
                    <div className="stat-group">
                      <span className="stat-label">Monthly</span>
                      {/* Returns are in the deposit token, not USD */}
                      <span className="stat-value">{formatNumber(route.estimatedMonthlyReturn)} {token.symbol}</span>
                    </div>
                    <div className="stat-group">
                      <span className="stat-label">Yearly</span>
                      <span className="stat-value text-primary">{formatNumber(route.estimatedYearlyReturn)} {token.symbol}</span>
                    </div>
                  </div>


                  <div className="text-right ">
                    <div className="flex items-center gap-1 font-mono text-xl font-bold text-primary">
                      <TrendingUp className="w-4 h-4" />
                      {formatPercent(route.apy * 100)}
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground uppercase">APY</div>
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="flex flex-row items-center justify-between gap-3 border-t border-border/30 p-3 pt-2">

                {/* Left: Core Stats */}
                <div className="grid grid-cols-2 sm:flex sm:items-center gap-3 sm:gap-5 text-left">
                  {/* TVL */}
                  <div className="flex flex-col">
                    <span className="font-mono text-[10px] uppercase text-muted-foreground">TVL</span>
                    <span className="font-mono text-xs text-foreground">
                      {formatUSD(route.tvl)}
                    </span>
                  </div>

                  {/* Fees */}
                  <div className="flex flex-col">
                    <span className="font-mono text-[10px] uppercase text-muted-foreground flex items-center gap-1">
                      <Zap className="w-2.5 h-2.5" />
                      Fees
                    </span>
                    <span className="font-mono text-xs text-foreground">
                      {formatFees(route.fees)}
                    </span>
                  </div>
                </div>



                {/* Right: Action Button */}
                <div className="flex justify-end sm:justify-normal">
                  {(() => {
                    const canDeposit = depositableProtocols.has(route.protocol.toLowerCase());
                    const appUrl = IS_DEVNET ? undefined : getProtocolAppUrl(route.protocol);
                    return (
                      <button
                        onClick={() => handleDepositClick(route)}
                        disabled={!canDeposit && !appUrl}
                        title={
                          canDeposit
                            ? undefined
                            : appUrl
                              ? `Opens ${route.protocol} in a new tab`
                              : IS_DEVNET
                                ? "This route has no devnet deployment"
                                : "In-app deposits coming soon"
                        }
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs font-medium transition-all whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed",
                          index === 0 && canDeposit
                            ? "bg-primary text-primary-foreground hover:bg-primary/90"
                            : "border border-border/50 text-foreground hover:border-primary/50 hover:text-primary"
                        )}
                      >
                        {canDeposit ? (
                          <>
                            Deposit
                            <ArrowRight className="w-3 h-3" />
                          </>
                        ) : appUrl ? (
                          <>
                            Open app
                            <ExternalLink className="w-3 h-3" />
                          </>
                        ) : IS_DEVNET ? (
                          "Mainnet only"
                        ) : (
                          "Soon"
                        )}
                      </button>
                    );
                  })()}
                </div>

              </div>

            </div>
          </div>
        ))}
      </div>

      {depositRoute && (
        <DepositDialog
          open={!!depositRoute}
          onOpenChange={(open) => !open && setDepositRoute(null)}
          protocol={depositRoute.protocol}
          apy={depositRoute.apy}
          inputToken={token.symbol}
          amount={amount}
          onDeposited={onDeposited}
        />
      )}
    </div>
  )
}
