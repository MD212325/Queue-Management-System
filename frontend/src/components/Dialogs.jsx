import { useState } from 'react'
import { api } from '../api.js'
import { serviceLabel } from '../utils.js'
import { Button, Icon, Modal, Switch, useAction } from './ui.jsx'

/** Walk-in ticket. Services are numbered in the order they are picked, which is the order the customer visits them. */
export function NewTicketDialog({ services, types, onClose, onCreated }) {
  const run = useAction()
  const [name, setName] = useState('')
  const [type, setType] = useState(types[0] || '')
  const [route, setRoute] = useState([])
  const [priority, setPriority] = useState(false)
  const [busy, setBusy] = useState(false)
  const active = services.filter(s => s.enabled)

  const toggle = key => setRoute(r => (r.includes(key) ? r.filter(k => k !== key) : [...r, key]))

  async function submit(e) {
    e.preventDefault()
    if (!route.length) return
    setBusy(true)
    const t = await run(() => api.createTicket({ name, quer_type: type, services: route, priority }), r => `Ticket ${r.displayToken} created`)
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
            {types.map(t => <option key={t}>{t}</option>)}
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
        <label className="priority-check span-2">
          <input type="checkbox" checked={priority} onChange={e => setPriority(e.target.checked)} />
          <span><b><Icon name="star" size={15} filled /> Priority</b><small>Senior citizen, person with a disability, or pregnant. Called before regular tickets.</small></span>
        </label>
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

const BREAK_PRESETS = ['Lunch break', 'Back in 10 minutes', 'Short break', 'Staff meeting']

/** Put a counter on a break: customers see why, and nobody can be called until it is resumed. */
export function PauseDialog({ service, onClose, onConfirm }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  async function go() { setBusy(true); await onConfirm(note); setBusy(false); onClose() }
  return (
    <Modal title={`Pause ${service.label}?`} onClose={onClose} width={500}
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="coffee" busy={busy} onClick={go}>Pause counter</Button>
      </>}>
      <p className="muted">While paused, customers cannot take new numbers for this counter and nobody can be called. A visit already at the counter can still be completed. The kiosk and the display show your message.</p>
      <div className="chips">
        {BREAK_PRESETS.map(p => (
          <button key={p} type="button" className={`chip ${note === p ? 'on' : ''}`} aria-pressed={note === p} onClick={() => setNote(p)}>{p}</button>
        ))}
      </div>
      <label className="field">
        <span>Message for customers <em>(optional)</em></span>
        <input value={note} maxLength={80} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go() }} placeholder="For example: Back at 1:00 PM" data-autofocus />
      </label>
    </Modal>
  )
}

const MESSAGE_PRESETS = [
  'Please have your ID and documents ready.',
  'The Registrar will close for lunch at 12:00 PM.',
  'The Cashier is on a short break. Thank you for waiting.',
  'Please keep your phone with you. We will alert you when it is your turn.',
]
const DURATIONS = [[10, '10 seconds'], [20, '20 seconds'], [30, '30 seconds'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes']]

/** Automatic announcements on/off, and a message for the public display and customers' phones. */
export function AnnounceDialog({ snap, isAdmin, onClose, act }) {
  const [text, setText] = useState('')
  const [seconds, setSeconds] = useState(30)
  const [speak, setSpeak] = useState(true)
  const [busy, setBusy] = useState(false)
  const live = snap.announcement

  async function send() {
    setBusy(true)
    const out = await act.sendAnnouncement(text.trim(), seconds, speak)
    setBusy(false)
    if (out) setText('')
  }

  return (
    <Modal title="Announce" onClose={onClose} width={580} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="toggle-row">
        <Switch checked={snap.settings.autoAnnounce} disabled={!isAdmin} label="Announce every call on the display"
          onChange={v => act.setSettings({ autoAnnounce: v })} />
        <span>
          <b>Announce every call on the public display</b>
          <small>{isAdmin
            ? 'Turned off, calls still appear on the display but are only spoken when you press "Announce again" on a counter.'
            : 'Only an administrator can change this setting.'}</small>
        </span>
      </div>

      <section className="ann-send">
        <h3>Send a message</h3>
        <label className="field">
          <span className="sr-only">Message</span>
          <textarea rows={3} maxLength={200} value={text} onChange={e => setText(e.target.value)} placeholder="Type a message for the display and customers' phones" data-autofocus />
        </label>
        <div className="chips">
          {MESSAGE_PRESETS.map(p => <button key={p} type="button" className="chip" onClick={() => setText(p)}>{p}</button>)}
        </div>
        <div className="ann-options">
          <label className="field inline"><span>Show for</span>
            <select value={seconds} onChange={e => setSeconds(Number(e.target.value))}>{DURATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label className="check"><input type="checkbox" checked={speak} onChange={e => setSpeak(e.target.checked)} /> Read it aloud on the display</label>
        </div>
        <Button variant="primary" icon="send" busy={busy} disabled={!text.trim()} onClick={send}>Send message</Button>
      </section>

      {live ? (
        <div className="ann-live" role="status">
          <Icon name="volume" size={18} />
          <div><b>On screen now</b><span>{live.text}</span></div>
          <Button size="sm" onClick={() => act.clearAnnouncement()}>Clear</Button>
        </div>
      ) : null}
    </Modal>
  )
}
