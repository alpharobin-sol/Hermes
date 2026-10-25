import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { ImageResponse } from "next/og"

import { YieldAPI, type YieldRoute } from "@/lib/api/yield-api"
import { asJpeg } from "@/lib/og-jpeg"
import { isTopRated } from "@/lib/top-rated"

// The site's share image, for X, Telegram and search: the headline and the top rated routes right now, with their live
// APY and Safety Score, beside the fresco of Hermes with his caduceus (the owner's pick, as on the route pages). Pages
// with their own image (each route) keep theirs. Drawn on the server and kept for a minute. If the API is down the
// board is left out, like the landing page.
export const revalidate = 60
export const alt = "Hermes, your guide to Solana yield: today's top rated routes with their live APY and Safety Score"
export const size = { width: 1200, height: 630 }
export const contentType = "image/jpeg"

const C = {
  plaster: "#f6ead0",
  vellum: "#fcf5e6",
  umber: "#2b140e",
  sienna: "#6b4a36",
  terracotta: "#8e3b1f",
  olive: "#456028",
  ink: "#086668",
  gilt: "#b99467",
  frame: "#cdb185",
  rowLine: "#eadbbe",
}

// The same font and image files as the route pages' images. Each path is written out so the build includes just these.
const files = Promise.all([
  readFile(join(process.cwd(), "assets/fonts/HermesCormorant-SemiBold.ttf")),
  readFile(join(process.cwd(), "assets/fonts/HermesCormorant-MediumItalic.ttf")),
  readFile(join(process.cwd(), "assets/fonts/Cinzel-Bold.ttf")),
  readFile(join(process.cwd(), "assets/fonts/Inter-Medium.ttf")),
  readFile(join(process.cwd(), "assets/images/hermes-caduceus.jpg")),
  readFile(join(process.cwd(), "public/brand/hermes-wordmark-light.png")),
])

// What you hold: the staking token, or the token a lending route lends
const held = (route: YieldRoute) => (route.category === "liquid-staking" && route.receipt ? route.receipt : route.token)

// The app's order: Safety Score, then APY
const bySafety = (a: YieldRoute, b: YieldRoute) => (b.safety?.score ?? -1) - (a.safety?.score ?? -1) || b.apy - a.apy

async function topRated(): Promise<YieldRoute[]> {
  try {
    const routes = await YieldAPI.getRoutes(undefined, { revalidate: 60, signal: AbortSignal.timeout(10_000) })
    return routes.filter((route) => route.deposit && isTopRated(route)).sort(bySafety).slice(0, 3)
  } catch {
    return []
  }
}

const readAt = (routes: YieldRoute[]) =>
  new Date(Math.max(...routes.map((route) => new Date(route.updatedAt).getTime()))).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }) + " UTC"

function Diamond({ color = C.gilt, size = 10 }: { color?: string; size?: number }) {
  return <div style={{ width: size, height: size, background: color, transform: "rotate(45deg)" }} />
}

export default async function Image() {
  const [[cormorant, cormorantItalic, cinzel, inter, fresco, wordmark], routes] = await Promise.all([files, topRated()])
  const live = routes.length > 0
  const bestApy = live ? Math.max(...routes.map((route) => route.apy)) : 0

  return asJpeg(
    new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", background: C.plaster, padding: 18 }}>
          <div
            style={{
              flex: 1,
              display: "flex",
              background: C.vellum,
              border: `2px solid ${C.gilt}`,
              borderRadius: 6,
              padding: "40px 40px 34px 56px",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", width: 660 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`data:image/png;base64,${wordmark.toString("base64")}`} width={209} height={36} alt="" />

              <div
                style={{
                  marginTop: 28,
                  display: "flex",
                  alignItems: "center",
                  alignSelf: "flex-start",
                  border: `1.5px solid ${C.frame}`,
                  borderRadius: 999,
                  padding: "7px 18px",
                  fontFamily: "Cinzel",
                  fontSize: 17,
                  letterSpacing: 3,
                  color: C.terracotta,
                }}
              >
                <Diamond size={8} />
                <div style={{ marginLeft: 12 }}>LIVE SOLANA YIELDS</div>
              </div>

              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", color: C.umber }}>
                <div style={{ fontFamily: "Hermes Cormorant", fontWeight: 600, fontSize: live ? 78 : 96, lineHeight: 1 }}>Your guide to</div>
                <div style={{ fontFamily: "Hermes Cormorant", fontStyle: "italic", fontWeight: 500, fontSize: live ? 78 : 96, lineHeight: 1.05 }}>
                  Solana yield
                </div>
              </div>

              {live ? (
                <div style={{ marginTop: "auto", display: "flex", flexDirection: "column" }}>
                  <div style={{ fontFamily: "Cinzel", fontSize: 16, letterSpacing: 3, color: C.sienna }}>TOP RATED RIGHT NOW</div>
                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", borderTop: `1.5px solid ${C.frame}` }}>
                    {routes.map((route) => (
                      <div
                        key={route.id}
                        style={{ display: "flex", alignItems: "center", height: 46, borderBottom: `1.5px solid ${C.rowLine}` }}
                      >
                        <Diamond size={8} />
                        <div style={{ marginLeft: 14, fontFamily: "Hermes Cormorant", fontWeight: 600, fontSize: 31, color: C.umber }}>
                          {route.name}
                        </div>
                        <div style={{ marginLeft: 12, marginTop: 4, fontFamily: "Inter", fontSize: 17, color: C.sienna }}>{held(route)}</div>
                        <div style={{ marginLeft: "auto", fontFamily: "Inter", fontSize: 18, color: C.olive }}>
                          {`Safety ${route.safety?.score}`}
                        </div>
                        <div style={{ width: 190, display: "flex", alignItems: "flex-end", justifyContent: "flex-end" }}>
                          <div style={{ fontFamily: "Cinzel", fontSize: 28, color: route.apy === bestApy ? C.ink : C.umber }}>
                            {`${(route.apy * 100).toFixed(2)}%`}
                          </div>
                          <div style={{ marginLeft: 7, marginBottom: 7, fontFamily: "Inter", fontSize: 15, color: C.sienna }}>APY</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: "auto", display: "flex", fontFamily: "Inter", fontSize: 22, color: C.sienna }}>
                  Live rates side by side. A Safety Score on every route.
                </div>
              )}

              <div style={{ marginTop: 18, display: "flex", fontFamily: "Inter", fontSize: 18, color: C.sienna }}>
                {live
                  ? `hermesagg.xyz  ·  APY and Safety Score, read ${readAt(routes)}`
                  : "hermesagg.xyz  ·  Deposit from your own wallet"}
              </div>
            </div>

            {/* Hermes in flight in an arch: his head, raised hand and caduceus inside the curve */}
            <div
              style={{
                marginLeft: "auto",
                width: 360,
                display: "flex",
                padding: 6,
                border: `2px solid ${C.gilt}`,
                borderRadius: "180px 180px 4px 4px",
                background: C.plaster,
              }}
            >
              <div style={{ flex: 1, display: "flex", position: "relative", overflow: "hidden", borderRadius: "174px 174px 2px 2px" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:image/jpeg;base64,${fresco.toString("base64")}`}
                  width={464}
                  height={560}
                  style={{ position: "absolute", left: -88, top: -10 }}
                  alt=""
                />
              </div>
            </div>
          </div>
        </div>
      ),
      {
        ...size,
        fonts: [
          { name: "Hermes Cormorant", data: cormorant, weight: 600, style: "normal" },
          { name: "Hermes Cormorant", data: cormorantItalic, weight: 500, style: "italic" },
          { name: "Cinzel", data: cinzel, weight: 700, style: "normal" },
          { name: "Inter", data: inter, weight: 500, style: "normal" },
        ],
      }
    )
  )
}
