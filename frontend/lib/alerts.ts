// lib/alerts.ts: phone alerts through the browser's push notifications

import { getFullUrl } from "./api/yield-api"

const WATCHED_KEY = "hermes.alerts.routes"
const HELD_KEY = "hermes.alerts.held" // the routes the wallet holds, from Portfolio
const FOLLOW_KEY = "hermes.alerts.positions" // "1" while this device follows the wallet's positions
const TELEGRAM_KEY = "hermes.alerts.telegram" // the link token Herald knows this device by

export type AlertsSupport = "supported" | "needs-home-screen" | "unsupported"

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
}

// iPhones and iPads only allow web push for sites added to the Home Screen (iOS 16.4 and later)
export function alertsSupport(): AlertsSupport {
  if (typeof window === "undefined") return "unsupported"
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true
  if (isIos() && !standalone) return "needs-home-screen"
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported"
  return "supported"
}

export type Platform = "android" | "iphone" | "firefox" | "mac-safari" | "desktop"

// Which steps to show for allowing notifications: each browser hides the setting in a different place
export function platform(): Platform {
  if (typeof navigator === "undefined") return "desktop"
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) return "android"
  if (isIos()) return "iphone"
  if (/Firefox\//.test(ua)) return "firefox"
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua)) return "mac-safari"
  return "desktop"
}

export function notificationPermission(): NotificationPermission | null {
  return typeof window !== "undefined" && "Notification" in window ? Notification.permission : null
}

/**
 * Ask the browser to allow notifications. Call it first thing in a tap handler, before any other await:
 * Safari only asks from a tap, and Chrome may hide the prompt or show a quiet one when the tap is lost.
 */
export function askPermission(): Promise<NotificationPermission> {
  return Notification.requestPermission()
}

// blocked: the browser refuses notifications for Hermes, so the user has to allow them in its settings
export class AlertsError extends Error {
  blocked: boolean
  constructor(message: string, blocked = false) {
    super(message)
    this.blocked = blocked
  }
}

function readList(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]")
    return Array.isArray(value) ? value.filter((id) => typeof id === "string") : []
  } catch {
    return []
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Private mode: the server still has the lists
  }
}

export const readWatched = () => readList(WATCHED_KEY)
export const readHeld = () => readList(HELD_KEY)

export function readFollowing(): boolean {
  try {
    return localStorage.getItem(FOLLOW_KEY) === "1"
  } catch {
    return false
  }
}

export function writeFollowing(on: boolean) {
  write(FOLLOW_KEY, on ? "1" : null)
}

export function readTelegramToken(): string | null {
  try {
    return localStorage.getItem(TELEGRAM_KEY)
  } catch {
    return null
  }
}

export interface AlertLists {
  routes: string[] // routes this device watches
  held: string[] // routes its wallet holds
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
 * Send this device's lists to every channel it has: its push subscription and its Telegram link.
 * Returns the lists Hermes now keeps.
 */
export async function saveAlerts(lists: AlertLists): Promise<AlertLists> {
  let saved = lists
  const subscription = await currentSubscription()
  if (subscription) {
    const json = await post("/api/alerts/subscribe", { subscription: subscription.toJSON(), ...lists })
    saved = { routes: json.routes ?? lists.routes, held: json.held ?? lists.held }
  }
  const token = readTelegramToken()
  if (token) {
    const json = await post("/api/alerts/telegram", { token, ...lists })
    // Hermes no longer had the link: the new one waits to be opened in Telegram
    write(TELEGRAM_KEY, json.token)
    saved = { routes: json.routes ?? saved.routes, held: json.held ?? saved.held }
  }
  write(WATCHED_KEY, JSON.stringify(saved.routes))
  write(HELD_KEY, JSON.stringify(saved.held))
  return saved
}

/**
 * Turn on this browser's notifications for these lists. Asks for notification permission and subscribes the
 * device the first time. Returns the lists Hermes now keeps.
 */
export async function watchRoutes(lists: AlertLists): Promise<AlertLists> {
  const routes = [...lists.routes, ...lists.held]
  // Ask before any other await, so the prompt still counts as coming from the tap
  if (routes.length > 0 && Notification.permission !== "granted" && (await askPermission()) !== "granted") {
    throw new AlertsError("Notifications are blocked for Hermes in this browser.", true)
  }
  let subscription = await currentSubscription()
  if (!subscription) {
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
      if (blocked) throw new AlertsError("This browser won't allow alerts here. Private tabs can't get alerts.", true)
      throw new AlertsError(
        (navigator as any).brave
          ? "Brave needs Google push on: Settings, Privacy and security, Use Google services for push messaging. Then try again."
          : "This browser couldn't turn on alerts. Try again, or use Chrome on Android."
      )
    }
  }
  return saveAlerts(lists)
}

// ---------- Telegram ----------

export interface TelegramLink {
  token: string
  url: string // opens Herald in Telegram with the token
  linked: boolean
}

/**
 * Start (or refresh) this device's Telegram link with these lists. The user opens the link in Telegram and Herald
 * ties their chat to it.
 */
export async function startTelegramLink(lists: AlertLists): Promise<TelegramLink> {
  const json = await post("/api/alerts/telegram", { token: readTelegramToken(), ...lists })
  write(TELEGRAM_KEY, json.token)
  return { token: json.token, url: json.url, linked: !!json.linked }
}

// Whether the link has been opened in Telegram. Null when Hermes can't say right now.
export async function telegramLinked(token: string): Promise<boolean | null> {
  const res = await fetch(getFullUrl(`/api/alerts/telegram/${token}`), { cache: "no-store" }).catch(() => null)
  const json = await res?.json().catch(() => null)
  return res?.ok && json?.success ? !!json.linked : null
}

export async function unlinkTelegram(): Promise<void> {
  const token = readTelegramToken()
  if (token) await post("/api/alerts/telegram/unlink", { token }).catch(() => {})
  write(TELEGRAM_KEY, null)
}

// Turn alerts off on this device: Hermes forgets its push subscription and its Telegram link and sends nothing more
export async function turnOffAlerts(): Promise<void> {
  const subscription = await currentSubscription()
  if (subscription) {
    await post("/api/alerts/unsubscribe", { endpoint: subscription.endpoint }).catch(() => {})
    await subscription.unsubscribe().catch(() => {})
  }
  await unlinkTelegram()
  write(WATCHED_KEY, null)
  write(HELD_KEY, null)
  writeFollowing(false)
}

// Turn off this browser's notifications only. Telegram keeps going.
export async function turnOffPush(): Promise<void> {
  const subscription = await currentSubscription()
  if (!subscription) return
  await post("/api/alerts/unsubscribe", { endpoint: subscription.endpoint }).catch(() => {})
  await subscription.unsubscribe().catch(() => {})
}
