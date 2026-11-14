import { useState } from 'react'
import { api } from '../api.js'
import { Button, Icon, IconButton, Switch, useAction, useFeedback } from './ui.jsx'

const slug = s => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24)

function ServiceRow({ service, index, count, onMove, onSaved }) {
  const run = useAction()
  const [label, setLabel] = useState(service.label)
  const [minutes, setMinutes] = useState(String(Math.round((service.allotted_seconds / 60) * 10) / 10))
  const [enabled, setEnabled] = useState(service.enabled)
  const [busy, setBusy] = useState(false)

  const secs = Math.round(Number(minutes) * 60)
  const valid = label.trim() && Number.isFinite(secs) && secs >= 30 && secs <= 7200
  const dirty = label.trim() !== service.label || secs !== service.allotted_seconds || enabled !== service.enabled

  async function save() {
    setBusy(true)
    const ok = await run(() => api.saveService(service.key, { label: label.trim(), allotted_seconds: secs, enabled }), `${label.trim()} saved`)
    setBusy(false)
    if (ok) onSaved()
  }
  const step = d => setMinutes(m => String(Math.max(0.5, Math.round((Number(m || 0) + d) * 10) / 10)))

  return (
    <li className={`svc-row ${dirty ? 'dirty' : ''}`}>
      <span className="prefix" title="Ticket letter">{service.prefix}</span>
      <label className="field grow">
        <span className="sr-only">Name</span>
        <input value={label} onChange={e => setLabel(e.target.value)} maxLength={40} aria-label={`Name of ${service.label}`} />
      </label>
      <div className="stepper" role="group" aria-label={`Allotted time for ${service.label}`}>
        <IconButton icon="minus" label="One minute less" onClick={() => step(-1)} />
        <input inputMode="decimal" value={minutes} onChange={e => setMinutes(e.target.value.replace(/[^0-9.]/g, ''))} aria-label="Allotted minutes" />
        <span>min</span>
        <IconButton icon="plus" label="One minute more" onClick={() => step(1)} />
      </div>
      <label className="toggle-field">
        <Switch checked={enabled} onChange={setEnabled} label={`${service.label} available at the kiosk`} />
        <span>{enabled ? 'On kiosk' : 'Hidden'}</span>
      </label>
      <div className="svc-order">
        <IconButton icon="arrowUp" label="Move up" disabled={index === 0} onClick={() => onMove(index, -1)} />
        <IconButton icon="arrowDown" label="Move down" disabled={index === count - 1} onClick={() => onMove(index, 1)} />
      </div>
      <Button variant={dirty ? 'primary' : 'secondary'} size="sm" disabled={!dirty || !valid} busy={busy} onClick={save}>Save</Button>
      {!valid ? <p className="field-error row-error">Allotted time must be between 0.5 and 120 minutes.</p> : null}
    </li>
  )
}

function AddService({ onAdded }) {
  const run = useAction()
  const [label, setLabel] = useState('')
  const [prefix, setPrefix] = useState('')
  const [minutes, setMinutes] = useState('10')
  const [busy, setBusy] = useState(false)
  const secs = Math.round(Number(minutes) * 60)
  const ok = label.trim() && /^[A-Za-z0-9]{1,2}$/.test(prefix) && secs >= 30 && secs <= 7200 && slug(label).length >= 2

  async function submit(e) {
    e.preventDefault()
    if (!ok) return
    setBusy(true)
    const done = await run(() => api.createService({ key: slug(label), label: label.trim(), prefix, allotted_seconds: secs }), `${label.trim()} added`)
    setBusy(false)
    if (done) { setLabel(''); setPrefix(''); setMinutes('10'); onAdded() }
  }

  return (
    <form className="add-svc" onSubmit={submit}>
      <label className="field grow"><span>Service name</span><input value={label} onChange={e => setLabel(e.target.value)} maxLength={40} placeholder="e.g. Clinic" /></label>
      <label className="field narrow"><span>Ticket letter</span><input value={prefix} onChange={e => setPrefix(e.target.value.toUpperCase().slice(0, 2))} placeholder="M" /></label>
      <label className="field narrow"><span>Minutes each</span><input inputMode="decimal" value={minutes} onChange={e => setMinutes(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
      <Button type="submit" variant="primary" icon="plus" disabled={!ok} busy={busy}>Add service</Button>
    </form>
  )
}

export default function Settings({ snap, refresh, isAdmin }) {
  const run = useAction()
  const { confirm } = useFeedback()
  const [days, setDays] = useState('30')

  if (!isAdmin) {
    return (
      <div className="page-body">
        <div className="panel locked">
          <Icon name="shield" size={28} />
          <h3>Administrator access needed</h3>
          <p className="muted">Service settings and time allotments can only be changed with the administrator key. Sign out and sign in again with that key.</p>
        </div>
      </div>
    )
  }

  async function move(index, dir) {
    const list = [...snap.services]
    const j = index + dir
    ;[list[index], list[j]] = [list[j], list[index]]
    await run(async () => {
      for (let i = 0; i < list.length; i++) if (list[i].sort_order !== i) await api.saveService(list[i].key, { sort_order: i })
    })
    refresh()
  }

  async function purge() {
    const n = Number(days)
    if (!Number.isInteger(n) || n < 0) return
    const ok = await confirm({
      title: 'Delete old completed tickets?',
      body: `Completed tickets older than ${n} day${n === 1 ? '' : 's'} will be deleted, including customer names. Timing figures in Reports are kept.`,
      confirmLabel: 'Delete', tone: 'danger',
    })
    if (!ok) return
    await run(() => api.purge(n), r => `${r.tickets_removed} ticket${r.tickets_removed === 1 ? '' : 's'} deleted`)
    refresh()
  }

  return (
    <div className="page-body">
      <div className="callout">
        <Icon name="timer" size={20} />
        <div>
          <b>How time allotment works</b>
          <p>Each service has an allotted time per customer. When a customer is called, the counter shows a countdown from that time and turns amber, then red when it runs out. Staff can add extra time for a complicated case. Changing a value here applies from the <em>next</em> customer called, never to the one being served.</p>
        </div>
      </div>

      <section className="panel">
        <header className="panel-head"><h3>Services</h3><p className="muted">Name, time per customer, and whether the kiosk offers the service. Turned-off services still finish the customers already waiting.</p></header>
        <ul className="svc-list">
          {snap.services.map((s, i) => (
            <ServiceRow key={`${s.key}:${s.label}:${s.allotted_seconds}:${s.enabled}`} service={s} index={i} count={snap.services.length} onMove={move} onSaved={refresh} />
          ))}
        </ul>
        <AddService onAdded={refresh} />
      </section>

      <section className="panel">
        <header className="panel-head"><h3>Customer data</h3><p className="muted">Names are removed with the ticket. The server also clears old completed tickets automatically.</p></header>
        <div className="purge">
          <span>Delete completed tickets older than</span>
          <input inputMode="numeric" value={days} onChange={e => setDays(e.target.value.replace(/\D/g, ''))} aria-label="Days" />
          <span>days</span>
          <Button variant="danger" icon="trash" size="sm" onClick={purge}>Delete now</Button>
        </div>
      </section>
    </div>
  )
}
