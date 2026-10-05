const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

export function endOfToday(now = new Date()): Date {
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)
  return end
}

function dayDifference(date: Date, now: Date): number {
  const startOf = (day: Date) => new Date(day.getFullYear(), day.getMonth(), day.getDate())
  return Math.round((startOf(date).getTime() - startOf(now).getTime()) / 86_400_000)
}

/** Like "today", "tomorrow", "Fri", or "Oct 14". */
function dayLabel(date: Date, now: Date): string {
  const days = dayDifference(date, now)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  if (Math.abs(days) < 7) return weekdayFormat.format(date)
  return dateFormat.format(date)
}

/** Like "today 18:00" or "Fri 18:00". Dates a week or more away get no time. */
export function formatWhen(iso: string, now = new Date()): string {
  const date = new Date(iso)
  const day = dayLabel(date, now)
  return Math.abs(dayDifference(date, now)) < 7 ? `${day} ${timeFormat.format(date)}` : day
}

/** Like "Fri to Sun", or one day when both ends fall on it. */
export function formatWindow(earliestIso: string, latestIso: string, now = new Date()): string {
  const earliest = dayLabel(new Date(earliestIso), now)
  const latest = dayLabel(new Date(latestIso), now)
  return earliest === latest ? earliest : `${earliest} to ${latest}`
}

/** A value for <input type="datetime-local">, in local time. */
export function toLocalInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
