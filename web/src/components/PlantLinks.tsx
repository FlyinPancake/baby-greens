import { ExternalLink } from 'lucide-react'
import type { PlantLink } from '@/lib/api'
import { cn } from '@/lib/utils'

/** The server only accepts web links, but check again before putting one in an href. */
const isWebLink = (url: string) => /^https?:\/\//i.test(url)

export function PlantLinks({ links, className }: { links?: PlantLink[]; className?: string }) {
  const web = (links ?? []).filter((link) => isWebLink(link.url))
  if (web.length === 0) return null

  return (
    <ul className={cn('flex flex-wrap gap-2', className)}>
      {web.map((link, index) => (
        <li key={index} className="min-w-0">
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-base border-2 border-border bg-secondary-background px-2 py-1 text-sm font-heading underline decoration-2 underline-offset-2 hover:bg-main"
          >
            <span className="truncate">{link.label}</span>
            <ExternalLink className="size-3.5 shrink-0" />
          </a>
        </li>
      ))}
    </ul>
  )
}
