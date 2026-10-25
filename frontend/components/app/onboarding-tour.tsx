"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { ArrowLeft, ArrowRight, X } from "lucide-react"

import { cn } from "@/lib/utils"

// A guided tour of the real page, the way Titan walks you through its app: the page dims, the control in question
// stays lit, and a small card beside it says what it is. Controls are found by their data-tour name.

export interface TourStop {
  target: string // data-tour name. Phones and desktop render their own copy of some controls: the visible one is used.
  title: string
  text: string
  open?: boolean // open the <details> it points at
  link?: { href: string; label: string }
}

export function findTarget(name: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    if (element.getClientRects().length > 0) return element
  }
  return null
}

const MARGIN = 16 // from the screen's edges
const GAP = 12 // between the lit control and the card
const PAD = 6 // light around the control
const PHONE = 640 // below this the card sits at the bottom of the screen

type Box = { top: number; left: number; width: number; height: number }

// The newest callback without making effects start over when the parent renders
function useLatest<T>(value: T) {
  const ref = useRef(value)
  useLayoutEffect(() => {
    ref.current = value
  })
  return ref
}

interface TourProps {
  label: string // what the tour is about, for screen readers
  stops: TourStop[]
  onFinish: () => void
  onSkip: () => void
}

export function Tour({ label, stops: initialStops, onFinish, onSkip }: TourProps) {
  // The tour keeps the words it started with, so a rate refresh never moves it mid-way
  const [stops] = useState(initialStops)
  const finish = useLatest(onFinish)
  const skip = useLatest(onSkip)
  const [index, setIndex] = useState(0)
  const [spot, setSpot] = useState<Box | null>(null)
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const stop = stops[index]
  const last = index === stops.length - 1

  // Light the control and put the card where it fits: under it, over it, beside it, or (phones) at the bottom
  const measure = useCallback(() => {
    const target = findTarget(stop.target)
    const card = cardRef.current
    if (!target || !card) return
    const rect = target.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const box = { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
    const w = card.offsetWidth
    const h = card.offsetHeight
    const x = (left: number) => Math.min(Math.max(left, MARGIN), vw - MARGIN - w)
    const y = (top: number) => Math.min(Math.max(top, MARGIN), vh - MARGIN - h)
    const centerX = x(rect.left + rect.width / 2 - w / 2)
    const centerY = y(rect.top + rect.height / 2 - h / 2)
    setSpot(box)
    if (vw < PHONE) setPlace({ left: MARGIN, top: vh - MARGIN - h })
    else if (box.top + box.height + GAP + h <= vh - MARGIN) setPlace({ left: centerX, top: box.top + box.height + GAP })
    else if (box.top - GAP - h >= MARGIN) setPlace({ left: centerX, top: box.top - GAP - h })
    else if (box.left - GAP - w >= MARGIN) setPlace({ left: box.left - GAP - w, top: centerY })
    else if (box.left + box.width + GAP + w <= vw - MARGIN) setPlace({ left: box.left + box.width + GAP, top: centerY })
    else setPlace({ left: vw - MARGIN - w, top: vh - MARGIN - h })
  }, [stop])

  // Each stop scrolls its control into the room the card leaves, below the sticky header
  useEffect(() => {
    const target = findTarget(stop.target)
    if (!target) {
      // A control that isn't on the page right now (rates still loading) is passed over
      if (last) finish.current()
      else setIndex((i) => i + 1)
      return
    }
    if (stop.open && target instanceof HTMLDetailsElement) target.open = true
    const header = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0
    const cardHeight = cardRef.current?.offsetHeight ?? 220
    const roomTop = Math.max(header, 0) + MARGIN
    const roomBottom = window.innerHeight - (window.innerWidth < PHONE ? cardHeight + MARGIN * 2 : MARGIN)
    const room = roomBottom - roomTop
    const rect = target.getBoundingClientRect()
    let delta = 0
    if (rect.top < roomTop || rect.bottom > roomBottom) {
      // Centred in the room, or its top lined up with the room's when it's taller
      delta = rect.height > room ? rect.top - roomTop : rect.top - (roomTop + (room - rect.height) / 2)
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: reduced ? "auto" : "smooth" })
    measure()
    const settle = setTimeout(measure, reduced ? 0 : 480)
    nextRef.current?.focus({ preventScroll: true })
    return () => clearTimeout(settle)
  }, [stop, last, measure, finish])

  // Follow the page as it scrolls or resizes
  useEffect(() => {
    let frame = 0
    const follow = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    window.addEventListener("scroll", follow, { passive: true })
    window.addEventListener("resize", follow)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("scroll", follow)
      window.removeEventListener("resize", follow)
    }
  }, [measure])

  // The card's size changes with its text: measure again once it has rendered
  useLayoutEffect(() => {
    measure()
  }, [measure])

  // Escape skips. Tab stays inside the card while the page is dimmed.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        skip.current()
      } else if (event.key === "Tab" && cardRef.current) {
        const focusable = [...cardRef.current.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)")]
        const first = focusable[0]
        const lastItem = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          lastItem?.focus()
        } else if (!event.shiftKey && document.activeElement === lastItem) {
          event.preventDefault()
          first?.focus()
        } else if (!cardRef.current.contains(document.activeElement)) {
          event.preventDefault()
          first?.focus()
        }
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [skip])

  return createPortal(
    <div className="fixed inset-0 z-[70]">
      {/* The page stays dimmed and out of reach while the tour runs. The light's shadow does the dimming. */}
      <div className={cn("absolute inset-0", !spot && "bg-[rgba(22,11,8,0.62)]")} />
      {spot && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-[8px] ring-2 ring-[var(--frame)] transition-[top,left,width,height] duration-300 ease-out motion-reduce:transition-none"
          style={{ ...spot, boxShadow: "0 0 0 9999px rgba(22, 11, 8, 0.62), 0 0 0 6px rgba(242, 197, 133, 0.18)" }}
        />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-describedby="tour-text"
        className={cn(
          "absolute w-[min(360px,calc(100vw-32px))] rounded-[4px] border border-gilt bg-card p-[5px] shadow-[0_24px_60px_-20px_rgba(0,0,0,0.55)] transition-[top,left] duration-300 ease-out motion-reduce:transition-none",
          !place && "invisible"
        )}
        style={place ?? { top: 0, left: 0 }}
      >
        <div key={index} className="plaque-inner animate-in fade-in-0 p-4 duration-300 motion-reduce:animate-none">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-display text-[22px] font-bold leading-tight">{stop.title}</h2>
            <button
              type="button"
              onClick={() => skip.current()}
              className="-mr-1 -mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-[2px] px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Skip
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
          <p id="tour-text" className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
            {stop.text}
          </p>
          {stop.link && (
            <Link href={stop.link.href} className="mt-2 inline-block text-[13px] font-medium text-ink underline underline-offset-2">
              {stop.link.label}
            </Link>
          )}

          <div className="mt-4 flex gap-1" aria-hidden="true">
            {stops.map((_, i) => (
              <span key={i} className={cn("h-[3px] flex-1 rounded-full transition-colors", i <= index ? "bg-gilt" : "bg-hairline")} />
            ))}
          </div>

          <div className="mt-3.5 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setIndex((i) => i - 1)}
              disabled={index === 0}
              className="btn-frame h-9 px-3 text-[13px] disabled:invisible"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              Back
            </button>
            <span className="text-xs font-medium tabular-nums text-muted-foreground">
              {index + 1} / {stops.length}
            </span>
            <button
              ref={nextRef}
              type="button"
              onClick={() => (last ? finish.current() : setIndex((i) => i + 1))}
              className="btn-teal h-9 px-4 text-[13px]"
            >
              {last ? "Done" : "Next"}
              {!last && <ArrowRight className="size-3.5" aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
