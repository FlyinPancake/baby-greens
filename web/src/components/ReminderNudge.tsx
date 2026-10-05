import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { enablePush, pushState } from '@/lib/push'
import { ErrorAlert } from './ErrorAlert'

const dismissedKey = 'baby-greens:reminder-nudge-dismissed'

/** Offers reminders on devices that support them but haven't turned them on. */
export function ReminderNudge() {
  const queryClient = useQueryClient()
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(dismissedKey) === 'yes')
  const state = useQuery({ queryKey: ['push-state'], queryFn: pushState, enabled: !dismissed })
  const turnOn = useMutation({
    mutationFn: enablePush,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['push-state'] }),
  })

  if (dismissed || state.data?.kind !== 'off') return null

  function dismiss() {
    localStorage.setItem(dismissedKey, 'yes')
    setDismissed(true)
  }

  return (
    <section className="flex flex-col gap-3 rounded-base border-2 border-border bg-due p-4 shadow-shadow">
      <div className="flex items-start gap-3">
        <Bell className="mt-0.5 size-5 shrink-0" />
        <p className="flex-1 font-heading">
          Get a reminder on this device when it's time to rinse, water, or harvest.
        </p>
        <button type="button" onClick={dismiss} aria-label="Not now" className="shrink-0">
          <X className="size-5" />
        </button>
      </div>
      <ErrorAlert error={turnOn.error} />
      <div>
        <Button variant="neutral" onClick={() => turnOn.mutate()} disabled={turnOn.isPending}>
          Turn on reminders
        </Button>
      </div>
    </section>
  )
}
