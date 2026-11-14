import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { useServerNow } from '../hooks.js'
import { fmtClock, fmtDuration, fmtEta, serviceLabel, STATUS_LABEL, timerState } from '../utils.js'
import { Elapsed } from './Counter.jsx'
import { Button, Icon, IconButton, Segmented } from './ui.jsx'

function TimeCell({ ticket }) {
  const now = useServerNow()
  if (ticket.status === 'called') {
    const t = timerState(ticket, now)
    const text = t.state === 'over' ? `+${fmtClock(-t.remaining)} over` : `${fmtClock(t.remaining)} left`
    return <span className={`time-chip ${t.state}`}><Icon name="timer" size={13} />{text}</span>
  }
  if (ticket.status === 'waiting') {
    return (
      <span className="time-plain">
        <span>Waited <Elapsed ticket={ticket} /></span>
        <small className="block">{ticket.eta_seconds ? `Called in ${fmtEta(ticket.eta_seconds)}` : 'Next up'}</small>
      </span>
    )
  }
  return <span className="muted">–</span>
}

function ActiveTable({ tickets, services, act, onReview }) {
  if (!tickets.length) return <p className="empty-block">No tickets match. Adjust the filters, or wait for new arrivals.</p>
  return (
    <div className="table-wrap">
      <table className="grid-table">
        <thead>
          <tr><th>Ticket</th><th>Customer</th><th>Route</th><th>Status</th><th>Time</th><th className="right">Actions</th></tr>
        </thead>
        <tbody>
          {tickets.map(t => (
            <tr key={t.id} className={t.cancel_requested ? 'flag' : ''}>
              <td><span className="tok">{t.displayToken}</span></td>
              <td><b>{t.name || 'Walk-in'}</b><small className="block">{t.quer_type || '–'}</small></td>
              <td>
                <span className="route">
                  {t.services.map((k, i) => (
                    <span key={k} className={i < t.service_index ? 'done' : i === t.service_index ? 'current' : ''}>{serviceLabel(services, k)}</span>
                  ))}
                </span>
              </td>
              <td>
                <span className={`pill pill-${t.status}`}>{STATUS_LABEL[t.status]}</span>
                {t.cancel_requested ? <button type="button" className="pill pill-over linkish" onClick={() => onReview(t)}>Cancel requested</button> : null}
              </td>
              <td><TimeCell ticket={t} /></td>
              <td className="right">
                <div className="row-actions">
                  {t.status === 'hold' ? <Button size="sm" icon="play" onClick={() => act.recall(t)}>Recall</Button> : null}
                  {t.status !== 'hold' ? <IconButton icon="pause" label={`Hold ${t.displayToken}`} onClick={() => act.hold(t)} /> : null}
                  <IconButton icon="trash" tone="danger" label={`Remove ${t.displayToken}`} onClick={() => act.remove(t)} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HistoryTable({ services, servedToday }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let alive = true
    api.history().then(r => { if (alive) { setRows(r); setErr('') } }).catch(e => alive && setErr(e.message))
    return () => { alive = false }
  }, [servedToday])
  if (err) return <p className="empty-block">{err}</p>
  if (!rows) return <p className="empty-block">Loading…</p>
  if (!rows.length) return <p className="empty-block">Nothing has been completed yet today.</p>
  return (
    <div className="table-wrap">
      <table className="grid-table">
        <thead><tr><th>Ticket</th><th>Customer</th><th>Services</th><th>Time at counters</th><th className="right">Completed</th></tr></thead>
        <tbody>
          {rows.map(t => (
            <tr key={t.id}>
              <td><span className="tok">{t.token}</span></td>
              <td><b>{t.name || 'Walk-in'}</b><small className="block">{t.quer_type || '–'}</small></td>
              <td>{t.services.map(k => serviceLabel(services, k)).join(' → ')}</td>
              <td>{fmtDuration(t.total_seconds)}</td>
              <td className="right">{new Date(t.served_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function QueueView({ snap, act, onReview }) {
  const [tab, setTab] = useState('active')
  const [q, setQ] = useState('')
  const [service, setService] = useState('all')
  const [status, setStatus] = useState('all')

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return snap.tickets.filter(t =>
      (service === 'all' || t.current_service === service) &&
      (status === 'all' || t.status === status) &&
      (!needle || t.displayToken.toLowerCase().includes(needle) || t.token.includes(needle) || (t.name || '').toLowerCase().includes(needle)))
  }, [snap.tickets, q, service, status])

  return (
    <div className="page-body">
      <div className="toolbar">
        <Segmented label="Queue view" value={tab} onChange={setTab} options={[
          { value: 'active', label: `Active (${snap.tickets.length})` },
          { value: 'done', label: `Completed today (${snap.stats.served_today})` },
        ]} />
        {tab === 'active' ? (
          <div className="filters">
            <label className="search">
              <Icon name="search" size={16} />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search ticket or name" aria-label="Search tickets" />
            </label>
            <select value={service} onChange={e => setService(e.target.value)} aria-label="Filter by service">
              <option value="all">All services</option>
              {snap.services.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by status">
              <option value="all">Any status</option>
              <option value="waiting">Waiting</option>
              <option value="called">At counter</option>
              <option value="hold">On hold</option>
            </select>
          </div>
        ) : null}
      </div>
      <section className="panel">
        {tab === 'active'
          ? <ActiveTable tickets={filtered} services={snap.services} act={act} onReview={onReview} />
          : <HistoryTable services={snap.services} servedToday={snap.stats.served_today} />}
      </section>
    </div>
  )
}
