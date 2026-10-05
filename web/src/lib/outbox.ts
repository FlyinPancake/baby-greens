// Changes made without a connection: ticking a task done, snoozing it, and logging a harvest.
// They wait in IndexedDB, so they survive closing the app and the login redirect, and go out in
// order once the app is online and signed in. Everything else needs a connection.

import { createStore, get, set } from 'idb-keyval'
import { api, type Schemas } from './api'

export type OutboxAction =
  | { kind: 'complete'; taskId: string; doneAt: string; label: string }
  | { kind: 'snooze'; taskId: string; until: string; label: string }
  | { kind: 'harvest'; batchId: string; body: Schemas['LogHarvest']; label: string }

export type OutboxEntry = OutboxAction & { id: string; queuedAt: string }

export type OutboxStatus = 'idle' | 'syncing' | 'needs-login'

export type OutboxState = {
  entries: OutboxEntry[]
  status: OutboxStatus
  /** Changes the server turned down, like a task someone else already finished. */
  dropped: { label: string; reason: string }[]
}

/** What happened when one change was sent. */
type Outcome = 'sent' | 'dropped' | 'retry' | 'login'

const store = createStore('baby-greens-outbox', 'outbox')
const entriesKey = 'entries'

let state: OutboxState = { entries: [], status: 'idle', dropped: [] }
const listeners = new Set<() => void>()
let afterSync: () => void = () => {}

function update(next: Partial<OutboxState>) {
  state = { ...state, ...next }
  listeners.forEach((listener) => listener())
}

async function save(entries: OutboxEntry[]) {
  update({ entries })
  await set(entriesKey, entries, store)
}

export function outboxState(): OutboxState {
  return state
}

export function onOutboxChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Called after changes go out, to refresh what's on screen. */
export function setAfterSync(callback: () => void) {
  afterSync = callback
}

export function dismissDropped() {
  update({ dropped: [] })
}

/** Forgets every waiting change, for example when signing out. */
export async function clearOutbox() {
  await save([])
  update({ status: 'idle', dropped: [] })
}

async function send(action: OutboxAction): Promise<{ outcome: Outcome; reason?: string }> {
  let response: Response
  let error: { error?: string; problems?: { message: string }[] } | undefined
  try {
    const result =
      action.kind === 'complete'
        ? await api.POST('/tasks/{id}/complete', {
            params: { path: { id: action.taskId }, query: { done_at: action.doneAt } },
          })
        : action.kind === 'snooze'
          ? await api.POST('/tasks/{id}/snooze', {
              params: { path: { id: action.taskId } },
              body: { until: action.until },
            })
          : await api.POST('/batches/{id}/harvests', {
              params: { path: { id: action.batchId } },
              body: action.body,
            })
    response = result.response
    error = result.error as typeof error
  } catch {
    // No connection, or it dropped mid-request.
    return { outcome: 'retry' }
  }

  if (response.ok) return { outcome: 'sent' }
  if (response.status === 401) return { outcome: 'login' }
  if (response.status >= 500 || response.status === 429) return { outcome: 'retry' }
  const reason = error?.problems?.[0]?.message ?? reasons[error?.error ?? ''] ?? 'it no longer applies'
  return { outcome: 'dropped', reason }
}

const reasons: Record<string, string> = {
  task_done: 'it was already done',
  batch_not_active: 'the batch has ended',
  stale_task: 'the batch moved on',
  batch_not_harvested: "the batch isn't harvested",
  not_found: 'it no longer exists',
}

/** Sends waiting changes in order. Stops at the first one that has to wait. */
export async function flush(): Promise<void> {
  if (state.status === 'syncing' || state.entries.length === 0) return
  if (!navigator.onLine) return

  update({ status: 'syncing' })
  let changed = false
  let status: OutboxStatus = 'idle'
  const dropped = [...state.dropped]

  while (state.entries.length > 0) {
    const [entry, ...rest] = state.entries
    const { outcome, reason } = await send(entry)
    if (outcome === 'retry') break
    if (outcome === 'login') {
      status = 'needs-login'
      break
    }
    if (outcome === 'dropped') dropped.push({ label: entry.label, reason: reason ?? '' })
    await save(rest)
    changed = true
  }

  update({ status, dropped })
  if (changed) afterSync()
}

/**
 * Sends a change now if possible, and queues it if not. Returns "queued" when it has to wait.
 * Throws when the server turns it down right away, so the screen can say why.
 */
export async function perform(action: OutboxAction): Promise<'sent' | 'queued'> {
  // Older changes go first, so the server sees them in order.
  if (navigator.onLine && state.entries.length === 0) {
    const { outcome, reason } = await send(action)
    if (outcome === 'sent') return 'sent'
    if (outcome === 'dropped') throw new Error(`Couldn't save: ${reason}.`)
    if (outcome === 'login') update({ status: 'needs-login' })
  }
  const entry: OutboxEntry = {
    ...action,
    id: crypto.randomUUID(),
    queuedAt: new Date().toISOString(),
  }
  await save([...state.entries, entry])
  return 'queued'
}

/** Loads waiting changes and starts sending them whenever the app is online. */
export async function startOutbox() {
  const entries = (await get<OutboxEntry[]>(entriesKey, store)) ?? []
  update({ entries })

  window.addEventListener('online', () => void flush())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flush()
  })
  setInterval(() => void flush(), 30_000)
  await flush()
}
