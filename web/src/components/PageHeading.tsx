import type { ReactNode } from 'react'

export function PageHeading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <h1 className="text-3xl tracking-tight sm:text-4xl">{children}</h1>
      {action}
    </div>
  )
}

/** A word in a heading set on a green, tilted block. */
export function Highlight({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block -rotate-1 rounded-base border-2 border-border bg-main px-2 shadow-shadow">
      {children}
    </span>
  )
}
