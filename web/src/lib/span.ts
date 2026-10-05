// Parses durations in humantime syntax, the format plant definitions use on the server, like
// "8h", "1day 12h", or "90min". Returns milliseconds, or null when the text isn't a duration.

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const units: Record<string, number> = {
  nsec: 1e-6,
  ns: 1e-6,
  usec: 1e-3,
  us: 1e-3,
  msec: 1,
  ms: 1,
  seconds: 1000,
  second: 1000,
  sec: 1000,
  s: 1000,
  minutes: MINUTE,
  minute: MINUTE,
  min: MINUTE,
  m: MINUTE,
  hours: HOUR,
  hour: HOUR,
  hr: HOUR,
  h: HOUR,
  days: DAY,
  day: DAY,
  d: DAY,
  weeks: 7 * DAY,
  week: 7 * DAY,
  w: 7 * DAY,
  months: 30.44 * DAY,
  month: 30.44 * DAY,
  M: 30.44 * DAY,
  years: 365.25 * DAY,
  year: 365.25 * DAY,
  y: 365.25 * DAY,
}

export function parseSpan(text: string | null | undefined): number | null {
  if (!text) return null
  const pattern = /\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)\s*/y
  let total = 0
  let index = 0
  while (index < text.length) {
    pattern.lastIndex = index
    const match = pattern.exec(text)
    if (!match) return null
    const unit = units[match[2]]
    if (unit === undefined) return null
    total += Number(match[1]) * unit
    index = pattern.lastIndex
  }
  return total > 0 ? total : null
}

/** Like "1 day 12 hours" or "45 minutes". */
export function describeSpan(ms: number): string {
  const days = Math.floor(ms / DAY)
  const hours = Math.floor((ms % DAY) / HOUR)
  const minutes = Math.round((ms % HOUR) / MINUTE)
  const parts = [
    days && `${days} ${days === 1 ? 'day' : 'days'}`,
    hours && `${hours} ${hours === 1 ? 'hour' : 'hours'}`,
    minutes && `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : 'under a minute'
}

/** A rough length for a whole grow, like "5 to 7 days", "1.5 to 4 days", or "about 12 hours". */
export function describeRange(minMs: number, maxMs: number): string {
  const inDays = maxMs >= 2 * DAY
  // Days round to the nearest half, hours to the nearest whole hour.
  const round = (ms: number) =>
    inDays ? String(Math.round((ms / DAY) * 2) / 2) : String(Math.round(ms / HOUR))
  const unit = inDays ? 'days' : 'hours'
  const min = round(minMs)
  const max = round(maxMs)
  return min === max ? `about ${min} ${unit}` : `${min} to ${max} ${unit}`
}
