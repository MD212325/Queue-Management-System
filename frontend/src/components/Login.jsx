import { useState } from 'react'
import { api, session } from '../api.js'
import { Button, Icon } from './ui.jsx'

export default function Login({ onSignedIn }) {
  const [key, setKey] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!key.trim()) { setError('Enter the staff key to continue.'); return }
    setBusy(true)
    setError('')
    try {
      const res = await api.login(key.trim())
      session.save(res)
      onSignedIn(res)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <section className="login-brand" aria-hidden="true">
        <img src="/sti-logo.png" alt="" width="84" height="60" />
        <h1>Queue console</h1>
        <p>Call, time and complete every visit from one place.</p>
        <ul>
          <li><Icon name="timer" size={18} /> Time allotments for every counter</li>
          <li><Icon name="users" size={18} /> Live line with estimated waits</li>
          <li><Icon name="chart" size={18} /> Daily service reports</li>
        </ul>
      </section>
      <section className="login-form">
        <form onSubmit={submit} noValidate>
          <h2>Sign in</h2>
          <p className="muted">Use the staff key from your administrator.</p>
          <label htmlFor="key">Staff key</label>
          <div className="input-wrap">
            <input id="key" name="key" type={show ? 'text' : 'password'} value={key} autoFocus autoComplete="current-password"
              onChange={e => setKey(e.target.value)} aria-invalid={!!error} aria-describedby={error ? 'key-err' : undefined} />
            <button type="button" className="icon-btn" aria-label={show ? 'Hide key' : 'Show key'} onClick={() => setShow(s => !s)}>
              <Icon name={show ? 'eyeOff' : 'eye'} size={17} />
            </button>
          </div>
          {error ? <p id="key-err" className="field-error" role="alert">{error}</p> : null}
          <Button variant="primary" size="lg" className="wide" busy={busy} type="submit">Sign in</Button>
        </form>
      </section>
    </main>
  )
}
