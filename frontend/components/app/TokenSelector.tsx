"use client"

import Image from "next/image"
import { ChevronDown, Check, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { createPortal } from "react-dom"
import { useEffect, useState } from "react"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export interface Token {
  symbol: string
  name: string
  icon: string
  balance: number
}

interface TokenSelectorProps {
  tokens: Token[]
  selectedToken: Token
  onSelect: (token: Token) => void


  // open: boolean
  // onOpenChange: (open: boolean) => void
}

function TokenIcon({ token, size = "md" }: { token: Token; size?: "sm" | "md" | "lg" }) {
  const sizeClasses = {
    sm: "w-5 h-5",
    md: "w-6 h-6",
    lg: "w-8 h-8",
  }
  const px = size === "sm" ? 20 : size === "md" ? 24 : 32
  const [imgError, setImgError] = useState(false)

  return (
    <div className={cn("relative rounded-sm overflow-hidden bg-muted flex items-center justify-center p-1", sizeClasses[size])}>
      {!imgError ? (
        <Image
          src={token.icon}
          alt={token.symbol}
          width={px}
          height={px}
          className="object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-muted-foreground">
          {token.symbol.charAt(0)}
        </span>
      )}
    </div>
  )
}

export function TokenSelector({ tokens, selectedToken, onSelect }: TokenSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  // With one token there is nothing to pick, so the trigger is a plain label
  const canSwitch = tokens.length > 1

  const filteredTokens = tokens.filter(
    (token) =>
      token.symbol.toLowerCase().includes(search.toLowerCase()) ||
      token.name.toLowerCase().includes(search.toLowerCase())
  )



  return (
    <div className="relative">
      {/* Trigger button - blends with card */}
      <button
        onClick={() => canSwitch && setIsOpen(!isOpen)}
        disabled={!canSwitch}
        className={cn(
          "relative flex items-center gap-2 p-[11px] px-3",
          "border border-l-0 bg-secondary/10 text-primary border-primary/5 hover:border-primary/5 transition-all",
          "font-mono text-sm font-medium",
          "text-primary rounded-r-xl transition-all",
          !canSwitch && "cursor-default",
          isOpen && "bg-secondary/50 border-primary/30"
        )}
      >

        {/* Sharp corner accents */}
        {/* <div className="absolute top-0 left-0 w-1 h-1 border-t-2 border-l-2 border-primary/60" />
        <div className="absolute top-0 right-0 w-1 h-1 border-t-2 border-r-2 border-primary/60" />
        <div className="absolute bottom-0 left-0 w-1 h-1 border-b-2 border-l-2 border-primary/60" />
        <div className="absolute bottom-0 right-0 w-1 h-1 border-b-2 border-r-2 border-primary/60" /> */}


        <TokenIcon token={selectedToken} size="md" />
        <span className="text-foreground">{selectedToken.symbol}</span>
        {canSwitch && (
          <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
        )}
      </button>


      <Dialog open={isOpen} onOpenChange={setIsOpen} >
        <DialogContent className="border-border/50 bg-card p-0 gap-0 max-w-sm">

          <DialogHeader className="border-b border-border/50 p-4">
            <DialogTitle className="font-mono text-sm uppercase tracking-wider text-foreground">
              Select Token
            </DialogTitle>
          </DialogHeader>

          <div className="p-4 space-y-4">
            {/* Search */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tokens..."
                className="w-full border border-border/50 bg-secondary py-2.5 pl-10 pr-4 font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
              />
            </div>

            {/* Token list */}
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {filteredTokens.map((token) => (
                <button
                  key={token.symbol}
                  onClick={() => {
                    onSelect(token)
                    setIsOpen(false)
                    setSearch("")
                  }}
                  className={cn(
                    "relative w-full flex items-center gap-3 p-3 transition-all rounded-sm",
                    token.symbol === selectedToken.symbol
                      ? "bg-primary/10 border border-primary/30"
                      : "hover:bg-secondary border border-transparent"
                  )}
                >
                  {token.symbol === selectedToken.symbol && (
                    <>
                      {/* <div className="absolute top-0 left-0 w-1 h-1 border-t-2 border-l-2 border-primary" />
                        <div className="absolute top-0 right-0 w-1 h-1 border-t-2 border-r-2 border-primary" />
                        <div className="absolute bottom-0 left-0 w-1 h-1 border-b-2 border-l-2 border-primary" />
                        <div className="absolute bottom-0 right-0 w-1 h-1 border-b-2 border-r-2 border-primary" /> */}
                    </>
                  )}
                  <TokenIcon token={token} size="lg" />
                  <div className="flex-1 text-left">
                    <div className="font-mono text-sm font-medium text-foreground">{token.symbol}</div>
                    <div className="text-xs text-muted-foreground">{token.name}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm font-medium text-muted-foreground">{token.balance}</div>
                  </div>
                  {token.symbol === selectedToken.symbol && (
                    <Check className="w-4 h-4 text-primary" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
