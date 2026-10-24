'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

// A bottom sheet for phones, built on the same Radix dialog as the centered dialogs
const Sheet = DialogPrimitive.Root
const SheetTitle = DialogPrimitive.Title
const SheetDescription = DialogPrimitive.Description

function SheetContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-[rgba(43,20,14,0.6)]" />
      <DialogPrimitive.Content
        className={cn(
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-[18px] border-t border-gilt bg-card pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_40px_rgba(0,0,0,0.3)] duration-200 outline-none',
          className,
        )}
        {...props}
      >
        <div aria-hidden="true" className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-frame" />
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
