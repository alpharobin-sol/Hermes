import Image from "next/image"

export function AppFooter() {
  return (
    <footer className="w-full">
      <div className="container max-w-7xl mx-auto flex items-center justify-between gap-3 py-4 px-4 sm:px-6">
        
        {/* Left side - Logo, Copyright */}
        <div className="flex items-center gap-4">
          {/* Logo and Copyright */}
          <div className="flex items-center gap-x-3 sm:gap-x-4">
            <Image
              alt="hermes footer logo"
              src="/brand/hermes-icon-light-32x32.png"
              width={15}
              height={20}
            />

            <p className="text-body text-[10px] uppercase tracking-wider text-muted-foreground">
              © {new Date().getFullYear()}
            </p>
          </div>
        </div>

        {/* Right side - Social Links */}
        <ul className="flex items-center gap-2">
          <li>
            <a
              className="grid size-8 place-items-center border border-border/50 text-muted-foreground hover:text-foreground hover:border-primary/50 transition-all duration-200 rounded-sm"
              href="https://x.com/Hermes_agg"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg fill="none" height="14" viewBox="0 0 20 20" width="14" xmlns="http://www.w3.org/2000/svg">
                <path d="M15.2719 1.58643H18.0832L11.9415 8.606L19.1667 18.1581H13.5094L9.0784 12.3648L4.00833 18.1581H1.1954L7.76457 10.6498L0.833374 1.58643H6.6343L10.6395 6.8817L15.2719 1.58643ZM14.2853 16.4754H15.843L5.78787 3.1807H4.11626L14.2853 16.4754Z" fill="currentColor" />
              </svg>
            </a>
          </li>
        </ul>
      </div>
    </footer>
  )
}
