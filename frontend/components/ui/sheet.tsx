'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

// A bottom sheet for phones, or a pane from the right (full screen on phones), built on the same Radix dialog as
// the centered dialogs
const Sheet = DialogPrimitive.Root
const SheetTitle = DialogPrimitive.Title
const SheetDescription = DialogPrimitive.Description

const SIDES = {
  bottom:
    'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 max-h-[85dvh] rounded-t-[18px] border-t pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_40px_rgba(0,0,0,0.3)]',
  right:
    'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-dvh w-full border-l pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-[-12px_0_40px_rgba(0,0,0,0.3)] sm:max-w-[420px]',
}

function SheetContent({
  className,
  children,
  side = 'bottom',
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { side?: keyof typeof SIDES }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-[rgba(43,20,14,0.6)]" />
      <DialogPrimitive.Content
        className={cn(
          'data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col border-gilt bg-card duration-200 outline-none',
          SIDES[side],
          className,
        )}
        {...props}
      >
        {side === 'bottom' && <div aria-hidden="true" className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-frame" />}
        {children}
        <DialogPrimitive.Close className="absolute right-3 top-3 grid size-11 place-items-center rounded-[4px] text-muted-foreground">
          <XIcon className="size-[18px]" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export { Sheet, SheetContent, SheetDescription, SheetTitle }
