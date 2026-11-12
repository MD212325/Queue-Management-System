import { useCallback, useEffect, useRef, useState } from 'react'
import { api, session } from './api.js'
import { ClockContext, useLive, useLocalStorage, useServerNow } from './hooks.js'
import { fmtDuration, serviceLabel, timerState, waitSeconds } from './utils.js'
import CounterCard from './components/Counter.jsx'
import { CancelReviewDialog, NewTicketDialog } from './components/Dialogs.jsx'
import Login from './components/Login.jsx'
import QueueView from './components/QueueView.jsx'
import Reports from './components/Reports.jsx'
import Settings from './components/Settings.jsx'
import { Button, FeedbackProvider, Icon, useAction, useFeedback } from './components/ui.jsx'

const PAGES = {
  counters: { label: 'Counters', icon: 'grid', title: 'Counters', sub: 'Live view of every service window' },
  queue: { label: 'Queue', icon: 'list', title: 'Queue', sub: 'Everyone in line, and who has been served today' },
  reports: { label: 'Reports', icon: 'chart', title: 'Reports', sub: 'How long visits take compared with the time allotted', admin: true },
  settings: { label: 'Services & time', icon: 'sliders', title: 'Services & time allotments', sub: 'Decide how long each service should take', admin: true },
}

function usePage() {
  const read = () => { const h = window.location.hash.replace('#', ''); return PAGES[h] ? h : 'counters' }
  const [page, setPage] = useState(read)
  useEffect(() => {
    const on = () => setPage(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return [page, id => { window.location.hash = id }]
}

function Clock() {
  const now = useServerNow()
  return <time className="clock" dateTime={new Date(now).toISOString()}>{new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
}

function SummaryStrip({ snap }) {
  const now = useServerNow()
  const serving = snap.tickets.filter(t => t.status === 'called')
  const over = serving.filter(t => timerState(t, now).state === 'over').length
  const waiting = snap.tickets.filter(t => t.status === 'waiting')
  const longest = waiting.reduce((a, t) => Math.max(a, waitSeconds(t, now)), 0)
  const items = [
    { label: 'Waiting', value: snap.stats.waiting },
    { label: 'At counters', value: serving.length },
    { label: 'Over time', value: over, tone: over ? 'bad' : '' },
    { label: 'On hold', value: snap.stats.hold },
    { label: 'Longest wait', value: waiting.length ? fmtDuration(longest < 60 ? longest : Math.floor(longest / 60) * 60) : '–' },
    { label: 'Completed today', value: snap.stats.served_today },
  ]
  return (
    <dl className="strip" aria-label="Summary">
      {items.map(i => (
        <div key={i.label} className={i.tone || ''}>
          <dt>{i.label}</dt>
          <dd>{i.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function CountersPage({ snap, counter, act, onReview }) {
  const withTickets = new Set(snap.tickets.map(t => t.current_service))
  const visible = snap.services.filter(s => (s.enabled || withTickets.has(s.key)) && (counter === 'all' || counter === s.key))
  return (
    <div className="page-body">
      <SummaryStrip snap={snap} />
      {visible.length ? (
        <div className={`counters ${visible.length === 1 ? 'single' : ''}`}>
          {visible.map(s => <CounterCard key={s.key} service={s} services={snap.services} tickets={snap.tickets} act={act} onReview={onReview} />)}
        </div>
      ) : <p className="empty-block">No counters to show. Turn a service on under Services &amp; time.</p>}
    </div>
  )
}

function Console({ auth, onSignOut }) {
  const { snap, offset, conn, error, refresh } = useLive(true, onSignOut)
  const run = useAction()
  const { confirm } = useFeedback()
  const [page, goTo] = usePage()
  const [counter, setCounter] = useLocalStorage('qms_counter', 'all')
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light')
  const [newOpen, setNewOpen] = useState(false)
  const [reviewId, setReviewId] = useState(null)
  const inflight = useRef(new Set())
  const isAdmin = auth.role === 'admin'

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('qms_theme', theme) } catch { /* ignore */ }
  }, [theme])

  useEffect(() => {
    document.title = `${snap && snap.stats.waiting ? `(${snap.stats.waiting}) ` : ''}${PAGES[page].title} · STI Queue`
  }, [snap, page])

  // Ignore a second click while the first request for the same thing is still running.
  const guard = useCallback(async (key, fn, success) => {
    if (inflight.current.has(key)) return undefined
    inflight.current.add(key)
    try { return await run(fn, success) } finally { inflight.current.delete(key); refresh() }
  }, [run, refresh])

  const services = snap ? snap.services : []
  const act = {
    callNext: s => guard(`next:${s.key}`, () => api.callNext(s.key), r => r.message),
    complete: t => guard(`serve:${t.id}`, () => api.serve(t.id, t.called_service),
      r => (r.completed ? `${t.displayToken} completed in ${fmtDuration(r.actual_seconds)}` : `${t.displayToken} sent to ${serviceLabel(services, r.movedTo)}`)),
    extend: (t, secs) => guard(`ext:${t.id}`, () => api.extend(t.id, secs), `${secs / 60} min added to ${t.displayToken}`),
    hold: t => guard(`hold:${t.id}`, () => api.hold(t.id), `${t.displayToken} put on hold`),
    recall: t => guard(`recall:${t.id}`, () => api.recall(t.id), `${t.displayToken} called back`),
    keep: t => guard(`keep:${t.id}`, () => api.clearCancel(t.id), 'Cancel request dismissed'),
    remove: async (t, confirmed) => {
      if (!confirmed) {
        const ok = await confirm({
          title: `Remove ${t.displayToken}?`,
          body: `${t.name || 'This customer'} will be taken out of the line. This can't be undone.`,
          confirmLabel: 'Remove ticket', tone: 'danger',
        })
        if (!ok) return undefined
      }
      return guard(`rm:${t.id}`, () => api.remove(t.id), `${t.displayToken} removed`)
    },
  }

  const reviewing = snap && reviewId ? snap.tickets.find(t => t.id === reviewId) : null
  useEffect(() => { if (reviewId && snap && !reviewing) setReviewId(null) }, [reviewId, snap, reviewing])

  const nav = Object.entries(PAGES).filter(([, p]) => !p.admin || isAdmin)
  const head = PAGES[page]
  const cancelCount = snap ? snap.stats.cancel_requests : 0

  return (
    <ClockContext.Provider value={offset}>
      <div className="shell">
        <aside className="rail">
          <div className="brand">
            <img src="/sti-logo.png" alt="STI" width="40" height="29" />
            <div><b>Queue console</b><span>STI Tanay</span></div>
          </div>
          <nav aria-label="Main">
            {nav.map(([id, p]) => (
              <button key={id} type="button" className={`nav-item ${page === id ? 'active' : ''}`} aria-current={page === id ? 'page' : undefined} onClick={() => goTo(id)}>
                <Icon name={p.icon} size={19} />
                <span>{p.label}</span>
                {id === 'queue' && snap && snap.stats.waiting ? <em className="nav-badge">{snap.stats.waiting}</em> : null}
              </button>
            ))}
          </nav>
          <div className="rail-foot">
            <button type="button" className="nav-item" onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={19} /><span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
            </button>
            <div className="who-am-i">
              <span className="avatar" aria-hidden="true">{isAdmin ? 'A' : 'S'}</span>
              <div><b>{isAdmin ? 'Administrator' : 'Counter staff'}</b><span>Signed in</span></div>
              <button type="button" className="icon-btn" aria-label="Sign out" title="Sign out" onClick={onSignOut}><Icon name="logout" size={17} /></button>
            </div>
          </div>
        </aside>

        <div className="main">
          <header className="page-head">
            <div>
              <h1>{head.title}</h1>
              <p>{head.sub}</p>
            </div>
            <div className="head-tools">
              {page === 'counters' && snap ? (
                <select value={counter} onChange={e => setCounter(e.target.value)} aria-label="Show counter">
                  <option value="all">All counters</option>
                  {snap.services.filter(s => s.enabled).map(s => <option key={s.key} value={s.key}>{s.label} only</option>)}
                </select>
              ) : null}
              <span className={`conn ${conn}`} role="status"><i aria-hidden="true" />{conn === 'live' ? 'Live' : conn === 'offline' ? 'Reconnecting…' : 'Connecting…'}</span>
              {snap ? <Clock /> : null}
              <Button variant="primary" icon="plus" onClick={() => setNewOpen(true)} disabled={!snap}>New ticket</Button>
            </div>
          </header>

          {cancelCount ? (
            <button type="button" className="banner" onClick={() => { const t = snap.tickets.find(x => x.cancel_requested); if (t) setReviewId(t.id) }}>
              <Icon name="alert" size={17} />
              <span><b>{cancelCount} cancel request{cancelCount === 1 ? '' : 's'}</b> waiting for a decision</span>
              <span className="banner-go">Review <Icon name="chevronRight" size={15} /></span>
            </button>
          ) : null}
          {error ? <div className="banner offline" role="alert"><Icon name="alert" size={17} /><span>{snap ? 'Cannot reach the server. Showing the last information received.' : error}</span><Button size="sm" onClick={refresh}>Retry</Button></div> : null}

          {!snap ? (
            error ? null : <p className="empty-block">Loading…</p>
          ) : page === 'counters' ? (
            <CountersPage snap={snap} counter={counter} act={act} onReview={t => setReviewId(t.id)} />
          ) : page === 'queue' ? (
            <QueueView snap={snap} act={act} onReview={t => setReviewId(t.id)} />
          ) : page === 'reports' ? (
            isAdmin ? <Reports refreshKey={snap.stats.served_today} /> : <Settings snap={snap} refresh={refresh} isAdmin={false} />
          ) : (
            <Settings snap={snap} refresh={refresh} isAdmin={isAdmin} />
          )}
        </div>
      </div>

      {newOpen && snap ? <NewTicketDialog services={snap.services} onClose={() => setNewOpen(false)} onCreated={refresh} /> : null}
      {reviewing ? <CancelReviewDialog ticket={reviewing} onClose={() => setReviewId(null)} act={act} /> : null}
    </ClockContext.Provider>
  )
}

export default function App() {
  const [auth, setAuth] = useState(() => session.read())
  const signOut = useCallback(() => { session.clear(); setAuth(null) }, [])
  return (
    <FeedbackProvider>
      {auth ? <Console auth={auth} onSignOut={signOut} /> : <Login onSignedIn={setAuth} />}
    </FeedbackProvider>
  )
}
