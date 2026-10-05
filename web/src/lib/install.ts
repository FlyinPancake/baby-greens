// Chrome and Edge fire `beforeinstallprompt` once, early. Keep it so the settings page can offer
// an install button later. Safari and Firefox don't fire it.

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

let deferred: InstallPrompt | null = null
const listeners = new Set<() => void>()

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  deferred = event as InstallPrompt
  listeners.forEach((listener) => listener())
})

window.addEventListener('appinstalled', () => {
  deferred = null
  listeners.forEach((listener) => listener())
})

export function canInstall(): boolean {
  return deferred !== null
}

export function onInstallChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Shows the browser's install dialog. Returns whether the app got installed. */
export async function install(): Promise<boolean> {
  if (!deferred) return false
  const prompt = deferred
  deferred = null
  await prompt.prompt()
  const { outcome } = await prompt.userChoice
  listeners.forEach((listener) => listener())
  return outcome === 'accepted'
}
