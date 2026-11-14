import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { fmtClock, fmtDuration } from '../utils.js'
import { Button, Icon, Segmented, useAction } from './ui.jsx'

const RANGES = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
]

function Kpi({ label, value, hint, tone = '' }) {
  return (
    <div className={`kpi ${tone}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {hint ? <span className="kpi-hint">{hint}</span> : null}
    </div>
  )
}

/** One bar per service: average time taken against the allotted time (the tick mark). */
function AllotmentBar({ row }) {
  if (!row.visits) return <span className="muted">No visits yet</span>
  const scale = Math.max(row.allotted_seconds, row.avg_actual, row.max_actual * 0.6) * 1.15
  const over = row.avg_actual > row.allotted_seconds
  return (
    <div className="abar" role="img" aria-label={`Average ${fmtDuration(row.avg_actual)} against ${fmtDuration(row.allotted_seconds)} allotted`}>
      <div className="abar-track">
        <div className={`abar-fill ${over ? 'over' : ''}`} style={{ width: `${Math.min(100, (row.avg_actual / scale) * 100)}%` }} />
        <div className="abar-mark" style={{ left: `${(row.allotted_seconds / scale) * 100}%` }} title={`Allotted ${fmtDuration(row.allotted_seconds)}`} />
      </div>
      <span className="abar-text">{fmtClock(row.avg_actual)} <small>of {fmtClock(row.allotted_seconds)}</small></span>
    </div>
  )
}

function Bars({ data, labelOf }) {
  const max = Math.max(1, ...data.map(d => d.count))
  return (
    <div className="bars" role="img" aria-label="Visits over time">
      {data.map(d => (
        <div key={d.key} className="bar-col" title={`${labelOf(d)}: ${d.count} visit${d.count === 1 ? '' : 's'}`}>
          <span className="bar-n">{d.count || ''}</span>
          <span className={`bar ${d.count ? '' : 'zero'}`} style={{ height: `${(d.count / max) * 100}%` }} />
          <span className="bar-l">{labelOf(d)}</span>
        </div>
      ))}
    </div>
  )
}

function hourLabel(h) { return h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p` }

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function Reports({ refreshKey }) {
  const run = useAction()
  const [range, setRange] = useState('today')
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    api.reports(range).then(d => { setData(d); setErr('') }).catch(e => setErr(e.message))
  }, [range])
  useEffect(() => { load() }, [load, refreshKey])

  if (err) return <div className="page-body"><p className="empty-block">{err}</p></div>
  if (!data) return <div className="page-body"><p className="empty-block">Loading report…</p></div>

  const t = data.totals
  const series = range === 'today'
    ? (() => {
        const byHour = new Map(data.hourly.map(h => [h.hour, h.count]))
        const hours = [...byHour.keys()]
        const lo = Math.min(7, ...hours), hi = Math.max(17, ...hours)
        return Array.from({ length: hi - lo + 1 }, (_, i) => ({ key: lo + i, count: byHour.get(lo + i) || 0, label: hourLabel(lo + i) }))
      })()
    : data.daily.map(d => ({ key: d.day, count: d.count, label: new Date(`${d.day}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' }) }))

  return (
    <div className="page-body">
      <div className="toolbar">
        <Segmented label="Report period" value={range} onChange={setRange} options={RANGES} />
        <div className="filters">
          <Button icon="download" size="sm" onClick={() => run(async () => download('visits.csv', await api.csv('stages')))}>Visit timings (CSV)</Button>
          <Button icon="download" size="sm" onClick={() => run(async () => download('tickets.csv', await api.csv('tickets')))}>Tickets (CSV)</Button>
        </div>
      </div>

      <div className="kpis">
        <Kpi label="Visits completed" value={t.visits} hint={`${t.tickets_completed} ticket${t.tickets_completed === 1 ? '' : 's'} fully served`} />
        <Kpi label="Average time at counter" value={t.avg_actual === null ? '–' : fmtDuration(t.avg_actual)} />
        <Kpi label="Finished within allotted time" value={t.within_pct === null ? '–' : `${t.within_pct}%`}
          tone={t.within_pct === null ? '' : t.within_pct >= 80 ? 'good' : t.within_pct >= 60 ? 'warn' : 'bad'} hint="Counting any extra time given" />
        <Kpi label="Average wait for a counter" value={t.avg_wait === null ? '–' : fmtDuration(t.avg_wait)} />
      </div>

      <section className="panel">
        <header className="panel-head">
          <h3>Time allotment by service</h3>
          <p className="muted">Average time per visit compared with the allotted time. The tick marks the allotment.</p>
        </header>
        <div className="table-wrap">
          <table className="grid-table">
            <thead>
              <tr><th>Service</th><th>Allotted</th><th className="bar-col-h">Average vs allotted</th><th>Longest</th><th>On time</th><th>Extended</th><th className="right">Visits</th></tr>
            </thead>
            <tbody>
              {data.per_service.map(s => (
                <tr key={s.service} className={s.enabled ? '' : 'dim'}>
                  <td><span className="prefix sm">{s.prefix}</span> <b>{s.label}</b></td>
                  <td>{fmtDuration(s.allotted_seconds)}</td>
                  <td><AllotmentBar row={s} /></td>
                  <td>{s.visits ? fmtDuration(s.max_actual) : '–'}</td>
                  <td>{s.within_pct === null ? '–' : <span className={`pill ${s.within_pct >= 80 ? 'pill-ok' : s.within_pct >= 60 ? 'pill-warn' : 'pill-over'}`}>{s.within_pct}%</span>}</td>
                  <td>{s.visits ? `${s.extended_visits}` : '–'}</td>
                  <td className="right">{s.visits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="foot-note"><Icon name="alert" size={14} /> Visits shorter than 10 seconds are ignored, since they are usually accidental clicks. A service that regularly runs over may need a longer allotment, or more staff.</p>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h3>{range === 'today' ? 'Visits by hour' : 'Visits per day'}</h3>
        </header>
        {series.some(s => s.count) ? <Bars data={series} labelOf={d => d.label} /> : <p className="empty-block">No completed visits in this period.</p>}
      </section>
    </div>
  )
}
