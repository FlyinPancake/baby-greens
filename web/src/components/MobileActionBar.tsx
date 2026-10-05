import type { ReactNode } from 'react'

/**
 * A bar pinned to the bottom of the screen on phones, so the main action is always in reach on
 * long pages. Hidden on wide screens, where the sidebar holds the same action. Pages that use it
 * need bottom padding so the bar doesn't cover their end.
 */
export function MobileActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-border bg-secondary-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">{children}</div>
    </div>
  )
}
