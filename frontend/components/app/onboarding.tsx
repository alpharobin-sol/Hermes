"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useWallet, type Wallet } from "@solana/wallet-adapter-react"
import { WalletReadyState } from "@solana/wallet-adapter-base"
import { ArrowRight, Check, Clock } from "lucide-react"

import banner from "@/public/brand/aurora-banner.jpg"
import mark from "@/public/brand/hermes-mark.png"
import { cn } from "@/lib/utils"
import { IS_DEVNET } from "@/lib/network"
import { notificationPermission } from "@/lib/alerts"
import { getFullUrl, type YieldRoute } from "@/lib/api/yield-api"
import { TOP_RATED_MIN_SCORE } from "@/lib/top-rated"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import {
  ALERTS_SECONDS,
  DEPOSIT_SECONDS,
  ONBOARDING_STEPS,
  WALLET_SECONDS,
  closeForThisVisit,
  closedThisVisit,
  formatDuration,
  formatTimeLeft,
  hideOnboarding,
  markStep,
  markWelcomed,
  onOnboardingChange,
  readOnboarding,
  readingSeconds,
  showOnboardingAgain,
  type AlertsReadiness,
  type OnboardingState,
  type OnboardingStep,
  type WalletReadiness,
} from "@/lib/onboarding"
import { useAlerts } from "./alerts"
import { NetworkPill } from "./layout/network-pill"
import { Medallion, RISK_LEVELS, formatApy, typeLabel } from "./rate-board"
import { Tour, type TourStop } from "./onboarding-tour"

// Getting started (owner's call, 25 Oct). Titan's welcome card and guided tour and Gloam's checklist are the
// references. The first visit opens on a welcome card, then a checklist of four steps to a first deposit, each with
// the time it takes on this device. A step's button starts the real action, and every step ticks itself when it's
// done: a connected wallet, the Safety Score tour (or opening Why), a confirmed deposit or a position in Portfolio,
// a watched route. The checklist comes back after each step until it closes for the visit or all four are done.

const NUMERALS = ["I", "II", "III", "IV"]

const SHORT: Record<OnboardingStep, string> = {
  wallet: "Connect",
  safety: "Learn",
  deposit: "Deposit",
  alerts: "Alerts",
}

const DOCS_LINK = { href: "/docs#safety-score", label: "More in Docs" }

// The Safety Score tour: three stops on the live page, with the selected route's own score
function safetyTour(route: YieldRoute | null): TourStop[] {
  const name = route?.name ?? "This route"
  return [
    {
      target: "routes",
      title: "Every route, rated",
      text: "Each route shows a Safety Score from 0 to 100, worked out from live data. The list opens sorted by it.",
    },
    {
      target: "view",
      title: "Top rated",
      text: `Hermes opens on routes that score ${TOP_RATED_MIN_SCORE} or more, with low risk. All routes shows the rest.`,
    },
    route?.safety
      ? {
          target: "score",
          open: true,
          title: `Why ${name} scores ${route.safety.score}`,
          text: "Four parts, up to 25 points each: size, track record, 30-day outflows and how easily you can get out, less any deductions. Each shows what it measured and its source.",
          link: DOCS_LINK,
        }
      : {
          target: "score",
          title: "Why a route scores what it does",
          text: `${name} isn't scored right now: some of its data is missing. A scored route shows four parts here, each with what it measured and its source.`,
          link: DOCS_LINK,
        },
  ]
}

// Set once someone starts the checklist or one of its steps on this visit. From then on, a finished step brings the
// checklist back to show what's next.
let engaged = false

// Wait until no other dialog is open (the wallet picker, the deposit, the alerts guide), then run
function whenIdle(run: () => void): () => void {
  const started = Date.now()
  let timer: ReturnType<typeof setTimeout>
  const check = () => {
    if (!document.querySelector('[role="dialog"]')) timer = setTimeout(run, 450)
    else if (Date.now() - started < 10 * 60 * 1000) timer = setTimeout(check, 400)
  }
  check()
  return () => clearTimeout(timer)
}

function aboutMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  return seconds < 60 ? "under a minute" : `about ${minutes} ${minutes === 1 ? "minute" : "minutes"}`
}

interface OnboardingProps {
  route: YieldRoute | null // the selected route: the tour reads its score and the alerts step watches it
  onConnect: () => void
  onDeposit: () => void // brings the amount box into view
}

export function Onboarding({ route, onConnect, onDeposit }: OnboardingProps) {
  const { connected, publicKey, wallets } = useWallet()
  const { support, enabled, watched, held, following, toggle } = useAlerts()
  // Read in the browser after the first render, so the server and the browser render the same page
  const [state, setState] = useState<OnboardingState | null>(null)
  const [open, setOpen] = useState(false)
  const [touring, setTouring] = useState(false)
  // All four done on this visit: the card says so once
  const [finishing, setFinishing] = useState(false)

  useEffect(() => {
    const sync = () => setState(readOnboarding())
    sync()
    setOpen(!closedThisVisit())
    return onOnboardingChange(sync)
  }, [])

  // Steps that tick themselves
  useEffect(() => {
    if (connected) markStep("wallet")
  }, [connected])
  // A watched route, or alerts that follow the wallet's positions, by notification or Telegram
  const alerting = enabled && (watched.length > 0 || (following && held.length > 0))
  useEffect(() => {
    if (alerting) markStep("alerts")
  }, [alerting])

  // A wallet that already holds a position in a Hermes route has made its first deposit. Asked once per wallet.
  const address = publicKey?.toBase58() ?? null
  const depositDone = state ? state.done.includes("deposit") : true
  const asked = useRef(new Set<string>())
  useEffect(() => {
    if (!address || depositDone || IS_DEVNET || asked.current.has(address)) return
    asked.current.add(address)
    fetch(getFullUrl(`/api/portfolio/${address}`), { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (json?.success && json.portfolio?.positions?.length > 0) markStep("deposit")
      })
      .catch(() => {})
  }, [address, depositDone])

  const doneCount = state ? ONBOARDING_STEPS.filter((step) => state.done.includes(step)).length : 0
  const allDone = doneCount === ONBOARDING_STEPS.length

  // A step done after someone started: the checklist comes back once nothing else is open, to show the next one.
  // The count is null until the saved steps are read, so the first count read is the starting point.
  const known = state ? doneCount : null
  const previous = useRef<number | null>(null)
  useEffect(() => {
    if (known === null || !state) return
    const before = previous.current
    previous.current = known
    if (before === null || known <= before) return
    if (allDone && (open || engaged)) setFinishing(true)
    if (!engaged || open || touring || state.hidden || closedThisVisit()) return
    return whenIdle(() => setOpen(true))
    // Only a change in the count matters here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [known])

  const stops = useMemo(() => safetyTour(route), [route])

  const finishTour = useCallback(() => {
    setTouring(false)
    markStep("safety")
    setOpen(true)
  }, [])
  const skipTour = useCallback(() => {
    setTouring(false)
    setOpen(true)
  }, [])

  const tour = touring ? <Tour label="Safety Score tour" stops={stops} onFinish={finishTour} onSkip={skipTour} /> : null
  if (!state || state.hidden || (allDone && !finishing)) return tour

  // How long each step takes on this device. On a computer, a wallet that isn't installed only offers its web
  // wallet (Solflare's), which still needs an account: that counts as no wallet yet.
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  const walletReady: WalletReadiness = wallets.some((w) => w.readyState === WalletReadyState.Installed)
    ? "installed"
    : mobile && wallets.some((w) => w.readyState === WalletReadyState.Loadable)
      ? "app"
      : "none"
  const permission = notificationPermission()
  const alertsReady: AlertsReadiness =
    support === "needs-home-screen"
      ? "home-screen"
      : support === "unsupported"
        ? "unsupported"
        : permission === "granted"
          ? "granted"
          : permission === "denied"
            ? "blocked"
            : "ask"
  const seconds: Record<OnboardingStep, number> = {
    wallet: WALLET_SECONDS[walletReady],
    safety: readingSeconds(stops.map((stop) => `${stop.title} ${stop.text}`)),
    deposit: DEPOSIT_SECONDS,
    alerts: ALERTS_SECONDS[alertsReady],
  }
  const total = ONBOARDING_STEPS.reduce((sum, step) => sum + seconds[step], 0)
  const left = ONBOARDING_STEPS.filter((step) => !state.done.includes(step)).reduce((sum, step) => sum + seconds[step], 0)
  const current = ONBOARDING_STEPS.find((step) => !state.done.includes(step)) ?? null
  const face = finishing ? "finish" : state.welcomed ? "checklist" : "welcome"

  const close = () => {
    closeForThisVisit()
    setOpen(false)
  }

  const start = () => {
    engaged = true
    markWelcomed()
  }

  // Each step's button steps aside for the action it starts
  const act = (step: OnboardingStep) => {
    engaged = true
    setOpen(false)
    if (step === "wallet") onConnect()
    else if (step === "safety") setTimeout(() => setTouring(true), 220)
    else if (step === "deposit") onDeposit()
    // Straight from the tap, so the browser can ask about notifications
    else if (step === "alerts" && route && !watched.includes(route.id)) void toggle(route)
  }

  const copy = stepCopy(route, walletReady, alertsReady)

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent
          showCloseButton={false}
          // The card itself takes focus on open, so no button looks picked. On close, focus goes where the step's
          // action sends it, not back to the page.
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            ;(event.currentTarget as HTMLElement | null)?.focus?.()
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
          className="max-w-[440px] gap-0 rounded-b-[4px] rounded-t-[112px] border-gilt bg-card p-[5px] shadow-[0_40px_90px_-30px_rgba(22,11,8,0.75)] focus-visible:outline-none sm:max-w-[440px]"
        >
          <div className="plaque-inner max-h-[calc(100dvh-2.5rem)] overflow-y-auto overscroll-contain rounded-b-[2px] rounded-t-[108px]">
            {face === "welcome" && (
              <div key="welcome" className="animate-in fade-in-0 duration-300 motion-reduce:animate-none">
                <Fresco />
                <div className="relative -mt-5 px-5 pb-5 text-center sm:px-7 sm:pb-6">
                  <NetworkPill className="h-7 bg-card px-2.5 text-[11px]" />
                  <DialogTitle className="mt-3 font-display text-[36px] font-bold leading-[1.02] sm:text-[40px]">
                    Welcome to Hermes
                  </DialogTitle>
                  <DialogDescription className="mx-auto mt-2.5 max-w-[330px] text-[14px] leading-relaxed text-muted-foreground">
                    Your guide to Solana yield. Four steps from here to your first deposit, {aboutMinutes(total)} in all.
                  </DialogDescription>
                  <Journey className="mt-6" done={state.done} seconds={seconds} />
                  <div className="mt-7 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        markWelcomed()
                        close()
                      }}
                      className="px-1 text-[13px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      Skip for now
                    </button>
                    <button type="button" onClick={start} className="btn-teal h-12 px-7 text-[15px]">
                      Start
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {face === "checklist" && (
              <div key="checklist" className="animate-in fade-in-0 duration-300 motion-reduce:animate-none">
                <div className="relative h-[88px] overflow-hidden" aria-hidden="true">
                  <Image src={banner} alt="" sizes="440px" className="absolute inset-0 size-full object-cover object-[37%_78%]" />
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent from-40% to-card" />
                </div>
                <div className="relative -mt-9 flex flex-col items-center px-5 text-center sm:px-6">
                  <span className="grid size-[60px] place-items-center rounded-full border border-gilt bg-card shadow-[0_12px_26px_-14px_rgba(43,20,14,0.75)]">
                    <Image src={mark} alt="" className="h-8 w-auto" />
                  </span>
                  <DialogTitle className="mt-3 font-display text-[32px] font-bold leading-none">Getting started</DialogTitle>
                  <DialogDescription className="mt-2 text-[13px] text-muted-foreground">
                    {doneCount} of {ONBOARDING_STEPS.length} done · {formatTimeLeft(left)}
                  </DialogDescription>
                  <Progress done={state.done} current={current} className="mt-4 w-full" />
                </div>

                <ol className="m-0 mt-2 list-none px-4 pb-1 sm:px-5">
                  {ONBOARDING_STEPS.map((step, index) => {
                    const done = state.done.includes(step)
                    const active = step === current
                    return (
                      <li key={step} className="relative grid grid-cols-[40px_minmax(0,1fr)] gap-x-3.5 py-3">
                        {index < ONBOARDING_STEPS.length - 1 && (
                          <span
                            aria-hidden="true"
                            className={cn(
                              "absolute -bottom-2.5 left-[19.5px] top-[54px] border-l",
                              done ? "border-gilt" : "border-dashed border-frame"
                            )}
                          />
                        )}
                        <span
                          aria-hidden="true"
                          className={cn(
                            "relative grid size-10 place-items-center rounded-full font-roman text-[14px] font-bold transition-colors duration-300",
                            done
                              ? "bg-success text-card"
                              : active
                                ? "border-[1.5px] border-ornament bg-card text-ornament shadow-[0_0_0_5px_var(--secondary)]"
                                : "border border-hairline bg-secondary/60 text-muted-foreground"
                          )}
                        >
                          {done ? (
                            <Check className="size-[18px] animate-in zoom-in-50 duration-300 motion-reduce:animate-none" strokeWidth={2.75} />
                          ) : (
                            NUMERALS[index]
                          )}
                        </span>
                        <div className="min-w-0 pt-2.5">
                          <div className="flex items-baseline justify-between gap-3">
                            <p className={cn("text-[15px] font-semibold leading-snug", done && "text-muted-foreground")}>
                              {copy[step].title}
                              {done && <span className="sr-only">, done</span>}
                            </p>
                            <span
                              className={cn(
                                "inline-flex shrink-0 items-center gap-1 text-xs tabular-nums",
                                done ? "font-medium text-success" : "text-muted-foreground"
                              )}
                            >
                              {done ? (
                                "Done"
                              ) : (
                                <>
                                  <Clock className="size-3" aria-hidden="true" />
                                  <span className="sr-only">About </span>
                                  {formatDuration(seconds[step])}
                                </>
                              )}
                            </span>
                          </div>
                          {active && (
                            <div className="animate-in fade-in-0 slide-in-from-top-1 duration-300 motion-reduce:animate-none">
                              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{copy[step].text}</p>
                              <StepPreview step={step} route={route} wallets={wallets} mobile={mobile} />
                              {step === "safety" && !route ? (
                                <Link
                                  href={DOCS_LINK.href}
                                  onClick={() => markStep("safety")}
                                  className="btn-teal mt-3 h-11 w-full px-5 text-sm"
                                >
                                  Read it in Docs
                                  <ArrowRight className="size-4" aria-hidden="true" />
                                </Link>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => act(step)}
                                  disabled={step === "alerts" && !route}
                                  className="btn-teal mt-3 h-11 w-full px-5 text-sm"
                                >
                                  {copy[step].action}
                                  <ArrowRight className="size-4" aria-hidden="true" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ol>

                <div className="flex items-center justify-between gap-3 border-t border-hairline px-5 py-4">
                  <button
                    type="button"
                    onClick={() => {
                      hideOnboarding()
                      setOpen(false)
                    }}
                    className="px-1 text-[13px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Don&apos;t show again
                  </button>
                  <button type="button" onClick={close} className="btn-frame h-10 px-5 text-sm">
                    Close
                  </button>
                </div>
              </div>
            )}

            {face === "finish" && (
              <div key="finish" className="animate-in fade-in-0 duration-300 motion-reduce:animate-none">
                <Fresco />
                <div className="relative -mt-9 flex flex-col items-center px-5 pb-5 text-center sm:px-7 sm:pb-6">
                  <span className="grid size-16 place-items-center rounded-full bg-success text-card ring-[5px] ring-card animate-in zoom-in-50 duration-500 motion-reduce:animate-none">
                    <Check className="size-7" strokeWidth={2.75} aria-hidden="true" />
                  </span>
                  <DialogTitle className="mt-4 font-display text-[36px] font-bold leading-none sm:text-[40px]">You&apos;re set</DialogTitle>
                  <DialogDescription className="mx-auto mt-3 max-w-[330px] text-[14px] leading-relaxed text-muted-foreground">
                    Your deposit is in Portfolio, where you can withdraw it or move it. Alerts reach this device when
                    something changes.
                  </DialogDescription>
                  <Journey className="mt-6 w-full" done={ONBOARDING_STEPS} seconds={seconds} />
                  <div className="mt-7 flex w-full items-center justify-between gap-3">
                    <button type="button" onClick={close} className="btn-frame h-12 px-6 text-[15px]">
                      Close
                    </button>
                    <Link href="/portfolio" onClick={() => setOpen(false)} className="btn-teal h-12 px-6 text-[15px]">
                      Open Portfolio
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {tour}
    </>
  )
}

// Each step's words, from what this device has
function stepCopy(route: YieldRoute | null, wallet: WalletReadiness, alerts: AlertsReadiness) {
  const name = route?.name ?? "a route"
  return {
    wallet: {
      title: "Connect your wallet",
      text:
        wallet === "none"
          ? "No Solana wallet in this browser yet. Phantom, Solflare and Backpack each take a few minutes to set up. Hermes never sees your keys."
          : "Hermes builds each deposit for you to sign in your own wallet. It never sees your keys.",
      action: wallet === "none" ? "Choose a wallet" : "Connect wallet",
    },
    safety: {
      title: "Learn the Safety Score",
      text: "Every route scores 0 to 100 from live data. A short tour of the page shows where to read it.",
      action: "Start the tour",
    },
    deposit: {
      title: "Make a small deposit",
      text: "Pick a route, type an amount and sign in your wallet. These are real funds, so start small.",
      action: "Enter an amount",
    },
    alerts: {
      title: "Turn on alerts",
      text:
        alerts === "home-screen"
          ? "On iPhone, alerts work once Hermes is on your Home Screen. The guide shows how."
          : alerts === "unsupported"
            ? "This browser can't show alerts. The guide shows where they work."
            : alerts === "blocked"
              ? "Notifications are blocked for Hermes in this browser. The guide shows how to allow them."
              : `Hermes checks ${name} every 10 minutes and tells this device when something changes.`,
      action: alerts === "granted" || alerts === "ask" ? "Turn on alerts" : "Show me how",
    },
  } satisfies Record<OnboardingStep, { title: string; text: string; action: string }>
}

// The Aurora fresco under an arch, fading into the card
function Fresco() {
  return (
    <div className="relative" aria-hidden="true">
      <Image src={banner} alt="" sizes="440px" className="block aspect-[2/1] h-auto w-full object-cover object-[37%_50%]" />
      <div className="absolute inset-x-0 -bottom-px h-24 bg-gradient-to-t from-card from-10% to-transparent" />
    </div>
  )
}

// The four steps in a row, joined by a gilt line, with the time each takes
function Journey({ done, seconds, className }: { done: OnboardingStep[]; seconds: Record<OnboardingStep, number>; className?: string }) {
  return (
    <ol className={cn("relative m-0 grid list-none grid-cols-4 p-0", className)}>
      <span aria-hidden="true" className="absolute left-[12.5%] right-[12.5%] top-[19px] h-px bg-gilt" />
      {ONBOARDING_STEPS.map((step, index) => {
        const isDone = done.includes(step)
        return (
          <li key={step} className="relative flex flex-col items-center gap-1">
            <span
              aria-hidden="true"
              className={cn(
                "grid size-[38px] place-items-center rounded-full border font-roman text-[13px] font-bold",
                isDone ? "border-success bg-success text-card" : "border-gilt bg-card text-ornament"
              )}
            >
              {isDone ? <Check className="size-4" strokeWidth={3} /> : NUMERALS[index]}
            </span>
            <span className="mt-1 text-[12.5px] font-semibold leading-tight">{SHORT[step]}</span>
            <span className="text-[11px] tabular-nums text-muted-foreground">{isDone ? "Done" : formatDuration(seconds[step])}</span>
          </li>
        )
      })}
    </ol>
  )
}

// One segment per step: gilt when done, a light running across the one in progress
function Progress({ done, current, className }: { done: OnboardingStep[]; current: OnboardingStep | null; className?: string }) {
  const count = ONBOARDING_STEPS.filter((step) => done.includes(step)).length
  return (
    <div
      role="progressbar"
      aria-label="Steps done"
      aria-valuemin={0}
      aria-valuemax={ONBOARDING_STEPS.length}
      aria-valuenow={count}
      className={cn("flex gap-1.5", className)}
    >
      {ONBOARDING_STEPS.map((step) => (
        <span key={step} className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-hairline">
          <span
            className={cn(
              "absolute inset-0 origin-left rounded-full bg-gilt transition-transform duration-700 ease-out",
              done.includes(step) ? "scale-x-100" : "scale-x-0"
            )}
          />
          {step === current && (
            <span className="animate-sheen absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-gilt/70 to-transparent motion-reduce:hidden" />
          )}
        </span>
      ))}
    </div>
  )
}

// What the step is about, drawn from the live page: the wallets in this browser, the selected route's score and
// rate, the alert it would send
function StepPreview({ step, route, wallets, mobile }: { step: OnboardingStep; route: YieldRoute | null; wallets: Wallet[]; mobile: boolean }) {
  if (step === "wallet") {
    const order = [WalletReadyState.Installed, WalletReadyState.Loadable, WalletReadyState.NotDetected, WalletReadyState.Unsupported]
    const list = [...wallets].sort((a, b) => order.indexOf(a.readyState) - order.indexOf(b.readyState)).slice(0, 3)
    if (list.length === 0) return null
    return (
      <ul className="m-0 mt-3 list-none divide-y divide-row-line rounded-[4px] border border-hairline bg-plate p-0">
        {list.map((wallet) => (
          <li key={wallet.adapter.name} className="flex items-center gap-2.5 px-3 py-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- wallet icons are data URLs */}
            <img src={wallet.adapter.icon} alt="" className="size-5 rounded-[4px]" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
              {/* Android's way to any wallet app on the phone */}
              {wallet.adapter.name === "Mobile Wallet Adapter" ? "Your wallet app" : wallet.adapter.name}
            </span>
            <span
              className={cn(
                "shrink-0 text-[11px]",
                wallet.readyState === WalletReadyState.Installed ? "font-medium text-success" : "text-muted-foreground"
              )}
            >
              {wallet.readyState === WalletReadyState.Installed
                ? "Installed"
                : wallet.readyState === WalletReadyState.Loadable
                  ? mobile
                    ? "Opens the app"
                    : "Web wallet"
                  : "Not installed"}
            </span>
          </li>
        ))}
      </ul>
    )
  }

  if (!route) return null

  if (step === "safety") {
    if (!route.safety) return null
    const level = RISK_LEVELS.find((risk) => risk.value === route.risk)
    return (
      <div aria-hidden="true" className="mt-3 rounded-[4px] border border-hairline bg-plate px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-display text-[17px] font-bold">{route.name}</span>
          <span className="shrink-0">
            <span className={cn("font-roman text-[20px] font-bold", level?.text)}>{route.safety.score}</span>
            <span className="text-[11px] text-muted-foreground"> / 100</span>
          </span>
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-2">
          {route.safety.parts.map((part) => (
            <div key={part.key} className="flex min-w-0 flex-col gap-1">
              <span className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="truncate font-medium">{part.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {part.points}/{part.max}
                </span>
              </span>
              <span className="h-1 rounded-[1px] bg-hairline">
                <span className="block h-1 rounded-[1px] bg-foreground/60" style={{ width: `${(part.points / part.max) * 100}%` }} />
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (step === "deposit") {
    return (
      <div aria-hidden="true" className="mt-3 rounded-[4px] border border-hairline bg-plate px-3 py-2.5">
        <div className="flex items-center gap-3">
          <Medallion route={route} className="size-9 bg-card text-sm" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-display text-[18px] font-bold leading-tight">{route.name}</span>
            <span className="text-[11px] text-muted-foreground">
              {typeLabel(route)}
              {route.safety && ` · Safety ${route.safety.score}`}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end">
            <span className="font-roman text-[17px] font-bold leading-tight text-ink">{formatApy(route)}</span>
            <span className="text-[10px] text-muted-foreground">APY</span>
          </span>
        </div>
        {route.deposit === "beta" && !IS_DEVNET && route.depositCap != null && (
          <p className="mt-2 border-t border-hairline pt-2 text-[11px] text-muted-foreground">
            Up to {route.depositCap.toLocaleString()} {route.token} per deposit while Hermes is in beta.
          </p>
        )}
      </div>
    )
  }

  const kinds =
    route.category === "lending"
      ? "A rate drop, a better route, a reserve nearly all borrowed or a score under 80."
      : "A rate drop, a better route or a score under 80."
  return (
    <div aria-hidden="true" className="mt-3 flex gap-3 rounded-[12px] border border-hairline bg-card p-3 shadow-[0_14px_30px_-24px_rgba(43,20,14,0.7)]">
      <span className="grid size-9 shrink-0 place-items-center rounded-[9px] border border-hairline bg-background">
        <Image src={mark} alt="" className="h-[18px] w-auto" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="label-roman text-[10px]">Hermes</span>
        <span className="text-[13.5px] font-semibold leading-snug">Alerts for {route.name}</span>
        <span className="text-[12px] leading-snug text-muted-foreground">{kinds}</span>
      </span>
    </div>
  )
}

// Settings: how far the checklist got, and a way back to it after "Don't show again"
export function OnboardingSettings() {
  const [state, setState] = useState<OnboardingState | null>(null)
  useEffect(() => {
    const sync = () => setState(readOnboarding())
    sync()
    return onOnboardingChange(sync)
  }, [])
  if (!state) return null
  const doneCount = ONBOARDING_STEPS.filter((step) => state.done.includes(step)).length
  const allDone = doneCount === ONBOARDING_STEPS.length

  return (
    <div className="flex items-center justify-between gap-4 p-[18px] md:px-[22px]">
      <div>
        <div className="label-roman">Getting started</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {allDone ? "All four steps done." : `${doneCount} of ${ONBOARDING_STEPS.length} steps done.`}
        </div>
      </div>
      {!allDone && (
        <Link href="/app" onClick={showOnboardingAgain} className="btn-frame h-9 shrink-0 px-3.5 text-[13px]">
          Show checklist
        </Link>
      )}
    </div>
  )
}
