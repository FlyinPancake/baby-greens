import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type SegmentedOption<T extends string> = { value: T; label: string; icon?: LucideIcon }

/** A row of buttons where one is chosen, like radio buttons. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string
  value: T | null
  options: SegmentedOption<T>[]
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex flex-wrap gap-2', className)}>
      {options.map((option) => {
        const checked = option.value === value
        const Icon = option.icon
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex items-center gap-1.5 rounded-base border-2 border-border px-3 py-1.5 text-sm font-heading transition-all',
              checked
                ? 'bg-main shadow-shadow'
                : 'bg-secondary-background hover:-translate-y-0.5 hover:bg-main/40',
            )}
          >
            {Icon && <Icon className="size-4" />}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
