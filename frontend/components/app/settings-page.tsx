"use client"

import { ThemeToggle } from "./ThemeToggle"
import { AlertsSettings } from "./alerts"
import { OnboardingSettings } from "./onboarding"

// Settings: how Hermes looks, whether this device gets alerts, and the Getting started checklist
export function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-[640px] px-4 py-6 md:px-8 md:py-10">
      <section className="plaque">
        <div className="plaque-inner">
          <h1 className="border-b border-hairline p-[18px] font-display text-[28px] font-bold leading-[1.1] md:px-[22px]">Settings</h1>
          <div className="flex items-center justify-between gap-4 p-[18px] md:px-[22px]">
            <div>
              <div className="label-roman">Theme</div>
              <div className="mt-1 text-xs text-muted-foreground">Aurora is the default.</div>
            </div>
            <ThemeToggle />
          </div>
          <div className="border-t border-hairline md:px-1">
            <AlertsSettings />
          </div>
          <div className="border-t border-hairline">
            <OnboardingSettings />
          </div>
        </div>
      </section>
    </div>
  )
}
