import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ThemeToggle } from "./ThemeToggle"

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm gap-0 rounded-[4px] border-gilt bg-card p-[5px] sm:max-w-sm [&>[data-slot=dialog-close]]:right-5 [&>[data-slot=dialog-close]]:top-5">
        <div className="plaque-inner">
          <DialogHeader className="border-b border-hairline p-[18px] pb-3.5 pr-12 text-left">
            <DialogTitle className="font-display text-[26px] font-bold leading-[1.1]">Settings</DialogTitle>
            <DialogDescription className="sr-only">Choose how Hermes looks.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-4 p-[18px]">
            <div>
              <div className="label-roman">Theme</div>
              <div className="mt-1 text-xs text-muted-foreground">Aurora is the default.</div>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
