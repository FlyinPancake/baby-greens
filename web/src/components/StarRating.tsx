import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Five stars. With `onChange` they can be picked; without, they only show a rating. */
export function StarRating({
  value,
  onChange,
  size = 'size-6',
}: {
  value: number | null
  onChange?: (value: number | null) => void
  size?: string
}) {
  if (!onChange) {
    return (
      <span className="inline-flex" aria-label={value ? `${value} of 5 stars` : 'Not rated'}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            aria-hidden
            className={cn(size, value && star <= value ? 'fill-due' : 'opacity-30')}
          />
        ))}
      </span>
    )
  }

  return (
    <div role="radiogroup" aria-label="Rating" className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} ${star === 1 ? 'star' : 'stars'}`}
          // Tapping the current rating again clears it.
          onClick={() => onChange(value === star ? null : star)}
          className="rounded-base p-0.5 transition-transform hover:scale-110"
        >
          <Star className={cn(size, value && star <= value ? 'fill-due' : 'opacity-40')} />
        </button>
      ))}
    </div>
  )
}
