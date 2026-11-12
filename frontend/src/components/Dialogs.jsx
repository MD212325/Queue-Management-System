import { useState } from 'react'
import { api } from '../api.js'
import { serviceLabel } from '../utils.js'
import { Button, Modal, useAction } from './ui.jsx'

const TYPES = ['Student', 'Faculty', 'Staff', 'Visitor', 'Other']

/** Walk-in ticket. Services are numbered in the order they are picked, which is the order the customer visits them. */
export function NewTicketDialog({ services, onClose, onCreated }) {
  const run = useAction()
  const [name, setName] = useState('')
  const [type, setType] = useState('Student')
  const [route, setRoute] = useState([])
  const [busy, setBusy] = useState(false)
  const active = services.filter(s => s.enabled)

  const toggle = key => setRoute(r => (r.includes(key) ? r.filter(k => k !== key) : [...r, key]))

  async function submit(e) {
    e.preventDefault()
    if (!route.length) return
    setBusy(true)
    const t = await run(() => api.createTicket({ name, quer_type: type, services: route }), r => `Ticket ${r.displayToken} created`)
    setBusy(false)
    if (t) { onCreated(); onClose() }
  }

  return (
    <Modal title="New walk-in ticket" onClose={onClose} width={560}
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="ticket" busy={busy} disabled={!route.length} onClick={submit}>Create ticket</Button>
      </>}>
      <form className="form-grid" onSubmit={submit}>
        <label className="field">
          <span>Customer name <em>(optional)</em></span>
          <input value={name} onChange={e => setName(e.target.value)} maxLength={80} data-autofocus autoComplete="off" />
        </label>
        <label className="field">
          <span>Customer type</span>
          <select value={type} onChange={e => setType(e.target.value)}>
            {TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </label>
        <fieldset className="field span-2">
          <legend>Services needed <em>(pick in the order they will be visited)</em></legend>
          <div className="chips">
            {active.map(s => {
              const i = route.indexOf(s.key)
              return (
                <button key={s.key} type="button" className={`chip ${i >= 0 ? 'on' : ''}`} aria-pressed={i >= 0} onClick={() => toggle(s.key)}>
                  {i >= 0 ? <span className="chip-n">{i + 1}</span> : null}
                  {s.label}
                </button>
              )
            })}
          </div>
          {route.length > 1 ? <p className="hint">Route: {route.map(k => serviceLabel(services, k)).join(' → ')}</p> : null}
        </fieldset>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

/** Staff decide what to do with a customer's cancel request. */
export function CancelReviewDialog({ ticket, onClose, act }) {
  return (
    <Modal title={`Cancel request · ${ticket.displayToken}`} onClose={onClose} width={480}
      footer={<>
        <Button onClick={async () => { await act.keep(ticket); onClose() }}>Keep in queue</Button>
        <Button variant="danger" icon="trash" onClick={async () => { await act.remove(ticket, true); onClose() }}>Remove ticket</Button>
      </>}>
      <dl className="facts">
        <div><dt>Customer</dt><dd>{ticket.name || 'Walk-in'}{ticket.quer_type ? ` · ${ticket.quer_type}` : ''}</dd></div>
        <div><dt>Reason given</dt><dd>{ticket.cancel_reason || 'No reason given'}</dd></div>
        <div><dt>Status</dt><dd>{ticket.status === 'called' ? 'Being served now' : ticket.status === 'hold' ? 'On hold' : 'Waiting in line'}</dd></div>
      </dl>
      <p className="muted">Removing the ticket takes it out of the line for good. Keeping it dismisses the request and the customer stays where they are.</p>
    </Modal>
  )
}
