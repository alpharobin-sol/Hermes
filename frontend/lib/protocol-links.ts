// lib/protocol-links.ts

// Where to send users for routes Hermes cannot execute in-app yet (lending, LPs, perps)
const PROTOCOL_APP_URLS: Record<string, string> = {
  kamino: "https://app.kamino.finance",
  marginfi: "https://app.marginfi.com",
  orca: "https://www.orca.so",
  raydium: "https://raydium.io",
  meteora: "https://app.meteora.ag",
  drift: "https://app.drift.trade",
  zeta: "https://zeta.markets",
  goosefx: "https://app.goosefx.io",
  marinade: "https://marinade.finance",
  jito: "https://www.jito.network/staking",
}

export function getProtocolAppUrl(protocol: string): string | undefined {
  return PROTOCOL_APP_URLS[protocol.toLowerCase()]
}
