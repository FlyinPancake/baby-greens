import { CloudOff, LogIn, RefreshCw, TriangleAlert, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { loginUrl } from '@/lib/api'
import { dismissDropped } from '@/lib/outbox'
import { useOnline, useOutbox } from '@/lib/useOutbox'
import { cn } from '@/lib/utils'

const changes = (count: number) => `${count} ${count === 1 ? 'change' : 'changes'}`

/** Tells you when you're offline, when changes are waiting, and when some couldn't be saved. */
export function SyncBanner() {
  const online = useOnline()
  const { entries, status, dropped } = useOutbox()
  const waiting = entries.length

  return (
    <>
      {!online ? (
        <Bar tone="bg-secondary-background" icon={CloudOff}>
          You're offline.{' '}
          {waiting > 0
            ? `${changes(waiting)} will sync when you're back.`
            : 'Showing what was loaded last. Ticks and snoozes still work.'}
        </Bar>
      ) : status === 'needs-login' && waiting > 0 ? (
        <Bar tone="bg-due" icon={LogIn}>
          <span className="flex-1">Sign in again to sync {changes(waiting)} made offline.</span>
          <Button
            size="sm"
            variant="neutral"
            nativeButton={false}
            render={<a href={loginUrl(window.location.pathname)} />}
          >
            Sign in
          </Button>
        </Bar>
      ) : waiting > 0 ? (
        <Bar tone="bg-secondary-background" icon={RefreshCw} spin>
          Syncing {changes(waiting)}...
        </Bar>
      ) : null}

      {dropped.length > 0 && (
        <Bar tone="bg-overdue" icon={TriangleAlert}>
          <span className="flex-1">
            {dropped.map((item) => `${item.label} wasn't saved: ${item.reason}.`).join(' ')}
          </span>
          <button type="button" onClick={dismissDropped} aria-label="Dismiss">
            <X className="size-5" />
          </button>
        </Bar>
      )}
    </>
  )
}

function Bar({
  tone,
  icon: Icon,
  spin = false,
  children,
}: {
  tone: string
  icon: typeof CloudOff
  spin?: boolean
  children: ReactNode
}) {
  return (
    <div role="status" className={cn('border-b-2 border-border', tone)}>
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2 text-sm font-heading">
        <Icon className={cn('size-4 shrink-0', spin && 'animate-spin motion-reduce:animate-none')} />
        {children}
      </div>
    </div>
  )
}
