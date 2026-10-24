"use client"

import { useEffect, useState } from "react"
import type { PublicKey } from "@solana/web3.js"

import { getFullUrl } from "@/lib/api/yield-api"

// The name the connected wallet goes by, the way Titan shows it: its SNS primary name ("alpharobin") or its
// AllDomains main domain ("fatcat.wen"). Null while loading or when it has neither. The API reads it on chain
// and keeps it for an hour.
export function useWalletName(publicKey: PublicKey | null): string | null {
  const [name, setName] = useState<string | null>(null)
  const address = publicKey?.toBase58()

  useEffect(() => {
    setName(null)
    if (!address) return
    const controller = new AbortController()
    fetch(getFullUrl(`/api/names/${address}`), { signal: controller.signal })
      .then((res) => res.json())
      .then((json) => {
        if (json?.success && typeof json.name === "string") setName(json.name)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [address])

  return name
}
