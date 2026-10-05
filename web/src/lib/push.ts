import { api, unwrap } from './api'

/** Where push stands on this device. */
export type PushState =
  | { kind: 'unsupported'; reason: string }
  | { kind: 'needs-install' }
  | { kind: 'server-off' }
  | { kind: 'denied' }
  | { kind: 'off' }
  | { kind: 'on'; endpoint: string }

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent)

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

function support(): { kind: 'unsupported'; reason: string } | { kind: 'needs-install' } | null {
  if (!window.isSecureContext) {
    return {
      kind: 'unsupported',
      reason: 'Reminders need a secure connection. Open the app over https or on localhost.',
    }
  }
  // iPhones and iPads only allow push in apps added to the home screen.
  if (isIos() && !isStandalone()) return { kind: 'needs-install' }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { kind: 'unsupported', reason: "This browser can't show reminders." }
  }
  return null
}

async function serverKey(): Promise<string | null> {
  const { public_key } = await unwrap(api.GET('/push/key'))
  return public_key ?? null
}

/** Rejects if `promise` takes longer than `ms`, so a stuck browser API can't hang the page. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export async function pushState(): Promise<PushState> {
  const unsupported = support()
  if (unsupported) return unsupported
  if (!(await serverKey())) return { kind: 'server-off' }
  if (Notification.permission === 'denied') return { kind: 'denied' }

  // The service worker can be slow to start, and some browsers never answer when their push
  // service is unreachable.
  const subscription = await withTimeout(
    navigator.serviceWorker.ready.then((registration) =>
      registration.pushManager.getSubscription(),
    ),
    10_000,
    "This browser's push service isn't answering. Try again later.",
  )
  return subscription ? { kind: 'on', endpoint: subscription.endpoint } : { kind: 'off' }
}

/** Asks for permission, subscribes this device, and tells the server. */
export async function enablePush(): Promise<void> {
  const key = await serverKey()
  if (!key) throw new Error('Reminders are turned off on this server.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('Notifications are blocked. Allow them in the browser settings, then try again.')
  }

  const registration = await navigator.serviceWorker.ready
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(key),
    }))

  const json = subscription.toJSON()
  await unwrap(
    api.POST('/push/subscriptions', {
      body: {
        endpoint: subscription.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
      },
    }),
  )
}

/** Unsubscribes this device and tells the server to forget it. */
export async function disablePush(): Promise<void> {
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return
  await unwrap(api.DELETE('/push/subscriptions', { body: { endpoint: subscription.endpoint } }))
  await subscription.unsubscribe()
}

function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}
