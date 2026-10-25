"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useWallet } from "@solana/wallet-adapter-react"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"
import type { YieldRoute } from "@/lib/api/yield-api"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import {
  ONBOARDING_STEPS,
  closeForThisVisit,
  closedThisVisit,
  hideOnboarding,
  markStep,
  onOnboardingChange,
  readOnboarding,
  showOnboardingAgain,
  type OnboardingState,
  type OnboardingStep,
} from "@/lib/onboarding"
import { useAlerts } from "./alerts"

// Getting started (owner's call, 25 Oct; Gloam's checklist is the reference): four steps to a first deposit, shown
// when someone opens /app until they're done, closed for the visit or hidden for good. Each step's Go starts the
// real action. Connecting a wallet, a deposit and alerts mark their steps by themselves.

const STEPS: Record<OnboardingStep, { title: string; text: string }> = {
  wallet: {
    title: "Connect your wallet",
    text: "Hermes builds each deposit for you to sign in your own wallet. It never sees your keys.",
  },
  safety: {
    title: "Read the Safety Score",
    text: "Every route scores 0 to 100 from live data. Top rated routes score 80 or more.",
  },
  deposit: {
    title: "Make a small deposit",
    text: "Pick a route, type an amount and sign. These are real funds, so start small.",
  },
  alerts: {
    title: "Turn on alerts",
    text: "Get a phone alert when a rate drops or a better route opens.",
  },
}

interface OnboardingProps {
  route: YieldRoute | null // the selected route, which the alerts step watches
  onConnect: () => void
  onDeposit: () => void // brings the amount box into view
}

export function Onboarding({ route, onConnect, onDeposit }: OnboardingProps) {
  const { connected } = useWallet()
  const { enabled, watched, toggle } = useAlerts()
  // Read in the browser after the first render, so the server and the browser render the same page
  const [state, setState] = useState<OnboardingState | null>(null)
  const [open, setOpen] = useState(false)
  // Connecting a wallet brings the checklist back with the next step
  const [waitingForWallet, setWaitingForWallet] = useState(false)

  useEffect(() => {
    const sync = () => setState(readOnboarding())
    sync()
    setOpen(!closedThisVisit())
    return onOnboardingChange(sync)
  }, [])

  useEffect(() => {
    if (connected) markStep("wallet")
  }, [connected])
  useEffect(() => {
    if (enabled && watched.length > 0) markStep("alerts")
  }, [enabled, watched.length])

  useEffect(() => {
    if (!waitingForWallet || !connected) return
    setWaitingForWallet(false)
    const timer = setTimeout(() => setOpen(true), 400)
    return () => clearTimeout(timer)
  }, [waitingForWallet, connected])

  if (!state || state.hidden) return null
  const current = ONBOARDING_STEPS.find((step) => !state.done.includes(step))
  if (!current) return null
  const doneCount = ONBOARDING_STEPS.length - ONBOARDING_STEPS.filter((step) => !state.done.includes(step)).length

  const close = () => {
    closeForThisVisit()
    setOpen(false)
  }

  // Each Go steps aside for the action it starts
  const go = (step: OnboardingStep) => {
    setOpen(false)
    if (step === "wallet") {
      setWaitingForWallet(true)
      onConnect()
    } else if (step === "deposit") {
      onDeposit()
    } else if (step === "alerts") {
      if (route && !watched.includes(route.id)) void toggle(route)
      else markStep("alerts")
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogContent
        // The card itself takes focus on open, so no step looks picked. On close, focus goes where the step's action
        // sends it, not back to the page.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          ;(event.currentTarget as HTMLElement | null)?.focus?.()
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
        className="max-w-[452px] gap-0 rounded-[4px] border-gilt bg-card p-[5px] focus-visible:outline-none sm:max-w-[452px] [&>[data-slot=dialog-close]]:right-5 [&>[data-slot=dialog-close]]:top-5"
      >
        <div className="plaque-inner max-h-[calc(100dvh-4rem)] overflow-y-auto">
          <div className="border-b border-hairline p-[18px] pb-5 pr-12">
            <p className="label-roman">
              {doneCount} of {ONBOARDING_STEPS.length} done
            </p>
            <DialogTitle className="mt-2.5 font-display text-[32px] font-bold leading-[1.05]">Getting started</DialogTitle>
            <DialogDescription className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              Four steps to your first deposit. Each takes a minute.
            </DialogDescription>
            <div
              role="progressbar"
              aria-label="Steps done"
              aria-valuemin={0}
              aria-valuemax={ONBOARDING_STEPS.length}
              aria-valuenow={doneCount}
              className="mt-5 h-1 overflow-hidden rounded-full bg-hairline"
            >
              <div
                className="h-full rounded-full bg-gilt transition-[width] duration-500"
                style={{ width: `${(doneCount / ONBOARDING_STEPS.length) * 100}%` }}
              />
            </div>
          </div>

          <ol className="m-0 list-none px-[18px] py-0">
            {ONBOARDING_STEPS.map((step, index) => {
              const done = state.done.includes(step)
              const active = step === current
              return (
                <li key={step} className={cn("flex items-start gap-3.5 py-4", index > 0 && "border-t border-hairline")}>
                  <span
                    aria-hidden="true"
                    className={cn(
                      // Inter, not Cinzel, whose 1 reads as an I
                      "grid size-9 shrink-0 place-items-center rounded-full font-sans text-[13px] font-semibold tabular-nums",
                      done
                        ? "bg-success text-card"
                        : active
                          ? "border-[1.5px] border-foreground text-foreground"
                          : "bg-secondary text-muted-foreground"
                    )}
                  >
                    {done ? <Check className="size-4" strokeWidth={2.5} /> : index + 1}
                  </span>
                  <div className="min-w-0 flex-1 pt-1.5">
                    <p className={cn("text-[15px] font-semibold leading-snug", done && "text-muted-foreground line-through decoration-frame")}>
                      {STEPS[step].title}
                      {done && <span className="sr-only">, done</span>}
                    </p>
                    {active && (
                      <>
                        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{STEPS[step].text}</p>
                        <button
                          type="button"
                          onClick={() => markStep(step)}
                          className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        >
                          Mark done
                        </button>
                      </>
                    )}
                  </div>
                  {active ? (
                    step === "safety" ? (
                      <Link
                        href="/docs#safety-score"
                        onClick={() => markStep("safety")}
                        className="btn-teal mt-0.5 h-10 shrink-0 px-5 text-sm"
                      >
                        Go
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => go(step)}
                        disabled={step === "alerts" && !route}
                        className="btn-teal mt-0.5 h-10 shrink-0 px-5 text-sm"
                      >
                        Go
                      </button>
                    )
                  ) : (
                    !done && (
                      <button
                        type="button"
                        onClick={() => markStep(step)}
                        className="mt-1.5 shrink-0 text-[13px] text-muted-foreground hover:text-foreground"
                      >
                        Mark done
                      </button>
                    )
                  )}
                </li>
              )
            })}
          </ol>

          <div className="flex items-center justify-between gap-3 border-t border-hairline p-[18px]">
            <button
              type="button"
              onClick={() => {
                hideOnboarding()
                setOpen(false)
              }}
              className="text-[13px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Don&apos;t show again
            </button>
            <button type="button" onClick={close} className="btn-frame h-10 px-5 text-sm">
              Close
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
