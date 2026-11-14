// Small pure helpers shared by the panel. Kept free of React so they are easy to reason about.

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

/** 125 -> "02:05", 3725 -> "1:02:05". Never negative: pass Math.abs() for overtime. */
export function fmtClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** 600 -> "10 min", 90 -> "1 min 30 s", 45 -> "45 s", 3900 -> "1 h 5 min". */
export function fmtDuration(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || Number.isNaN(totalSeconds)) return '–'
  const s = Math.max(0, Math.round(totalSeconds))
  if (s < 60) return `${s} s`
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h) return m ? `${h} h ${m} min` : `${h} h`
  return sec && m < 10 ? `${m} min ${sec} s` : `${m} min`
}

/** Rounded to a friendly figure for estimates: "about 8 min". */
export function fmtEta(seconds) {
  if (seconds === null || seconds === undefined) return '–'
  if (seconds < 45) return 'under 1 min'
  return `about ${Math.max(1, Math.round(seconds / 60))} min`
}

/**
 * State of the time allotment for a ticket that is being served.
 *   ok    : more than 20% of the time left
 *   warn  : 20% or 30 s left, whichever is more
 *   over  : the allotment (plus any extra time) is used up
 */
export function timerState(ticket, nowMs) {
  const budget = (ticket.allotted_seconds || 0) + (ticket.extended_seconds || 0)
  const started = ticket.called_at ? Date.parse(ticket.called_at) : nowMs
  const elapsed = Math.max(0, Math.floor((nowMs - started) / 1000))
  const remaining = budget - elapsed
  let state = 'ok'
  if (budget > 0 && remaining < 0) state = 'over'
  else if (budget > 0 && remaining <= Math.max(30, budget * 0.2)) state = 'warn'
  return { budget, elapsed, remaining, pct: budget > 0 ? clamp(remaining / budget, 0, 1) : 0, state }
}

export const waitSeconds = (ticket, nowMs) =>
  Math.max(0, Math.floor((nowMs - Date.parse(ticket.service_arrival || ticket.created_at)) / 1000))

export const STATUS_LABEL = {
  waiting: 'Waiting',
  called: 'At counter',
  hold: 'On hold',
  served: 'Completed',
}

export const initials = name => (name || '').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase()

export const serviceLabel = (services, key) => (services.find(s => s.key === key) || {}).label || key
