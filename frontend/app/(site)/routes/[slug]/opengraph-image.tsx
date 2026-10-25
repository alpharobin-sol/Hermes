import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { ImageResponse } from "next/og"
import { notFound } from "next/navigation"

import { YieldAPI, type YieldRoute } from "@/lib/api/yield-api"
import { isTopRated } from "@/lib/top-rated"
import { exitTight, routeLabel, routeSlug, typeLabel } from "@/lib/route-copy"

// Each route's share image, for X, Telegram and search: its live APY and Safety Score on the Aurora palette, with the
// fresco in an arch like the site's. Drawn on the server and kept for a minute, like the page. A failed read throws,
// so the last good image stays.
export const revalidate = 60
export const alt = "A Hermes route with its live APY and Safety Score"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

// Like the pages: none drawn at build time, each drawn on its first request and kept for a minute
export async function generateStaticParams() {
  return []
}

const C = {
  plaster: "#f6ead0",
  vellum: "#fcf5e6",
  umber: "#2b140e",
  sienna: "#6b4a36",
  terracotta: "#8e3b1f",
  olive: "#456028",
  ochre: "#865408",
  vermilion: "#a33a22",
  gilt: "#b99467",
  frame: "#cdb185",
}

// The site's fonts, as files: the image renderer can't load web fonts. Hermes Cormorant is Cormorant Garamond with
// lining figures made the default, since the renderer can't turn them on ("Project 0", never "Project o").
// Each path is written out so the build includes just these files with the server code.
const files = Promise.all([
  readFile(join(process.cwd(), "assets/fonts/HermesCormorant-SemiBold.ttf")),
  readFile(join(process.cwd(), "assets/fonts/HermesCormorant-MediumItalic.ttf")),
  readFile(join(process.cwd(), "assets/fonts/Cinzel-Bold.ttf")),
  readFile(join(process.cwd(), "assets/fonts/Inter-Medium.ttf")),
  readFile(join(process.cwd(), "public/brand/aurora-banner.jpg")),
  readFile(join(process.cwd(), "public/brand/hermes-wordmark-light.png")),
])

const scoreColor = (score: number) => (score >= 80 ? C.olive : score >= 60 ? C.ochre : C.vermilion)

const readAt = (route: YieldRoute) =>
  new Date(route.updatedAt).toLocaleString("en-GB", {
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

function Label({ children }: { children: string }) {
  return <div style={{ fontFamily: "Cinzel", fontSize: 17, letterSpacing: 3, color: C.sienna }}>{children}</div>
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!/^[a-z0-9-]{1,48}$/.test(slug)) notFound()
  const routes = await YieldAPI.getRoutes(undefined, { revalidate: 60, signal: AbortSignal.timeout(10_000) })
  const route = routes.find((candidate) => routeSlug(candidate) === slug)
  if (!route) notFound()

  const [cormorant, cormorantItalic, cinzel, inter, banner, wordmark] = await files
  const label = routeLabel(route)
  // One line at any length: "JitoSOL" large, "Jupiter Lend USDT" smaller
  const titleSize = Math.min(124, Math.floor(1300 / Math.max(label.length, 1)))
  const score = route.safety?.score

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: C.plaster, padding: 18 }}>
        <div
          style={{
            flex: 1,
            display: "flex",
            background: C.vellum,
            border: `2px solid ${C.gilt}`,
            borderRadius: 6,
            padding: "40px 40px 36px 56px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", width: 660 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`data:image/png;base64,${wordmark.toString("base64")}`} width={209} height={36} alt="" />

            <div
              style={{
                marginTop: 38,
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
              <div style={{ marginLeft: 12 }}>{`${typeLabel(route)} · ${route.token}`.toUpperCase()}</div>
            </div>

            <div style={{ marginTop: 20, fontFamily: "Hermes Cormorant", fontWeight: 600, fontSize: titleSize, lineHeight: 1, color: C.umber }}>
              {label}
            </div>
            <div
              style={{
                marginTop: 2,
                fontFamily: "Hermes Cormorant",
                fontStyle: "italic",
                fontWeight: 500,
                fontSize: 64,
                lineHeight: 1.05,
                color: C.umber,
              }}
            >
              APY today
            </div>

            <div style={{ marginTop: "auto", display: "flex", alignItems: "flex-start" }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <Label>APY TODAY</Label>
                <div style={{ marginTop: 10, fontFamily: "Cinzel", fontSize: 70, lineHeight: 1, color: C.umber }}>
                  {`${(route.apy * 100).toFixed(2)}%`}
                </div>
              </div>
              <div style={{ width: 1.5, height: 96, background: C.frame, margin: "0 40px 0 44px" }} />
              <div style={{ display: "flex", flexDirection: "column" }}>
                <Label>SAFETY SCORE</Label>
                {score !== undefined ? (
                  <div style={{ marginTop: 10, display: "flex", alignItems: "flex-end" }}>
                    <div style={{ fontFamily: "Cinzel", fontSize: 70, lineHeight: 1, color: scoreColor(score) }}>{String(score)}</div>
                    <div style={{ marginLeft: 8, marginBottom: 6, fontFamily: "Inter", fontSize: 24, color: C.sienna }}>/ 100</div>
                    {isTopRated(route) && (
                      <div style={{ marginLeft: 22, marginBottom: 8, display: "flex", alignItems: "center", fontFamily: "Inter", fontSize: 20, color: C.umber }}>
                        <Diamond />
                        <div style={{ marginLeft: 10 }}>Top rated</div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ marginTop: 14, fontFamily: "Hermes Cormorant", fontWeight: 600, fontSize: 46, lineHeight: 1, color: C.sienna }}>
                    Not scored yet
                  </div>
                )}
              </div>
            </div>

            {/* A reserve nearly all borrowed says so, as the page does: a high rate there is a scarce exit */}
            {exitTight(route) ? (
              <div style={{ marginTop: 26, display: "flex", alignItems: "center", fontFamily: "Inter", fontSize: 18, color: C.ochre }}>
                <Diamond color={C.ochre} size={8} />
                <div style={{ marginLeft: 10 }}>{`Nearly all borrowed: withdrawals may wait  ·  Read ${readAt(route)}`}</div>
              </div>
            ) : (
              <div style={{ marginTop: 26, display: "flex", fontFamily: "Inter", fontSize: 19, color: C.sienna }}>
                {`hermesagg.xyz/routes/${slug}  ·  Live, read ${readAt(route)}`}
              </div>
            )}
          </div>

          {/* The fresco in an arch, Hermes leading the Hours */}
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
                src={`data:image/jpeg;base64,${banner.toString("base64")}`}
                width={1560}
                height={520}
                style={{ position: "absolute", left: -455, top: 0 }}
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
}
