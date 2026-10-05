import { Check, Plus } from 'lucide-react'
import type { Container } from '@/lib/api'
import { colorName, containerColors, contrastOn } from '@/lib/colors'
import { containerIcons } from '@/lib/icons'
import { cn } from '@/lib/utils'

/** A small round swatch. Clear containers get a hollow ring. */
export function ColorDot({ color, className }: { color: string | null | undefined; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-3 shrink-0 rounded-full border-2 border-border', className)}
      style={{ background: color ?? 'transparent' }}
    />
  )
}

/** A container's icon on a tile in its colour. */
export function ContainerTile({
  container,
  className,
  iconClassName = 'size-5',
}: {
  container: Pick<Container, 'kind' | 'color' | 'occupant'>
  className?: string
  iconClassName?: string
}) {
  const Icon = containerIcons[container.kind]
  const background = container.color ?? (container.occupant ? 'var(--main)' : 'var(--background)')
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-base border-2 border-border',
        className,
      )}
      style={{ background, color: container.color ? contrastOn(container.color) : undefined }}
    >
      <Icon className={iconClassName} />
    </span>
  )
}

/** Swatches for the common colours, a custom colour, and none. */
export function ColorPicker({
  value,
  onChange,
}: {
  value: string | null
  onChange: (color: string | null) => void
}) {
  const custom = value != null && !containerColors.some((color) => color.hex === value)

  return (
    <div role="radiogroup" aria-label="Colour" className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        role="radio"
        aria-checked={value == null}
        aria-label="No colour"
        title="No colour (clear)"
        onClick={() => onChange(null)}
        className={cn(
          'relative size-8 overflow-hidden rounded-full border-2 border-border bg-secondary-background',
          value == null && 'ring-2 ring-border ring-offset-2',
        )}
      >
        {/* A diagonal line, the usual "none" mark. */}
        <span className="absolute top-1/2 left-1/2 h-0.5 w-9 -translate-1/2 -rotate-45 bg-border" />
      </button>
      {containerColors.map((color) => (
        <button
          key={color.hex}
          type="button"
          role="radio"
          aria-checked={value === color.hex}
          aria-label={color.name}
          title={color.name}
          onClick={() => onChange(color.hex)}
          className={cn(
            'grid size-8 place-items-center rounded-full border-2 border-border transition-transform hover:scale-110',
            value === color.hex && 'ring-2 ring-border ring-offset-2',
          )}
          style={{ background: color.hex, color: contrastOn(color.hex) }}
        >
          {value === color.hex && <Check className="size-4" />}
        </button>
      ))}
      <label
        title="Custom colour"
        className={cn(
          'relative grid size-8 cursor-pointer place-items-center rounded-full border-2 border-border',
          custom && 'ring-2 ring-border ring-offset-2',
        )}
        style={{
          background: custom
            ? value
            : 'conic-gradient(#ef4444, #facc15, #22c55e, #3b82f6, #a855f7, #ef4444)',
        }}
      >
        <Plus className="size-4" style={{ color: custom && value ? contrastOn(value) : '#000000' }} />
        <input
          type="color"
          value={value ?? '#3b82f6'}
          onChange={(event) => onChange(event.target.value)}
          aria-label="Custom colour"
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      <span className="text-sm font-heading capitalize">{colorName(value)}</span>
    </div>
  )
}
