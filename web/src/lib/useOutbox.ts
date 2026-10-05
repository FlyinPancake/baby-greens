import { useSyncExternalStore } from 'react'
import type { TaskView } from './api'
import { onOutboxChange, type OutboxState, outboxState } from './outbox'

export function useOutbox(): OutboxState {
  return useSyncExternalStore(onOutboxChange, outboxState)
}

function onOnlineChange(listener: () => void) {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
  }
}

export function useOnline(): boolean {
  return useSyncExternalStore(onOnlineChange, () => navigator.onLine)
}

/**
 * Applies changes still waiting in the outbox to a task list: ticked tasks disappear and snoozed
 * ones move. Without this, a refresh from the server would bring them back until they sync.
 */
export function usePendingTasks(tasks: TaskView[] | undefined): TaskView[] {
  const { entries } = useOutbox()
  const done = new Set<string>()
  const snoozed = new Map<string, string>()
  for (const entry of entries) {
    if (entry.kind === 'complete') done.add(entry.taskId)
    if (entry.kind === 'snooze') snoozed.set(entry.taskId, entry.until)
  }
  return (tasks ?? [])
    .filter((task) => !done.has(task.id))
    .map((task) => {
      const until = snoozed.get(task.id)
      return until ? { ...task, due_at: until, snoozed_until: until } : task
    })
    .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at))
}
