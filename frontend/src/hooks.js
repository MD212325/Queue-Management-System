import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { api, eventsUrl } from './api.js'

const EVENTS = ['created', 'called', 'moved', 'served', 'hold', 'recalled', 'reassigned', 'extended',
  'deleted', 'cancel_requested', 'cancel_cleared', 'services_updated']

/**
 * Keeps one snapshot of the queue fresh.
 * - The server pushes small events; we coalesce bursts and re-read ONE compact snapshot
 *   (active tickets only) instead of every client downloading the whole history.
 * - A slow poll and a refresh on tab focus cover a dropped connection.
 * - offset = server clock minus this computer's clock, so countdowns are right even if the PC's clock is off.
 */
export function useLive(enabled, onUnauthorized) {
  const [snap, setSnap] = useState(null)
  const [offset, setOffset] = useState(0)
  const [conn, setConn] = useState('connecting')
  const [error, setError] = useState('')
  const loadRef = useRef(() => {})
  const timer = useRef(0)

  useEffect(() => {
    if (!enabled) return undefined
    let alive = true
    let inflight = false
    let again = false

    async function load() {
      if (inflight) { again = true; return }
      inflight = true
      try {
        const t0 = Date.now()
        const data = await api.snapshot()
        const t1 = Date.now()
        if (!alive) return
        setSnap(data)
        setOffset(Date.parse(data.now) - (t0 + t1) / 2)
        setError('')
      } catch (e) {
        if (!alive) return
        if (e.status === 401) onUnauthorized()
        else setError(e.message)
      } finally {
        inflight = false
        if (again && alive) { again = false; load() }
      }
    }
    loadRef.current = load
    const refresh = () => { clearTimeout(timer.current); timer.current = setTimeout(load, 120) }

    load()
    const es = new EventSource(eventsUrl())
    es.onopen = () => { setConn('live'); refresh() }
    es.onerror = () => setConn('offline')
    EVENTS.forEach(n => es.addEventListener(n, refresh))
    const poll = setInterval(load, 20000)
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      alive = false
      clearTimeout(timer.current)
      clearInterval(poll)
      es.close()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, onUnauthorized])

  const refresh = useCallback(() => loadRef.current(), [])
  return { snap, offset, conn, error, refresh }
}

/* One shared 1-second heartbeat for every countdown on screen. */
let tick = Math.floor(Date.now() / 1000)
const subs = new Set()
let ticker = null
function subscribe(fn) {
  subs.add(fn)
  if (!ticker) {
    ticker = setInterval(() => { tick = Math.floor(Date.now() / 1000); subs.forEach(f => f()) }, 1000)
  }
  return () => {
    subs.delete(fn)
    if (!subs.size) { clearInterval(ticker); ticker = null }
  }
}

export const ClockContext = createContext(0)

/** Server-corrected "now" in ms; components that call this re-render once per second. */
export function useServerNow() {
  const offset = useContext(ClockContext)
  useSyncExternalStore(subscribe, () => tick)
  return Date.now() + offset
}

export function useLocalStorage(key, initial) {
  const [value, setValue] = useState(() => {
    try { const v = localStorage.getItem(key); return v === null ? initial : JSON.parse(v) } catch { return initial }
  })
  const set = useCallback(v => {
    setValue(v)
    try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* ignore */ }
  }, [key])
  return [value, set]
}
