// The Getting started checklist on /app: which steps this device has done, and whether it's hidden. Kept in the
// browser as a convenience per device. Without storage (private mode) the checklist shows with nothing done.

export type OnboardingStep = "wallet" | "safety" | "deposit" | "alerts"

export const ONBOARDING_STEPS: OnboardingStep[] = ["wallet", "safety", "deposit", "alerts"]

const KEY = "hermes.onboarding"
const CLOSED_KEY = "hermes.onboarding.closed" // closed for this visit, in sessionStorage
const EVENT = "hermes:onboarding"

export interface OnboardingState {
  done: OnboardingStep[]
  hidden: boolean // "Don't show again"
  welcomed: boolean // past the welcome card, so the checklist opens straight away
}

export function readOnboarding(): OnboardingState {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}")
    const done = Array.isArray(saved.done) ? saved.done.filter((step: unknown) => ONBOARDING_STEPS.includes(step as OnboardingStep)) : []
    return { done, hidden: saved.hidden === true, welcomed: saved.welcomed === true }
  } catch {
    return { done: [], hidden: false, welcomed: false }
  }
}

function write(state: OnboardingState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // Private mode: the checklist forgets on reload
  }
  window.dispatchEvent(new Event(EVENT))
}

export function markStep(step: OnboardingStep) {
  const state = readOnboarding()
  if (!state.done.includes(step)) write({ ...state, done: [...state.done, step] })
}

export function markWelcomed() {
  const state = readOnboarding()
  if (!state.welcomed) write({ ...state, welcomed: true })
}

export function hideOnboarding() {
  write({ ...readOnboarding(), hidden: true })
}

// Settings: bring the checklist back after "Don't show again"
export function showOnboardingAgain() {
  try {
    sessionStorage.removeItem(CLOSED_KEY)
  } catch {
    // Nothing to clear
  }
  write({ ...readOnboarding(), hidden: false })
}

export function closedThisVisit(): boolean {
  try {
    return sessionStorage.getItem(CLOSED_KEY) === "1"
  } catch {
    return false
  }
}

export function closeForThisVisit() {
  try {
    sessionStorage.setItem(CLOSED_KEY, "1")
  } catch {
    // Without storage it closes until the page reloads
  }
}

export function onOnboardingChange(listener: () => void): () => void {
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}

// ---------- How long each step takes ----------
// Rough seconds, worked out from what this device has: a wallet already installed, whether the browser can show
// alerts, and the words the Safety Score tour asks you to read.

export type WalletReadiness = "installed" | "app" | "none" // an extension in this browser, a wallet app to open, nothing yet

export const WALLET_SECONDS: Record<WalletReadiness, number> = {
  installed: 20, // pick it, approve the connection
  app: 45, // the wallet app opens, approve, come back
  none: 300, // install a wallet and write down its recovery phrase
}

// Type an amount and compare quotes (15), review the deposit (20), sign in the wallet (15), the network confirms (10)
export const DEPOSIT_SECONDS = 15 + 20 + 15 + 10

export type AlertsReadiness = "granted" | "ask" | "blocked" | "home-screen" | "unsupported"

export const ALERTS_SECONDS: Record<AlertsReadiness, number> = {
  granted: 10, // notifications already allowed: one tap
  ask: 20, // tap, then allow the browser's prompt
  blocked: 60, // allow notifications again in the browser's settings
  "home-screen": 120, // iPhone: add Hermes to the Home Screen, open it from there, allow
  unsupported: 60, // open Hermes in a browser that shows alerts
}

// About 200 words a minute, plus a few seconds to move from one stop to the next
export function readingSeconds(texts: string[]): number {
  const words = texts.join(" ").split(/\s+/).filter(Boolean).length
  return (words / 200) * 60 + texts.length * 4
}

// "20 sec" under a minute (in fives), whole minutes above
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(5, Math.ceil(seconds / 5) * 5)} sec`
  return `${Math.round(seconds / 60)} min`
}

// What's left, said plainly: "Under a minute left", "About 3 min left"
export function formatTimeLeft(seconds: number): string {
  return seconds < 60 ? "Under a minute left" : `About ${Math.round(seconds / 60)} min left`
}
