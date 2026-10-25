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
}

export function readOnboarding(): OnboardingState {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}")
    const done = Array.isArray(saved.done) ? saved.done.filter((step: unknown) => ONBOARDING_STEPS.includes(step as OnboardingStep)) : []
    return { done, hidden: saved.hidden === true }
  } catch {
    return { done: [], hidden: false }
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
