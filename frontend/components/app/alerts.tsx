"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { Bell, BellRing, Check, Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import type { YieldRoute } from "@/lib/api/yield-api"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import {
  AlertsError,
  alertsSupport,
  askPermission,
  currentSubscription,
  notificationPermission,
  platform,
  readWatched,
  registration,
  turnOffAlerts,
  watchRoutes,
  type AlertsSupport,
  type Platform,
} from "@/lib/alerts"

// Phone alerts: this device's on/off state and the routes it watches, shared by the route bells and Settings.
// Turning alerts on for the first time goes through a guide: what Hermes sends, then the browser's prompt, and the
// steps to allow notifications when the browser hides or blocks the prompt.

type GuideStep =
  | "ask" // what alerts cover, before the browser's prompt
  | "asking" // the browser's prompt is open
  | "dismissed" // the prompt closed, or never showed, without an answer
  | "blocked" // notifications are blocked for Hermes in this browser
  | "working"
  | "on"
  | "allowed" // allowed from Settings, no route picked yet
  | "failed"
  | "home-screen"
  | "unsupported"

interface Guide {
  step: GuideStep
  route: YieldRoute | null // the route whose bell was tapped, null from Settings
  message?: string
}

interface AlertsState {
  support: AlertsSupport
  enabled: boolean // this device is subscribed
  watched: string[]
  busy: boolean
  error: string | null
  toggle: (route: YieldRoute) => Promise<void>
  turnOff: () => Promise<void>
  showGuide: (step: "blocked" | "home-screen" | "unsupported") => void
}

const AlertsContext = createContext<AlertsState | null>(null)

const FALLBACK_ERROR = "Hermes could not update alerts. Try again shortly."

export function AlertsProvider({ children }: { children: React.ReactNode }) {
  const [support, setSupport] = useState<AlertsSupport>("unsupported")
  const [enabled, setEnabled] = useState(false)
  const [watched, setWatched] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [guide, setGuide] = useState<Guide | null>(null)

  const watchedRef = useRef(watched)
  useEffect(() => {
    watchedRef.current = watched
  }, [watched])
  // Each guide opening gets an id, so a prompt answered late can't change a guide opened since
  const guideId = useRef(0)
  const subscribingFor = useRef(-1)

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

  const openGuide = useCallback((step: GuideStep, route: YieldRoute | null): number => {
    guideId.current += 1
    setGuide({ step, route })
    return guideId.current
  }, [])

  const show = useCallback((id: number, step: GuideStep, route: YieldRoute | null, message?: string) => {
    if (id === guideId.current) setGuide({ step, route, message })
  }, [])

  const closeGuide = useCallback(() => {
    guideId.current += 1
    setGuide(null)
  }, [])

  // Permission is granted: subscribe this device and watch the route
  const subscribeTo = useCallback(
    async (id: number, route: YieldRoute | null) => {
      if (subscribingFor.current === id) return
      subscribingFor.current = id
      if (!route) return show(id, "allowed", null)
      show(id, "working", route)
      try {
        const current = watchedRef.current
        setWatched(await watchRoutes(current.includes(route.id) ? current : [...current, route.id]))
        setEnabled(true)
        show(id, "on", route)
      } catch (err) {
        subscribingFor.current = -1
        if (err instanceof AlertsError && err.blocked) show(id, "blocked", route)
        else show(id, "failed", route, err instanceof Error ? err.message : FALLBACK_ERROR)
      }
    },
    [show]
  )

  // Runs straight from the tap on "Allow alerts"
  const allow = useCallback(() => {
    if (!guide) return
    const id = guideId.current
    const route = guide.route
    // First, while the tap still counts: Safari won't ask otherwise, and Chrome may hide the prompt
    const pending = askPermission()
    show(id, "asking", route)
    pending
      .then((result) => {
        if (result === "granted") subscribeTo(id, route)
        else show(id, result === "denied" ? "blocked" : "dismissed", route)
      })
      .catch(() => show(id, "failed", route, "This browser couldn't ask for notifications. Try again, or use Chrome on Android."))
  }, [guide, show, subscribeTo])

  // The user may allow notifications from the browser's settings instead of the prompt: carry on when they do
  const guideStep = guide?.step
  const guideRoute = guide?.route ?? null
  useEffect(() => {
    if (guideStep !== "asking" && guideStep !== "dismissed" && guideStep !== "blocked") return
    const id = guideId.current
    const check = () => {
      if (notificationPermission() === "granted") subscribeTo(id, guideRoute)
    }
    let status: PermissionStatus | null = null
    navigator.permissions
      ?.query({ name: "notifications" })
      .then((found) => {
        status = found
        found.onchange = check
      })
      .catch(() => {})
    window.addEventListener("focus", check)
    document.addEventListener("visibilitychange", check)
    return () => {
      if (status) status.onchange = null
      window.removeEventListener("focus", check)
      document.removeEventListener("visibilitychange", check)
    }
  }, [guideStep, guideRoute, subscribeTo])

  const toggle = useCallback(
    async (route: YieldRoute) => {
      const on = watched.includes(route.id)
      if (!on && support !== "supported") {
        openGuide(support === "needs-home-screen" ? "home-screen" : "unsupported", route)
        return
      }
      // A device's first route goes through the guide, which asks for permission and confirms alerts are on
      if (!on && (!enabled || notificationPermission() !== "granted")) {
        const permission = notificationPermission()
        if (permission === "granted") {
          subscribeTo(openGuide("working", route), route)
        } else {
          openGuide(permission === "denied" ? "blocked" : "ask", route)
        }
        return
      }
      setBusy(true)
      setError(null)
      try {
        setWatched(await watchRoutes(on ? watched.filter((id) => id !== route.id) : [...watched, route.id]))
        setEnabled(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : FALLBACK_ERROR)
      } finally {
        setBusy(false)
      }
    },
    [watched, support, enabled, openGuide, subscribeTo]
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

  const showGuide = useCallback((step: "blocked" | "home-screen" | "unsupported") => void openGuide(step, null), [openGuide])

  return (
    <AlertsContext.Provider value={{ support, enabled, watched, busy, error, toggle, turnOff, showGuide }}>
      {children}
      <AlertsGuide guide={guide} onClose={closeGuide} onAllow={allow} />
    </AlertsContext.Provider>
  )
}

export function useAlerts(): AlertsState {
  const state = useContext(AlertsContext)
  if (!state) throw new Error("useAlerts needs AlertsProvider")
  return state
}

// The bell under a route: watch it to get alerts on this device, or stop
export function RouteAlertToggle({ route, className }: { route: YieldRoute; className?: string }) {
  const { watched, busy, error, toggle } = useAlerts()
  const on = watched.includes(route.id)
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <button
        type="button"
        onClick={() => toggle(route)}
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
  const { support, enabled, watched, busy, error, turnOff, showGuide } = useAlerts()
  const blocked = support === "supported" && !enabled && notificationPermission() === "denied"

  const status =
    support === "unsupported"
      ? "This browser can't show alerts."
      : support === "needs-home-screen"
        ? "On iPhone, alerts need Hermes on your Home Screen."
        : blocked
          ? "Notifications are blocked for Hermes in this browser."
          : enabled && watched.length > 0
            ? `On for ${watched.length} ${watched.length === 1 ? "route" : "routes"}. Hermes tells you when a rate falls, a better top rated route opens, a reserve is nearly all borrowed, or a route leaves Top rated.`
            : "Off. Tap the bell under any route to get alerts on this device."
  const help = support === "needs-home-screen" ? "home-screen" : support === "unsupported" ? "unsupported" : blocked ? "blocked" : null

  return (
    <div className="flex flex-col gap-3 p-[18px]">
      <div>
        <div className="label-roman">Alerts</div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{status}</p>
      </div>
      {help && (
        <button type="button" onClick={() => showGuide(help)} className="btn-frame h-11 px-4 text-sm">
          Show me how
        </button>
      )}
      {enabled && (
        <button type="button" onClick={turnOff} disabled={busy} className="btn-frame h-11 px-4 text-sm disabled:opacity-60">
          {busy ? "Turning off..." : "Turn off alerts on this device"}
        </button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

// The guide: a bottom sheet on phones and tablets, a dialog on desktop
function AlertsGuide({ guide, onClose, onAllow }: { guide: Guide | null; onClose: () => void; onAllow: () => void }) {
  const phone = usePhone()
  // Keep the last step on screen while the guide slides away
  const [last, setLast] = useState<Guide | null>(null)
  useEffect(() => {
    if (guide) setLast(guide)
  }, [guide])
  const shown = guide ?? last
  const open = !!guide
  const onOpenChange = (next: boolean) => !next && onClose()
  const body = shown && <GuideBody guide={shown} onClose={onClose} onAllow={onAllow} />

  if (phone) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent>
          <div className="overflow-y-auto">{body}</div>
        </SheetContent>
      </Sheet>
    )
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm gap-0 rounded-[4px] border-gilt bg-card p-[5px] sm:max-w-sm [&>[data-slot=dialog-close]]:right-5 [&>[data-slot=dialog-close]]:top-5">
        <div className="plaque-inner max-h-[calc(100dvh-4rem)] overflow-y-auto">{body}</div>
      </DialogContent>
    </Dialog>
  )
}

function usePhone(): boolean {
  const [phone, setPhone] = useState(false)
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1023px)")
    const update = () => setPhone(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])
  return phone
}

const TITLES: Record<GuideStep, string> = {
  ask: "Turn on alerts",
  asking: "Tap Allow",
  dismissed: "Allow notifications",
  blocked: "Notifications are blocked",
  working: "Turning on alerts",
  on: "Alerts are on",
  allowed: "Notifications allowed",
  failed: "Alerts didn't turn on",
  "home-screen": "Add Hermes to your Home Screen",
  unsupported: "Open Hermes in your browser",
}

function GuideBody({ guide, onClose, onAllow }: { guide: Guide; onClose: () => void; onAllow: () => void }) {
  const { step, route } = guide
  const [where, setWhere] = useState<Platform>("desktop")
  const [host, setHost] = useState("www.hermesagg.xyz")
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    setWhere(platform())
    setHost(window.location.host)
  }, [])

  // Chrome sometimes hides the prompt behind a small icon. Point there if no answer comes.
  useEffect(() => {
    setSlow(false)
    if (step !== "asking") return
    const timer = setTimeout(() => setSlow(true), 4000)
    return () => clearTimeout(timer)
  }, [step])

  const subtitle = route ? `${route.name} · ${route.token}` : "On this device"

  return (
    <>
      <div className="border-b border-hairline px-[18px] pb-3.5 pr-14 pt-[18px]">
        <SheetTitle className="font-display text-[26px] font-bold leading-[1.1]">{TITLES[step]}</SheetTitle>
        <SheetDescription className="mt-1 text-[13px] text-muted-foreground">{subtitle}</SheetDescription>
      </div>

      <div className="flex flex-col gap-4 p-[18px] text-sm leading-relaxed">
        {step === "ask" && (
          <>
            {route && <WhatAlertsCover route={route} />}
            <div className="flex flex-col gap-2">
              <p>Next, your browser asks to send you notifications. Tap Allow.</p>
              <PromptPreview host={host} />
            </div>
            <p className="text-xs text-muted-foreground">
              Hermes keeps this device's alert address and the routes you watch. No wallet, no email.
            </p>
            <Actions primary="Allow alerts" onPrimary={onAllow} secondary="Not now" onSecondary={onClose} />
          </>
        )}

        {step === "asking" && (
          <>
            <p>Tap Allow in your browser's prompt.</p>
            <PromptPreview host={host} />
            {slow && (
              <>
                <p>
                  No prompt? Your browser may have hidden it. Look for a bell with a line through it in the address bar, or a
                  "Notifications blocked" message at the bottom of the screen. Tap it, then Allow. Or allow them by hand:
                </p>
                <AllowSteps where={where} host={host} />
              </>
            )}
          </>
        )}

        {step === "dismissed" && (
          <>
            <p>The prompt closed before you tapped Allow, or your browser didn't show it.</p>
            <Actions primary="Ask again" onPrimary={onAllow} />
            <p>Still no prompt? Allow notifications by hand:</p>
            <AllowSteps where={where} host={host} />
            <p className="text-xs text-muted-foreground">Hermes turns alerts on as soon as you allow them.</p>
          </>
        )}

        {step === "blocked" && (
          <>
            <p>Your browser blocks notifications from Hermes, so it can't ask again. To allow them:</p>
            <AllowSteps where={where} host={host} />
            <p className="text-xs text-muted-foreground">Hermes turns alerts on as soon as you allow them.</p>
            <Actions primary="I've allowed them" onPrimary={onAllow} secondary="Close" onSecondary={onClose} />
          </>
        )}

        {step === "working" && (
          <p className="flex items-center gap-2.5">
            <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
            Turning on alerts{route ? ` for ${route.name}` : ""}...
          </p>
        )}

        {step === "on" && route && (
          <>
            <p className="flex items-start gap-2.5">
              <BellRing className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                Hermes will tell this device when {route.name} changes. It just sent a first notification, which can take a few
                seconds.
              </span>
            </p>
            <p className="text-xs text-muted-foreground">{NOTHING_ARRIVED[where]}</p>
            <Actions primary="Done" onPrimary={onClose} />
          </>
        )}

        {step === "allowed" && (
          <>
            <p>Hermes can send alerts to this device. Tap the bell under any route to watch it.</p>
            <Actions primary="Done" onPrimary={onClose} />
          </>
        )}

        {step === "failed" && (
          <>
            <p>{guide.message ?? FALLBACK_ERROR}</p>
            <Actions primary="Try again" onPrimary={onAllow} secondary="Close" onSecondary={onClose} />
          </>
        )}

        {step === "home-screen" && (
          <>
            <p>iPhone and iPad show alerts only for sites on the Home Screen, from iOS 16.4.</p>
            <Steps
              items={[
                "In Safari, tap Share (the square with an arrow). On newer iOS it sits under the three dots.",
                "Tap Add to Home Screen, then Add.",
                "Open Hermes from your Home Screen.",
                route ? `Tap "Alert me about ${route.name}" again and choose Allow.` : "Tap the bell under a route and choose Allow.",
              ]}
            />
            <Actions primary="Got it" onPrimary={onClose} />
          </>
        )}

        {step === "unsupported" && <Unsupported host={host} onClose={onClose} />}
      </div>
    </>
  )
}

function WhatAlertsCover({ route }: { route: YieldRoute }) {
  const items = [
    "Its rate falls 20% or more in a day",
    `A top rated ${route.token} route pays a point or more above it`,
    "Its Safety Score falls below 80",
    ...(route.category === "lending" ? ["5% or less of the reserve can be withdrawn"] : []),
  ]
  return (
    <div className="flex flex-col gap-2">
      <p>Get a notification on this device when {route.name} changes:</p>
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2.5">
            <Check className="mt-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">At most one alert of each kind a day.</p>
    </div>
  )
}

// What the browser's prompt looks like, so the user knows what to tap
function PromptPreview({ host }: { host: string }) {
  return (
    <div aria-hidden="true" className="rounded-[4px] border border-border bg-background p-3.5 text-[13px] shadow-sm">
      <div className="flex items-start gap-2.5">
        <Bell className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span>
          <span className="font-semibold">{host}</span> wants to send notifications
        </span>
      </div>
      <div className="mt-3 flex justify-end gap-2 font-semibold">
        <span className="px-3 py-1.5 text-muted-foreground">Block</span>
        <span className="rounded-[4px] border-2 border-gilt px-3 py-1">Allow</span>
      </div>
    </div>
  )
}

function allowSteps(where: Platform, host: string): string[] {
  switch (where) {
    case "android":
      return [
        `Tap the icon to the left of ${host} in the address bar.`,
        "Tap Permissions. If you don't see it, tap Site settings.",
        "Turn on Notifications.",
        "Still nothing? Open your phone's Settings, then Apps, Chrome, Notifications, and turn them on.",
      ]
    case "iphone":
      return ["Open your iPhone's Settings.", "Tap Notifications, then Hermes.", "Turn on Allow Notifications."]
    case "firefox":
      return [
        "Click the icon to the left of the web address.",
        "Next to Send notifications, clear Blocked.",
        "Reload Hermes and tap the bell again.",
      ]
    case "mac-safari":
      return ["Open Safari, then Settings, then Websites.", "Choose Notifications on the left.", `Set ${host} to Allow.`]
    default:
      return [
        "Click the icon to the left of the web address.",
        "Turn on Notifications, or open Site settings and set Notifications to Allow.",
        "Come back to this tab.",
      ]
  }
}

function AllowSteps({ where, host }: { where: Platform; host: string }) {
  return <Steps items={allowSteps(where, host)} />
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {items.map((item, index) => (
        <li key={item} className="flex items-start gap-2.5">
          <span className="grid size-5 shrink-0 place-items-center rounded-full border border-frame font-roman text-[11px] font-bold">
            {index + 1}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  )
}

const NOTHING_ARRIVED: Record<Platform, string> = {
  android: "Nothing arrived? Open your phone's Settings, then Apps, Chrome, Notifications, and turn them on.",
  iphone: "Nothing arrived? Open Settings, then Notifications, then Hermes, and turn on Allow Notifications.",
  firefox: "Nothing arrived? Check that your computer allows notifications from Firefox, and that Do Not Disturb is off.",
  "mac-safari": "Nothing arrived? Open System Settings, then Notifications, then Safari, and allow notifications.",
  desktop: "Nothing arrived? Check that your computer allows notifications from your browser, and that Do Not Disturb or Focus is off.",
}

function Unsupported({ host, onClose }: { host: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard
      ?.writeText(`https://${host}`)
      .then(() => setCopied(true))
      .catch(() => {})
  }
  return (
    <>
      <p>
        This browser can't show alerts. Browsers inside apps, like Telegram and X, and private tabs can't. Open {host} in Chrome
        on Android, or in Safari on iPhone and add it to your Home Screen.
      </p>
      <Actions primary={copied ? "Link copied" : "Copy link"} onPrimary={copy} secondary="Close" onSecondary={onClose} />
    </>
  )
}

function Actions({
  primary,
  onPrimary,
  secondary,
  onSecondary,
}: {
  primary: string
  onPrimary: () => void
  secondary?: string
  onSecondary?: () => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={onPrimary} className="btn-teal h-12 w-full text-[15px]">
        {primary}
      </button>
      {secondary && onSecondary && (
        <button type="button" onClick={onSecondary} className="h-11 w-full text-sm text-muted-foreground hover:text-foreground">
          {secondary}
        </button>
      )}
    </div>
  )
}
