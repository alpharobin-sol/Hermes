"use client"

import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { Bell, BellRing, Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import type { YieldRoute } from "@/lib/api/yield-api"
import {
  alertsSupport,
  currentSubscription,
  readWatched,
  registration,
  turnOffAlerts,
  watchRoutes,
  type AlertsSupport,
} from "@/lib/alerts"

// Phone alerts: this device's on/off state and the routes it watches, shared by the route bells and Settings

interface AlertsState {
  support: AlertsSupport
  enabled: boolean // this device is subscribed
  watched: string[]
  busy: boolean
  error: string | null
  toggle: (routeId: string) => Promise<void>
  turnOff: () => Promise<void>
}

const AlertsContext = createContext<AlertsState | null>(null)

export function AlertsProvider({ children }: { children: React.ReactNode }) {
  const [support, setSupport] = useState<AlertsSupport>("unsupported")
  const [enabled, setEnabled] = useState(false)
  const [watched, setWatched] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const found = alertsSupport()
    setSupport(found)
    if (found !== "supported") return
    // Keep the worker registered so the browser can show alerts while Hermes is closed
    registration().catch(() => {})
    currentSubscription()
      .then((subscription) => {
        setEnabled(!!subscription)
        setWatched(subscription ? readWatched() : [])
      })
      .catch(() => {})
  }, [])

  const toggle = useCallback(
    async (routeId: string) => {
      setBusy(true)
      setError(null)
      try {
        const next = watched.includes(routeId) ? watched.filter((id) => id !== routeId) : [...watched, routeId]
        setWatched(await watchRoutes(next))
        setEnabled(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Hermes could not update alerts. Try again shortly.")
      } finally {
        setBusy(false)
      }
    },
    [watched]
  )

  const turnOff = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await turnOffAlerts()
      setEnabled(false)
      setWatched([])
    } finally {
      setBusy(false)
    }
  }, [])

  return (
    <AlertsContext.Provider value={{ support, enabled, watched, busy, error, toggle, turnOff }}>{children}</AlertsContext.Provider>
  )
}

export function useAlerts(): AlertsState {
  const state = useContext(AlertsContext)
  if (!state) throw new Error("useAlerts needs AlertsProvider")
  return state
}

const IPHONE_HINT = "On iPhone, alerts need Hermes on your Home Screen: tap Share, then Add to Home Screen, and open Hermes from there."

// The bell under a route: watch it to get alerts on this device, or stop
export function RouteAlertToggle({ route, className }: { route: YieldRoute; className?: string }) {
  const { support, watched, busy, error, toggle } = useAlerts()
  if (support === "unsupported") return null

  if (support === "needs-home-screen") {
    return (
      <p className={cn("flex items-start gap-2.5 text-xs leading-relaxed text-muted-foreground", className)}>
        <Bell className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{IPHONE_HINT}</span>
      </p>
    )
  }

  const on = watched.includes(route.id)
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <button
        type="button"
        onClick={() => toggle(route.id)}
        disabled={busy}
        aria-pressed={on}
        className={cn(
          "flex h-11 w-full items-center gap-2.5 rounded-[2px] border px-3.5 text-left text-sm transition-colors disabled:opacity-60",
          on ? "border-frame bg-secondary text-foreground" : "border-hairline text-muted-foreground hover:bg-secondary hover:text-foreground"
        )}
      >
        {busy ? (
          <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
        ) : on ? (
          <BellRing className="size-4 shrink-0" aria-hidden="true" />
        ) : (
          <Bell className="size-4 shrink-0" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1">
          {on ? (
            <>
              Alerts on for {route.name}. <span className="text-muted-foreground">Tap to stop.</span>
            </>
          ) : (
            `Alert me about ${route.name}`
          )}
        </span>
      </button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

// Settings: whether alerts are on for this device, and a way to turn them all off
export function AlertsSettings() {
  const { support, enabled, watched, busy, error, turnOff } = useAlerts()

  const status =
    support === "unsupported"
      ? "This browser can't show alerts."
      : support === "needs-home-screen"
        ? IPHONE_HINT
        : enabled && watched.length > 0
          ? `On for ${watched.length} ${watched.length === 1 ? "route" : "routes"}. Hermes tells you when a rate falls, a better top rated route opens, a reserve is nearly all borrowed, or a route leaves Top rated.`
          : "Off. Tap the bell under any route to get alerts on this device."

  return (
    <div className="flex flex-col gap-3 p-[18px]">
      <div>
        <div className="label-roman">Alerts</div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{status}</p>
      </div>
      {enabled && (
        <button
          type="button"
          onClick={turnOff}
          disabled={busy}
          className="btn-frame h-11 px-4 text-sm disabled:opacity-60"
        >
          {busy ? "Turning off..." : "Turn off alerts on this device"}
        </button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
