// Light or dark. "system" follows the device. The choice lives in localStorage, and the script
// in index.html applies it before the first paint so the page doesn't flash.

export type ThemeChoice = 'system' | 'light' | 'dark'

const storageKey = 'baby-greens:theme'
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
const themeColors = { light: '#05e17a', dark: '#1b2a22' }
const listeners = new Set<() => void>()

export function themeChoice(): ThemeChoice {
  const stored = localStorage.getItem(storageKey)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

function apply() {
  const choice = themeChoice()
  const dark = choice === 'dark' || (choice === 'system' && darkQuery.matches)
  document.documentElement.classList.toggle('dark', dark)
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? themeColors.dark : themeColors.light)
}

export function setThemeChoice(choice: ThemeChoice) {
  if (choice === 'system') localStorage.removeItem(storageKey)
  else localStorage.setItem(storageKey, choice)
  apply()
  listeners.forEach((listener) => listener())
}

export function onThemeChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Follow the device when it switches, for example at sunset.
darkQuery.addEventListener('change', apply)
apply()
