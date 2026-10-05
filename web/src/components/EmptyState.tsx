import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon
  title: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-base border-2 border-dashed border-border px-4 py-8 text-center">
      <span className="grid size-14 -rotate-6 place-items-center rounded-base border-2 border-border bg-main shadow-shadow">
        <Icon className="size-7" />
      </span>
      <p className="font-heading text-lg">{title}</p>
      {children && <div className="text-sm">{children}</div>}
    </div>
  )
}
