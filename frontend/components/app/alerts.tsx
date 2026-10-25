"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { Bell, BellRing, Check, Loader2, Mail } from "lucide-react"

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
  readFollowing,
  readHeld,
  alertChannels,
  confirmEmailLink,
  emailStatus,
  forgetEmail,
  readEmail,
  readWatched,
  registration,
  saveAlerts,
  startEmailAlerts,
  turnOffAlerts,
  turnOffPush,
  unsubscribeEmail,
  watchRoutes,
  writeFollowing,
  type AlertLists,
  type AlertsSupport,
  type Platform,
} from "@/lib/alerts"

// Alerts: the routes this device watches and the routes its wallet holds, and the two ways they arrive: this
// browser's notifications, or email. Shared by the route bells, Portfolio and Settings.
// Turning alerts on for the first time goes through a guide: phone or email, then the browser's prompt and the
// steps to allow notifications when the browser hides or blocks it, or an address and the link Hermes emails it.

type GuideStep =
  | "ask" // what alerts cover, before the browser's prompt
  | "asking" // the browser's prompt is open
  | "dismissed" // the prompt closed, or never showed, without an answer
  | "blocked" // notifications are blocked for Hermes in this browser
  | "working"
  | "on"
  | "allowed" // allowed from Settings, nothing to watch yet
  | "failed"
  | "home-screen"
  | "unsupported"
  | "email" // type an address
  | "email-sent" // waiting for the link in the email to be opened
  | "email-on"

interface Guide {
  step: GuideStep
  route: YieldRoute | null // the route whose bell was tapped
  positions: string[] | null // the wallet's routes, when the guide turns on alerts for positions
  message?: string
}

interface AlertsState {
  support: AlertsSupport
  enabled: boolean // alerts reach this device, its email, or both
  push: boolean // this browser's notifications are on
  emailOffered: boolean // Hermes can send email right now
  email: { address: string; confirmed: boolean } | null // this device's address
  watched: string[]
  held: string[]
  following: boolean // the held list follows the wallet's positions
  busy: boolean
  error: string | null
  toggle: (route: YieldRoute) => Promise<void>
  followPositions: (routes: string[]) => void
  stopFollowing: () => Promise<void>
  syncHeld: (routes: string[], complete: boolean) => void
  addHeld: (routeId: string) => void
  turnOff: () => Promise<void>
  turnOffPush: () => Promise<void>
  stopEmail: () => Promise<void>
  refreshEmail: () => Promise<void>
  showGuide: (step: "ask" | "blocked" | "home-screen" | "unsupported" | "email") => void
}

const AlertsContext = createContext<AlertsState | null>(null)

const FALLBACK_ERROR = "Hermes could not update alerts. Try again shortly."
const EMAIL_POLL_MS = 3000

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id))

export function AlertsProvider({ children }: { children: React.ReactNode }) {
  const [support, setSupport] = useState<AlertsSupport>("unsupported")
  const [push, setPush] = useState(false)
  const [emailOffered, setEmailOffered] = useState(false)
  const [email, setEmail] = useState<{ address: string; token: string; confirmed: boolean } | null>(null)
  const [watched, setWatched] = useState<string[]>([])
  const [held, setHeld] = useState<string[]>([])
  const [following, setFollowing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [guide, setGuide] = useState<Guide | null>(null)
  const emailOn = !!email?.confirmed
  const enabled = push || emailOn

  // The latest values, for callbacks that outlive a render (a prompt answered later, Portfolio's sync)
  const latest = useRef({ watched, held, following, enabled })
  useEffect(() => {
    latest.current = { watched, held, following, enabled }
  }, [watched, held, following, enabled])
  // Each guide opening gets an id, so a prompt answered late can't change a guide opened since
  const guideId = useRef(0)
  const subscribingFor = useRef(-1)

  // This device's address and whether it's confirmed. An address Hermes no longer has is forgotten.
  const refreshEmail = useCallback(async () => {
    const saved = readEmail()
    if (!saved) return setEmail(null)
    const status = await emailStatus(saved.token)
    if (status === "gone") {
      forgetEmail()
      return setEmail(null)
    }
    // When Hermes can't say, the address counts as it was
    setEmail((current) => ({ ...saved, confirmed: status ? status === "confirmed" : current?.token === saved.token && current.confirmed }))
    if (status === "confirmed") {
      setWatched(readWatched())
      setHeld(readHeld())
    }
  }, [])

  useEffect(() => {
    const found = alertsSupport()
    setSupport(found)
    setFollowing(readFollowing())
    // Keep the worker registered so the browser can show alerts while Hermes is closed
    if (found === "supported") registration().catch(() => {})
    alertChannels().then((channels) => setEmailOffered(channels.email))
    const saved = readEmail()
    Promise.all([
      found === "supported" ? currentSubscription().catch(() => null) : Promise.resolve(null),
      saved ? emailStatus(saved.token) : Promise.resolve(null),
    ]).then(([subscription, status]) => {
      if (saved && status === "gone") forgetEmail()
      const address = saved && status !== "gone" ? { ...saved, confirmed: status === "confirmed" } : null
      setPush(!!subscription)
      setEmail(address)
      if (subscription || address?.confirmed) {
        setWatched(readWatched())
        setHeld(readHeld())
      }
    })
  }, [])

  const openGuide = useCallback((step: GuideStep, route: YieldRoute | null, positions: string[] | null = null): number => {
    guideId.current += 1
    setGuide({ step, route, positions })
    return guideId.current
  }, [])

  const show = useCallback((id: number, step: GuideStep, route: YieldRoute | null, positions: string[] | null, message?: string) => {
    if (id === guideId.current) setGuide({ step, route, positions, message })
  }, [])

  const closeGuide = useCallback(() => {
    guideId.current += 1
    setGuide(null)
  }, [])

  // The lists once the guide's route or positions are added
  const pendingLists = useCallback((route: YieldRoute | null, positions: string[] | null): AlertLists => {
    const { watched, held } = latest.current
    return { routes: route && !watched.includes(route.id) ? [...watched, route.id] : watched, held: positions ?? held }
  }, [])

  // Save the lists to every channel this device has
  const save = useCallback(async (lists: AlertLists) => {
    setBusy(true)
    setError(null)
    try {
      const saved = await saveAlerts(lists)
      setWatched(saved.routes)
      setHeld(saved.held)
    } catch (err) {
      setError(err instanceof Error ? err.message : FALLBACK_ERROR)
    } finally {
      setBusy(false)
    }
  }, [])

  // Permission is granted: subscribe this browser for the guide's route or positions
  const subscribeTo = useCallback(
    async (id: number, route: YieldRoute | null, positions: string[] | null) => {
      if (subscribingFor.current === id) return
      subscribingFor.current = id
      const lists = pendingLists(route, positions)
      if (!route && !positions && lists.routes.length + lists.held.length === 0) return show(id, "allowed", null, null)
      show(id, "working", route, positions)
      try {
        const saved = await watchRoutes(lists)
        if (positions) {
          writeFollowing(true)
          setFollowing(true)
        }
        setWatched(saved.routes)
        setHeld(saved.held)
        setPush(true)
        show(id, "on", route, positions)
      } catch (err) {
        subscribingFor.current = -1
        if (err instanceof AlertsError && err.blocked) show(id, "blocked", route, positions)
        else show(id, "failed", route, positions, err instanceof Error ? err.message : FALLBACK_ERROR)
      }
    },
    [show, pendingLists]
  )

  // Runs straight from the tap on "Allow alerts"
  const allow = useCallback(() => {
    if (!guide) return
    const id = guideId.current
    const { route, positions } = guide
    // First, while the tap still counts: Safari won't ask otherwise, and Chrome may hide the prompt
    const pending = askPermission()
    show(id, "asking", route, positions)
    pending
      .then((result) => {
        if (result === "granted") subscribeTo(id, route, positions)
        else show(id, result === "denied" ? "blocked" : "dismissed", route, positions)
      })
      .catch(() => show(id, "failed", route, positions, "This browser couldn't ask for notifications. Try again, or use Chrome on Android."))
  }, [guide, show, subscribeTo])

  // The user may allow notifications from the browser's settings instead of the prompt: carry on when they do
  const guideStep = guide?.step
  const guideRoute = guide?.route ?? null
  const guidePositions = guide?.positions ?? null
  useEffect(() => {
    if (guideStep !== "asking" && guideStep !== "dismissed" && guideStep !== "blocked") return
    const id = guideId.current
    const check = () => {
      if (notificationPermission() === "granted") subscribeTo(id, guideRoute, guidePositions)
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
  }, [guideStep, guideRoute, guidePositions, subscribeTo])

  // Email instead: the address form
  const toEmail = useCallback(() => {
    if (!guide) return
    show(guideId.current, "email", guide.route, guide.positions)
  }, [guide, show])

  // Send the confirmation link with the guide's lists. An address already confirmed carries on at once.
  const sendEmail = useCallback(
    async (address: string) => {
      if (!guide) return
      const id = guideId.current
      const { route, positions } = guide
      const lists = pendingLists(route, positions)
      try {
        const started = await startEmailAlerts(address, lists)
        setEmail({ address: address.trim(), token: started.token, confirmed: started.confirmed })
        if (started.confirmed) {
          if (positions) {
            writeFollowing(true)
            setFollowing(true)
          }
          const saved = await saveAlerts(lists)
          setWatched(saved.routes)
          setHeld(saved.held)
        }
        show(id, started.confirmed ? "email-on" : "email-sent", route, positions)
      } catch (err) {
        show(id, guide.step === "email-sent" ? "email-sent" : "email", route, positions, err instanceof Error ? err.message : FALLBACK_ERROR)
      }
    },
    [guide, pendingLists, show]
  )

  // Wait for the link in the email: the guide carries on once it's opened, here or on another device
  const waitingToken = guideStep === "email-sent" ? email?.token : undefined
  useEffect(() => {
    if (!waitingToken) return
    const id = guideId.current
    let done = false
    const check = async () => {
      if (done || document.hidden) return
      if ((await emailStatus(waitingToken)) !== "confirmed" || done || id !== guideId.current) return
      done = true
      const lists = pendingLists(guideRoute, guidePositions)
      setEmail((current) => (current ? { ...current, confirmed: true } : current))
      if (guidePositions) {
        writeFollowing(true)
        setFollowing(true)
      }
      // Saved with the address already. This keeps the browser's copy and any push subscription the same.
      await saveAlerts(lists).catch(() => {})
      setWatched(lists.routes)
      setHeld(lists.held)
      show(id, "email-on", guideRoute, guidePositions)
    }
    const timer = setInterval(check, EMAIL_POLL_MS)
    window.addEventListener("focus", check)
    document.addEventListener("visibilitychange", check)
    return () => {
      done = true
      clearInterval(timer)
      window.removeEventListener("focus", check)
      document.removeEventListener("visibilitychange", check)
    }
  }, [waitingToken, guideRoute, guidePositions, pendingLists, show])

  // A first route or the positions with no channel yet: the guide, starting where this browser stands
  const startGuide = useCallback(
    (route: YieldRoute | null, positions: string[] | null) => {
      if (support !== "supported") return void openGuide(support === "needs-home-screen" ? "home-screen" : "unsupported", route, positions)
      const permission = notificationPermission()
      if (permission === "granted") subscribeTo(openGuide("working", route, positions), route, positions)
      else openGuide(permission === "denied" ? "blocked" : "ask", route, positions)
    },
    [support, openGuide, subscribeTo]
  )

  const toggle = useCallback(
    async (route: YieldRoute) => {
      const on = watched.includes(route.id)
      if (on) return save({ routes: watched.filter((id) => id !== route.id), held })
      if (!enabled) return startGuide(route, null)
      // Notifications were blocked since, and there's no email to fall back on
      if (push && !emailOn && notificationPermission() !== "granted") return startGuide(route, null)
      return save({ routes: [...watched, route.id], held })
    },
    [watched, held, enabled, push, emailOn, save, startGuide]
  )

  // Portfolio's bell, from a tap
  const followPositions = useCallback(
    (routes: string[]) => {
      if (!enabled || (push && !emailOn && notificationPermission() !== "granted")) return startGuide(null, routes)
      writeFollowing(true)
      setFollowing(true)
      void save({ routes: watched, held: routes })
    },
    [enabled, push, emailOn, watched, save, startGuide]
  )

  const stopFollowing = useCallback(async () => {
    writeFollowing(false)
    setFollowing(false)
    await save({ routes: watched, held: [] })
  }, [watched, save])

  // Portfolio read the wallet's positions. A partial read (a source didn't answer) only adds.
  const syncHeld = useCallback(
    (routes: string[], complete: boolean) => {
      const { following, enabled, held, watched } = latest.current
      if (!following || !enabled) return
      const next = complete ? routes : [...new Set([...held, ...routes])]
      if (!sameSet(next, held)) void save({ routes: watched, held: next })
    },
    [save]
  )

  // A deposit landed in a route
  const addHeld = useCallback(
    (routeId: string) => {
      const { following, enabled, held, watched } = latest.current
      if (following && enabled && !held.includes(routeId)) void save({ routes: watched, held: [...held, routeId] })
    },
    [save]
  )

  const turnOff = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await turnOffAlerts()
      setPush(false)
      setEmail(null)
      setFollowing(false)
      setWatched([])
      setHeld([])
    } finally {
      setBusy(false)
    }
  }, [])

  const turnOffBrowser = useCallback(async () => {
    setBusy(true)
    try {
      await turnOffPush()
      setPush(false)
    } finally {
      setBusy(false)
    }
  }, [])

  const stopEmail = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await unsubscribeEmail()
      setEmail(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : FALLBACK_ERROR)
    } finally {
      setBusy(false)
    }
  }, [])

  const showGuide = useCallback(
    (step: "ask" | "blocked" | "home-screen" | "unsupported" | "email") => void openGuide(step, null),
    [openGuide]
  )

  return (
    <AlertsContext.Provider
      value={{
        support,
        enabled,
        push,
        emailOffered,
        email: email && { address: email.address, confirmed: email.confirmed },
        watched,
        held,
        following,
        busy,
        error,
        toggle,
        followPositions,
        stopFollowing,
        syncHeld,
        addHeld,
        turnOff,
        turnOffPush: turnOffBrowser,
        stopEmail,
        refreshEmail,
        showGuide,
      }}
    >
      {children}
      <AlertsGuide
        guide={guide}
        emailOffered={emailOffered}
        address={email?.address ?? ""}
        onClose={closeGuide}
        onAllow={allow}
        onEmail={toEmail}
        onSendEmail={sendEmail}
      />
    </AlertsContext.Provider>
  )
}

export function useAlerts(): AlertsState {
  const state = useContext(AlertsContext)
  if (!state) throw new Error("useAlerts needs AlertsProvider")
  return state
}

// The bell under a route: watch it to get alerts, or stop
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

// Portfolio's bell: alerts for every route the wallet holds, kept in step with the wallet as it changes
export function PositionAlertToggle({ routes, className }: { routes: string[]; className?: string }) {
  const { enabled, following, held, busy, error, followPositions, stopFollowing } = useAlerts()
  const on = enabled && following
  const count = on ? held.length : routes.length
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <button
        type="button"
        onClick={() => (on ? stopFollowing() : followPositions(routes))}
        disabled={busy}
        aria-pressed={on}
        className={cn(
          "flex min-h-11 w-full items-center gap-2.5 rounded-[4px] border px-3.5 py-2.5 text-left text-sm transition-colors disabled:opacity-60",
          on ? "border-frame bg-secondary text-foreground" : "border-hairline bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"
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
              Alerts on for your {count === 1 ? "position" : `${count} positions`}.{" "}
              <span className="text-muted-foreground">Tap to stop.</span>
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">Alert me about my positions</span>
              <span className="mt-0.5 block text-xs">A rate drop, a better route, a depeg or deposits leaving.</span>
            </>
          )}
        </span>
      </button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

// Settings: what alerts cover on this device, and the two ways they arrive. The links in Hermes's emails open here
// too: one confirms an address, the other stops the emails.
export function AlertsSettings() {
  const {
    support,
    enabled,
    push,
    emailOffered,
    email,
    watched,
    held,
    following,
    busy,
    error,
    turnOff,
    turnOffPush,
    stopEmail,
    refreshEmail,
    showGuide,
  } = useAlerts()
  const blocked = support === "supported" && !push && notificationPermission() === "denied"
  const [linkNote, setLinkNote] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const confirm = params.get("confirm")
    const unsubscribe = params.get("unsubscribe")
    if (!confirm && !unsubscribe) return
    // Once only, and the token doesn't stay in the address bar
    window.history.replaceState(null, "", window.location.pathname)
    const task = confirm
      ? confirmEmailLink(confirm).then(() => ({ ok: true, text: "Email alerts are on. Hermes emails you when a route you watch or hold changes." }))
      : unsubscribeEmail(unsubscribe!).then(() => ({ ok: true, text: "Done. Hermes won't email you anymore." }))
    task
      .catch((err) => ({ ok: false, text: err instanceof Error ? err.message : FALLBACK_ERROR }))
      .then((note) => {
        setLinkNote(note)
        void refreshEmail()
      })
  }, [refreshEmail])

  const covered = [
    watched.length > 0 && `${watched.length} ${watched.length === 1 ? "route" : "routes"}`,
    following && held.length > 0 && `your ${held.length === 1 ? "position" : `${held.length} positions`}`,
  ].filter(Boolean)
  const status = !enabled
    ? "Off. Tap the bell under any route, or turn on alerts for your positions in Portfolio."
    : covered.length > 0
      ? `On for ${covered.join(" and ")}. Hermes tells you when a rate falls, a better top rated route opens, a staking token trades below its value, deposits leave, a reserve is nearly all borrowed, or a route leaves Top rated.`
      : "On, with nothing to watch yet. Tap the bell under a route, or turn on alerts for your positions in Portfolio."

  const browser =
    support === "unsupported"
      ? { text: "This browser can't show alerts.", help: "unsupported" as const }
      : support === "needs-home-screen"
        ? { text: "On iPhone, they need Hermes on your Home Screen.", help: "home-screen" as const }
        : blocked
          ? { text: "Blocked for Hermes in this browser.", help: "blocked" as const }
          : { text: push ? "Notifications on." : "Off.", help: null }

  return (
    <div className="flex flex-col gap-3 p-[18px]">
      <div>
        <div className="label-roman">Alerts</div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{status}</p>
      </div>

      {linkNote && (
        <p
          role="status"
          className={cn(
            "rounded-[4px] border px-3.5 py-2.5 text-[13px] leading-relaxed",
            linkNote.ok ? "border-frame bg-secondary" : "border-destructive-line bg-destructive-surface text-destructive"
          )}
        >
          {linkNote.text}
        </p>
      )}

      <div className="flex flex-col divide-y divide-hairline rounded-[4px] border border-hairline">
        <div className="flex items-center justify-between gap-3 px-3.5 py-3">
          <span className="flex min-w-0 items-start gap-2.5">
            <Bell className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-sm font-medium">This device</span>
              <span className="block text-xs text-muted-foreground">{browser.text}</span>
            </span>
          </span>
          {browser.help ? (
            <button type="button" onClick={() => showGuide(browser.help!)} className="btn-frame h-9 shrink-0 px-3 text-[13px]">
              Show me how
            </button>
          ) : push ? (
            <button type="button" onClick={turnOffPush} disabled={busy} className="btn-frame h-9 shrink-0 px-3 text-[13px] disabled:opacity-60">
              Turn off
            </button>
          ) : (
            <button type="button" onClick={() => showGuide("ask")} className="btn-frame h-9 shrink-0 px-3 text-[13px]">
              Turn on
            </button>
          )}
        </div>
        {(emailOffered || email) && (
          <div className="flex items-center justify-between gap-3 px-3.5 py-3">
            <span className="flex min-w-0 items-start gap-2.5">
              <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">Email</span>
                <span className="block break-all text-xs text-muted-foreground">
                  {email
                    ? email.confirmed
                      ? email.address
                      : `Open the link sent to ${email.address}.`
                    : "Alerts by email. Each one has a link to stop them."}
                </span>
              </span>
            </span>
            {email ? (
              <button type="button" onClick={stopEmail} disabled={busy} className="btn-frame h-9 shrink-0 px-3 text-[13px] disabled:opacity-60">
                {email.confirmed ? "Stop" : "Cancel"}
              </button>
            ) : (
              <button type="button" onClick={() => showGuide("email")} className="btn-frame h-9 shrink-0 px-3 text-[13px]">
                Add
              </button>
            )}
          </div>
        )}
      </div>

      {enabled && (
        <button type="button" onClick={turnOff} disabled={busy} className="btn-frame h-11 px-4 text-sm disabled:opacity-60">
          {busy ? "Turning off..." : "Turn off all alerts"}
        </button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

// The guide: a bottom sheet on phones and tablets, a dialog on desktop
interface GuideActions {
  emailOffered: boolean // Hermes can send email right now
  address: string // this device's email address, if any
  onClose: () => void
  onAllow: () => void
  onEmail: () => void
  onSendEmail: (address: string) => Promise<void>
}

function AlertsGuide({ guide, ...actions }: { guide: Guide | null } & GuideActions) {
  const phone = usePhone()
  // Keep the last step on screen while the guide slides away
  const [last, setLast] = useState<Guide | null>(null)
  useEffect(() => {
    if (guide) setLast(guide)
  }, [guide])
  const shown = guide ?? last
  const open = !!guide
  const onOpenChange = (next: boolean) => !next && actions.onClose()
  const body = shown && <GuideBody guide={shown} {...actions} />

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
  email: "Alerts by email",
  "email-sent": "Check your inbox",
  "email-on": "Email alerts are on",
}

function GuideBody({ guide, emailOffered, address, onClose, onAllow, onEmail, onSendEmail }: { guide: Guide } & GuideActions) {
  const { step, route, positions } = guide
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

  const subtitle = route ? `${route.name} · ${route.token}` : positions ? "Your positions" : "On this device"
  // What the alerts are about, for the lines below
  const about = route ? route.name : positions ? "a route you hold" : "a route you watch or hold"

  return (
    <>
      <div className="border-b border-hairline px-[18px] pb-3.5 pr-14 pt-[18px]">
        <SheetTitle className="font-display text-[26px] font-bold leading-[1.1]">{TITLES[step]}</SheetTitle>
        <SheetDescription className="mt-1 text-[13px] text-muted-foreground">{subtitle}</SheetDescription>
      </div>

      <div className="flex flex-col gap-4 p-[18px] text-sm leading-relaxed">
        {step === "ask" && (
          <>
            {(route || positions) && <WhatAlertsCover route={route} />}
            {emailOffered ? (
              <>
                <p className="font-medium">How should Hermes reach you?</p>
                <ChannelChoice
                  icon={Bell}
                  title="On this device"
                  text="Notifications, like a message. Your browser asks first: tap Allow."
                  action="Allow notifications"
                  onClick={onAllow}
                  main
                />
                <ChannelChoice
                  icon={Mail}
                  title="By email"
                  text="Hermes emails you a link to confirm the address. Each alert email has a link to stop them."
                  action="Use email"
                  onClick={onEmail}
                />
                <button type="button" onClick={onClose} className="h-10 w-full text-sm text-muted-foreground hover:text-foreground">
                  Not now
                </button>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <p>Next, your browser asks to send you notifications. Tap Allow.</p>
                  <PromptPreview host={host} />
                </div>
                <Actions primary="Allow alerts" onPrimary={onAllow} secondary="Not now" onSecondary={onClose} />
              </>
            )}
            <p className="text-xs text-muted-foreground">
              Hermes keeps this device&apos;s alert address or your email, and the routes you watch
              {positions ? " and hold" : ""}. Never your wallet.
            </p>
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
            {emailOffered && <EmailOption onEmail={onEmail} />}
          </>
        )}

        {step === "blocked" && (
          <>
            <p>Your browser blocks notifications from Hermes, so it can't ask again. To allow them:</p>
            <AllowSteps where={where} host={host} />
            <p className="text-xs text-muted-foreground">Hermes turns alerts on as soon as you allow them.</p>
            <Actions primary="I've allowed them" onPrimary={onAllow} secondary="Close" onSecondary={onClose} />
            {emailOffered && <EmailOption onEmail={onEmail} />}
          </>
        )}

        {step === "working" && (
          <p className="flex items-center gap-2.5">
            <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
            Turning on alerts{route ? ` for ${route.name}` : positions ? " for your positions" : ""}...
          </p>
        )}

        {step === "on" && (
          <>
            <p className="flex items-start gap-2.5">
              <BellRing className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                Hermes will tell this device when {about} changes.{" "}
                {positions && "It follows your wallet: routes join and leave as your positions do. "}
                A first notification is on its way, which can take a few seconds.
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
            {emailOffered && <EmailOption onEmail={onEmail} />}
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
                route
                  ? `Tap "Alert me about ${route.name}" again and choose Allow.`
                  : positions
                    ? `Open Portfolio, tap "Alert me about my positions" again and choose Allow.`
                    : "Tap the bell under a route and choose Allow.",
              ]}
            />
            <Actions primary="Got it" onPrimary={onClose} />
            {emailOffered && <EmailOption onEmail={onEmail} lead="Or skip the Home Screen:" />}
          </>
        )}

        {step === "unsupported" && (
          <>
            <Unsupported host={host} onClose={onClose} />
            {emailOffered && <EmailOption onEmail={onEmail} lead="Or get them by email:" />}
          </>
        )}

        {step === "email" && (
          <EmailForm initial={address} message={guide.message} about={about} onSend={onSendEmail} />
        )}

        {step === "email-sent" && (
          <EmailSent address={address} message={guide.message} onResend={() => onSendEmail(address)} onChange={onEmail} />
        )}

        {step === "email-on" && (
          <>
            <p className="flex items-start gap-2.5">
              <Mail className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                Hermes will email <span className="break-all font-semibold">{address}</span> when {about} changes.
                {positions && " It follows your wallet: routes join and leave as your positions do."} Each email has a link to
                stop them.
              </span>
            </p>
            <Actions primary="Done" onPrimary={onClose} />
          </>
        )}
      </div>
    </>
  )
}

function WhatAlertsCover({ route }: { route: YieldRoute | null }) {
  // Without a route: the positions, whatever they hold
  const items = route
    ? [
        "Its rate falls 20% or more in a day",
        `A top rated ${route.token} route pays a point or more above it`,
        "Its Safety Score falls below 80",
        ...(route.category === "liquid-staking" ? [`${route.receipt ?? "Its token"} trades 1% or more below its SOL value`] : []),
        "15% or more of its deposits leave in a day",
        ...(route.category === "lending" ? ["5% or less of the reserve can be withdrawn"] : []),
      ]
    : [
        "A rate falls 20% or more in a day",
        "A top rated route for the same token pays half a point more: Reroute is a tap away",
        "A staking token trades 1% or more below its SOL value",
        "15% or more of a route's deposits leave in a day",
        "A reserve is nearly all borrowed, or a route leaves Top rated",
      ]
  return (
    <div className="flex flex-col gap-2">
      <p>{route ? `Hermes tells you when ${route.name} changes:` : "Hermes tells you when a route you hold changes:"}</p>
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

// The two ways, side by side, for a first alert
function ChannelChoice({
  icon: Icon,
  title,
  text,
  action,
  onClick,
  main = false,
}: {
  icon: typeof Bell
  title: string
  text: string
  action: string
  onClick: () => void
  main?: boolean
}) {
  return (
    <div className="flex flex-col gap-3 rounded-[4px] border border-hairline bg-plate p-3.5">
      <span className="flex items-start gap-2.5">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block font-semibold">{title}</span>
          <span className="block text-[13px] text-muted-foreground">{text}</span>
        </span>
      </span>
      <button type="button" onClick={onClick} className={cn(main ? "btn-teal" : "btn-frame", "h-11 w-full text-sm")}>
        {action}
      </button>
    </div>
  )
}

// Email as the other way: browsers inside apps and iPhones outside the Home Screen can't show notifications
function EmailOption({ onEmail, lead = "Rather get email?" }: { onEmail: () => void; lead?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[4px] border border-hairline bg-plate px-3.5 py-2.5">
      <span className="text-[13px] text-muted-foreground">{lead}</span>
      <button type="button" onClick={onEmail} className="btn-frame h-9 shrink-0 px-3 text-[13px]">
        <Mail className="size-3.5" aria-hidden="true" />
        Email me instead
      </button>
    </div>
  )
}

const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function EmailForm({
  initial,
  message,
  about,
  onSend,
}: {
  initial: string
  message?: string
  about: string
  onSend: (address: string) => Promise<void>
}) {
  const [value, setValue] = useState(initial)
  const [sending, setSending] = useState(false)
  const valid = LOOKS_LIKE_EMAIL.test(value.trim())
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!valid || sending) return
    setSending(true)
    await onSend(value)
    setSending(false)
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p>Hermes will email you when {about} changes. First it sends a link, so only you can turn these on.</p>
      <label className="flex flex-col gap-1.5">
        <span className="label-roman">Email</span>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="you@example.com"
          className="h-12 rounded-[4px] border border-input bg-background px-3.5 text-[15px] text-foreground outline-none focus:border-ink"
        />
      </label>
      {message && <p className="text-[13px] text-destructive">{message}</p>}
      <button type="submit" disabled={!valid || sending} className="btn-teal h-12 w-full text-[15px]">
        {sending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Sending
          </>
        ) : (
          "Email me a link"
        )}
      </button>
      <p className="text-xs text-muted-foreground">
        Hermes keeps your address and the routes you watch or hold. Never your wallet. Each alert email has a link to stop
        them.
      </p>
    </form>
  )
}

// Waiting for the link. Hermes checks every few seconds and when the page comes back, so it can be opened anywhere.
function EmailSent({
  address,
  message,
  onResend,
  onChange,
}: {
  address: string
  message?: string
  onResend: () => Promise<void>
  onChange: () => void
}) {
  const [resending, setResending] = useState(false)
  return (
    <>
      <p className="flex items-start gap-2.5">
        <Mail className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          Hermes sent a link to <span className="break-all font-semibold">{address}</span>. Open it to turn alerts on. It
          can take a minute, and may land in spam.
        </span>
      </p>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
        Waiting for the link. You can open it on any device.
      </p>
      {message && <p className="text-[13px] text-destructive">{message}</p>}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={async () => {
            setResending(true)
            await onResend()
            setResending(false)
          }}
          disabled={resending}
          className="btn-frame h-11 w-full text-sm disabled:opacity-60"
        >
          {resending ? "Sending..." : "Send it again"}
        </button>
        <button type="button" onClick={onChange} className="h-10 w-full text-sm text-muted-foreground hover:text-foreground">
          Use another address
        </button>
      </div>
    </>
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
          <span className="grid size-5 shrink-0 place-items-center rounded-full border border-frame font-sans text-[11px] font-semibold tabular-nums">
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
