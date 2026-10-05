import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Bell, BellOff, Download, LogOut, MoonStar, Send, Smartphone } from 'lucide-react'
import { type FormEvent, type ReactNode, useState, useSyncExternalStore } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Highlight, PageHeading } from '@/components/PageHeading'
import { Segmented } from '@/components/Segmented'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { api, logout, type Me, meQuery, unwrap } from '@/lib/api'
import { canInstall, install, onInstallChange } from '@/lib/install'
import { disablePush, enablePush, type PushState, pushState } from '@/lib/push'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/settings')({
  component: Settings,
})

function Settings() {
  const me = useQuery(meQuery)

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeading>
        <Highlight>Settings</Highlight>
      </PageHeading>
      <Reminders />
      {me.data && <Schedule me={me.data} />}
      <InstallApp />
      {me.data && <Account me={me.data} />}
    </div>
  )
}

function Panel({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Bell
  title: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-4 rounded-base border-2 border-border bg-secondary-background p-5 shadow-shadow">
      <h2 className="flex items-center gap-3 text-xl">
        <span className="grid size-9 place-items-center rounded-base border-2 border-border bg-main">
          <Icon className="size-5" />
        </span>
        {title}
      </h2>
      {children}
    </section>
  )
}

const pushStateKey = ['push-state']

function Reminders() {
  const queryClient = useQueryClient()
  const state = useQuery({ queryKey: pushStateKey, queryFn: pushState })
  const refresh = () => queryClient.invalidateQueries({ queryKey: pushStateKey })

  const turnOn = useMutation({ mutationFn: enablePush, onSettled: refresh })
  const turnOff = useMutation({ mutationFn: disablePush, onSettled: refresh })
  const test = useMutation({ mutationFn: () => unwrap(api.POST('/push/test')) })

  return (
    <Panel icon={Bell} title="Reminders on this device">
      <p>
        Get a notification when it's time to rinse, water, or move a batch along, even with the
        app closed.
      </p>
      {state.isPending ? (
        <p className="font-heading">Checking this device...</p>
      ) : state.isError ? (
        <ErrorAlert error={state.error} />
      ) : (
        <PushStatus state={state.data} />
      )}

      <ErrorAlert error={turnOn.error ?? turnOff.error ?? test.error} />
      {test.data && (
        <Alert className="bg-main">
          <Send />
          <AlertDescription>
            {test.data.sent === 0
              ? 'No device got it. Turn reminders on first.'
              : `Sent to ${test.data.sent} ${test.data.sent === 1 ? 'device' : 'devices'}. It should appear in a few seconds.`}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        {state.data?.kind === 'off' && (
          <Button onClick={() => turnOn.mutate()} disabled={turnOn.isPending}>
            <Bell /> Turn on reminders
          </Button>
        )}
        {state.data?.kind === 'on' && (
          <>
            <Button onClick={() => test.mutate()} disabled={test.isPending}>
              <Send /> Send a test
            </Button>
            <Button variant="neutral" onClick={() => turnOff.mutate()} disabled={turnOff.isPending}>
              <BellOff /> Turn off on this device
            </Button>
          </>
        )}
      </div>
    </Panel>
  )
}

const pushMessages: Record<Exclude<PushState['kind'], 'unsupported'>, string> = {
  'needs-install':
    'On iPhone and iPad, reminders work once the app is on your home screen. Tap Share, then Add to Home Screen, and open it from there.',
  'server-off': 'Reminders are turned off on this server. Set VAPID_PRIVATE_KEY to turn them on.',
  denied:
    'Notifications are blocked for this site. Allow them in the browser settings, then reload.',
  off: 'Reminders are off on this device.',
  on: 'Reminders are on for this device.',
}

function PushStatus({ state }: { state: PushState }) {
  const message = state.kind === 'unsupported' ? state.reason : pushMessages[state.kind]
  return (
    <p
      className={cn(
        'w-fit rounded-base border-2 border-border px-3 py-1.5 text-sm font-heading',
        state.kind === 'on' ? 'bg-main' : state.kind === 'off' ? 'bg-background' : 'bg-due',
      )}
    >
      {message}
    </p>
  )
}

const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone

function timezones(current: string): string[] {
  const all = Intl.supportedValuesOf('timeZone')
  return all.includes(current) ? all : [current, ...all]
}

function Schedule({ me }: { me: Me }) {
  const queryClient = useQueryClient()
  const [timezone, setTimezone] = useState(me.timezone)
  const [quiet, setQuiet] = useState(me.quiet_hours != null)
  const [start, setStart] = useState(me.quiet_hours?.start ?? '22:00')
  const [end, setEnd] = useState(me.quiet_hours?.end ?? '07:00')

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.PATCH('/me', {
          body: { timezone, quiet_hours: quiet ? { start, end } : null },
        }),
      ),
    onSuccess: (user) => queryClient.setQueryData(meQuery.queryKey, user),
  })

  const dirty =
    timezone !== me.timezone ||
    quiet !== (me.quiet_hours != null) ||
    (quiet && (start !== me.quiet_hours?.start || end !== me.quiet_hours?.end))

  function submit(event: FormEvent) {
    event.preventDefault()
    save.mutate()
  }

  return (
    <Panel icon={MoonStar} title="Reminder schedule">
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label htmlFor="timezone" className="font-heading">
            Timezone
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              id="timezone"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              className="h-10 min-w-0 flex-1 rounded-base border-2 border-border bg-secondary-background px-3 text-sm"
            >
              {timezones(timezone).map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            {timezone !== deviceTimezone && (
              <Button type="button" variant="neutral" size="sm" onClick={() => setTimezone(deviceTimezone)}>
                Use {deviceTimezone.replace(/_/g, ' ')}
              </Button>
            )}
          </div>
          <p className="text-sm">Quiet hours and "today" follow this timezone.</p>
        </div>

        <div className="flex flex-col gap-2">
          <p className="font-heading">Quiet hours</p>
          <Segmented
            label="Quiet hours"
            value={quiet ? 'on' : 'off'}
            onChange={(value) => setQuiet(value === 'on')}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'on', label: 'On' },
            ]}
          />
          {quiet && (
            <div className="flex flex-wrap items-center gap-2 text-sm font-heading">
              <span>No reminders from</span>
              <input
                type="time"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                aria-label="Quiet hours start"
                className="h-9 rounded-base border-2 border-border bg-secondary-background px-2"
              />
              <span>to</span>
              <input
                type="time"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                aria-label="Quiet hours end"
                className="h-9 rounded-base border-2 border-border bg-secondary-background px-2"
              />
            </div>
          )}
          <p className="text-sm">
            Reminders that come due during quiet hours arrive when they end.
          </p>
        </div>

        <ErrorAlert error={save.error} />
        <div>
          <Button type="submit" disabled={!dirty || save.isPending}>
            {dirty ? 'Save schedule' : 'Saved'}
          </Button>
        </div>
      </form>
    </Panel>
  )
}

function useCanInstall(): boolean {
  return useSyncExternalStore(onInstallChange, canInstall)
}

function InstallApp() {
  const installable = useCanInstall()
  const standalone = window.matchMedia('(display-mode: standalone)').matches

  return (
    <Panel icon={Smartphone} title="Install the app">
      {standalone ? (
        <p>You're using the installed app.</p>
      ) : installable ? (
        <>
          <p>Install baby-greens to open it from your home screen or dock, like any other app.</p>
          <div>
            <Button onClick={() => void install()}>
              <Download /> Install
            </Button>
          </div>
        </>
      ) : (
        <p>
          Add baby-greens to your home screen from the browser menu. On iPhone and iPad, tap Share,
          then Add to Home Screen.
        </p>
      )}
    </Panel>
  )
}

function Account({ me }: { me: Me }) {
  const queryClient = useQueryClient()
  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear()
      queryClient.setQueryData(meQuery.queryKey, null)
    },
  })

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-base border-2 border-dashed border-border p-5">
      <div>
        <p className="font-heading">Signed in as {me.display_name}</p>
        {me.email && <p className="text-sm">{me.email}</p>}
      </div>
      <Button variant="neutral" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
        <LogOut /> Sign out
      </Button>
    </section>
  )
}
