// lib/alerts.ts: phone alerts through the browser's push notifications

import { getFullUrl } from "./api/yield-api"

const WATCHED_KEY = "hermes.alerts.routes"

export type AlertsSupport = "supported" | "needs-home-screen" | "unsupported"

// iPhones and iPads only allow web push for sites added to the Home Screen (iOS 16.4 and later)
export function alertsSupport(): AlertsSupport {
  if (typeof window === "undefined") return "unsupported"
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true
  if (ios && !standalone) return "needs-home-screen"
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported"
  return "supported"
}

export function readWatched(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(WATCHED_KEY) ?? "[]")
    return Array.isArray(value) ? value.filter((id) => typeof id === "string") : []
  } catch {
    return []
  }
}

function writeWatched(routes: string[]) {
  try {
    localStorage.setItem(WATCHED_KEY, JSON.stringify(routes))
  } catch {
    // Private mode: the server still has the list
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4)
  const raw = window.atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"))
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(getFullUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json?.success) throw new Error(json?.error || "Hermes could not update alerts. Try again shortly.")
  return json
}

export async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
}

// This device's push subscription, if alerts are on
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (alertsSupport() !== "supported") return null
  const reg = await navigator.serviceWorker.getRegistration("/")
  return (await reg?.pushManager.getSubscription()) ?? null
}

/**
 * Watch these routes. Asks for notification permission and subscribes the device the first time.
 * Returns the routes Hermes now watches for this device.
 */
export async function watchRoutes(routes: string[]): Promise<string[]> {
  let subscription = await currentSubscription()
  if (!subscription) {
    const permission = await Notification.requestPermission()
    if (permission !== "granted") throw new Error("Notifications are blocked. Allow them for Hermes in your browser settings.")
    const keyRes = await fetch(getFullUrl("/api/alerts/key"))
    const key = await keyRes.json().catch(() => ({}))
    if (!keyRes.ok || !key?.publicKey) throw new Error(key?.error || "Alerts are off right now.")
    try {
      const reg = await registration()
      await navigator.serviceWorker.ready
      subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key.publicKey) })
    } catch (error) {
      // Browsers word these differently. Private windows and some browsers refuse push altogether.
      const blocked = error instanceof DOMException && (error.name === "NotAllowedError" || /permission/i.test(error.message))
      throw new Error(
        blocked
          ? "This browser won't allow alerts here. Allow notifications for Hermes in its settings, or try Chrome outside a private window."
          : "This browser couldn't turn on alerts. Try again, or use Chrome on Android."
      )
    }
  }
  const json = await post("/api/alerts/subscribe", { subscription: subscription.toJSON(), routes })
  const watched: string[] = Array.isArray(json.routes) ? json.routes : routes
  writeWatched(watched)
  return watched
}

// Turn alerts off on this device: Hermes forgets it and sends nothing more
export async function turnOffAlerts(): Promise<void> {
  const subscription = await currentSubscription()
  if (subscription) {
    await post("/api/alerts/unsubscribe", { endpoint: subscription.endpoint }).catch(() => {})
    await subscription.unsubscribe().catch(() => {})
  }
  writeWatched([])
}
