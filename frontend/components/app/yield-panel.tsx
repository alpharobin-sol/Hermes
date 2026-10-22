import { useState, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils";
import { RiskMeter } from "./RiskMeter";
import { TokenSelector, type Token } from "./TokenSelector";
import { YieldRoutes } from "./yield-routes";
import { SOL_FEE_RESERVE, useTokenBalances } from "@/hooks/use-token-balances";
import { IS_DEVNET } from "@/lib/network";

// Balances are filled in from the connected wallet
const baseTokens: Token[] = [
  { symbol: "SOL", name: "Solana", icon: "/brand-logos/solanaLogoMark.svg", balance: 0 },
  { symbol: "USDC", name: "USD Coin", icon: "/brand-logos/usdcLogoMark.svg", balance: 0 },
  { symbol: "USDT", name: "Tether", icon: "/brand-logos/tetherLogoMark.svg", balance: 0 },
  // { symbol: "jitoSOL", name: "Jito Staked SOL", icon: "/brand-logos/usdcLogoMark.svg", balance: 5.2 },
  // { symbol: "mSOL", name: "Marinade SOL", icon: "/brand-logos/usdcLogoMark.svg", balance: 3.1 },
];

type RiskProfile = "low" | "moderate" | "high";

function formatNumber(num: number): string {
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function YieldPanel() {
  const { balances, refresh: refreshBalances } = useTokenBalances();
  const tokens = useMemo(
    () => baseTokens.map((token) => ({ ...token, balance: balances[token.symbol] ?? 0 })),
    [balances]
  );
  const [selectedSymbol, setSelectedSymbol] = useState(baseTokens[0].symbol);
  const selectedToken = tokens.find((token) => token.symbol === selectedSymbol) ?? tokens[0];
  const [amount, setAmount] = useState("");
  const [riskProfile, setRiskProfile] = useState<RiskProfile>("moderate");
  const [showRoutes, setShowRoutes] = useState(false);

  const numericAmount = useMemo(() => {
    const parsed = Number.parseFloat(amount.replace(",", ""));
    return isNaN(parsed) ? 0 : parsed;
  }, [amount]);

  useEffect(() => {
    if (numericAmount > 0) {
      setShowRoutes(false);
      const timer = setTimeout(() => {
        setShowRoutes(true);
      }, 400);
      return () => clearTimeout(timer);
    } else {
      setShowRoutes(false);
    }
  }, [numericAmount, selectedToken.symbol]);

  const quickAmounts = ["25%", "50%", "75%", "MAX"];

  // Keep some SOL back so the deposit can pay its own fees
  const spendableBalance =
    selectedToken.symbol === "SOL"
      ? Math.max(0, selectedToken.balance - SOL_FEE_RESERVE)
      : selectedToken.balance;

  const handleQuickAmount = (pct: string) => {
    const balance = spendableBalance;
    if (pct === "MAX") {
      setAmount(balance.toFixed(2));
      return;
    }
    const percentage = Number.parseInt(pct.replace("%", ""));
    setAmount(((balance * percentage) / 100).toFixed(2));
  };

  const getActiveQuickAmount = (pct: string) => {
    const balance = spendableBalance;
    if (pct === "MAX") return numericAmount === balance;
    const percentage = Number.parseInt(pct.replace("%", ""));
    return numericAmount === +((balance * percentage) / 100).toFixed(2);
  };

  return (
    <div className="flex flex-col gap-4 mx-auto max-w-2xl">
      {/* Main Panel */}
      <div className="card-base overflow-hidden">
        {/* Header */}
        <div className="card-header">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-heading mb-1">Yield Explorer</h3>
              <div className="flex items-center gap-2">
                <div className="w-1 h-4 bg-primary" />
                <h2 className="text-caption">Discover Best Yields</h2>
              </div>
            </div>

             <div className="flex flex-col items-end justify-end gap-2">
              <button
                onClick={() => handleQuickAmount("MAX")}
                className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
              >
                <span className="text-caption">Balance:</span>
                <span className="text-mono text-xs text-foreground">
                  {formatNumber(selectedToken.balance)}
                </span>
                <span className="text-caption max-w-[60px] truncate">
                  {selectedToken.symbol}
                </span>
              </button>
            </div> 
          </div> 
        </div>

        {IS_DEVNET && (
          <div className="border-b border-warning/20 bg-warning/5 px-4 py-2 font-mono text-[11px] leading-relaxed text-warning">
            DEVNET · Deposits use test SOL (get some at faucet.solana.com). APYs shown are mainnet rates for reference.
          </div>
        )}

        {/* Input Section */}
        <div className="card-body">
          
          {/* Quick Amount Row */}
          <div className="flex items-center justify-between gap-2 mb-3">
            <span className="text-label">Deposit</span>
            <div className="flex items-center gap-1">
              {quickAmounts.map((pct, index) => {
                const isActive = getActiveQuickAmount(pct);
                return (
                  <button
                    key={pct}
                    onClick={() => handleQuickAmount(pct)}
                    className={cn(
                      "quick-btn",
                      isActive && "quick-btn-active",
                      index === 0 && "rounded-l-sm",
                      index === quickAmounts.length - 1 && "rounded-r-sm"
                    )}
                  >
                    {pct}
                  </button>
                );
              })}
            </div>
            
          </div>

          {/* Input + Token Selector */}
          <div className="flex items-center gap-0">
          <div className="input-wrapper flex items-center gap-2 rounded-l-xl border-primary/5 min-h-[48px]">
            <input
              type="text"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="input-lg flex-1 min-w-0"
            />
            
              
             <RiskMeter value={riskProfile} onChange={setRiskProfile} />
              
            
            </div>
            <TokenSelector
              tokens={tokens}
              selectedToken={selectedToken}
              onSelect={(token) => setSelectedSymbol(token.symbol)}

            />
          </div>
        </div>
      </div>

      {/* Yield Routes */}
      {showRoutes && numericAmount > 0 && (
        <YieldRoutes
          token={selectedToken}
          amount={numericAmount}
          riskProfile={riskProfile}
          onDeposited={refreshBalances}
        />
      )}
    </div>
  );
}
