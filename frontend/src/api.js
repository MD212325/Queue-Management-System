// Everything the panel says to the server. The staff key is typed by a person and exchanged for a
// short-lived session token; the key itself is never stored in this app or in the JS bundle.

const BASE = import.meta.env.VITE_API_URL || ''
const STORE = 'qms_session'

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message)
    this.status = status
    this.data = data
  }
}

export const session = {
  read() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE) || 'null')
      if (s && s.token && (!s.expires_at || Date.parse(s.expires_at) > Date.now())) return s
    } catch { /* corrupted storage: treat as signed out */ }
    return null
  },
  save(s) { try { localStorage.setItem(STORE, JSON.stringify(s)) } catch { /* private mode */ } },
  clear() { try { localStorage.removeItem(STORE) } catch { /* ignore */ } },
}

async function request(method, path, body) {
  const s = session.read()
  let res
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(s ? { Authorization: `Bearer ${s.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError('Cannot reach the server. Check the network connection.', 0)
  }
  let data = null
  const text = await res.text()
  try { data = text ? JSON.parse(text) : null } catch { /* not JSON (csv etc.) */ }
  if (!res.ok) throw new ApiError((data && data.error) || `Request failed (${res.status})`, res.status, data)
  return data === null ? text : data
}

export const api = {
  base: BASE,
  login: key => request('POST', '/auth/login', { key }),
  snapshot: () => request('GET', '/admin/snapshot'),
  history: () => request('GET', '/admin/history'),
  callNext: service => request('POST', '/next', { service }),
  serve: (id, service) => request('POST', `/serve/${id}`, { service }),
  hold: id => request('POST', `/hold/${id}`),
  recall: id => request('POST', `/recall/${id}`),
  extend: (id, seconds) => request('POST', `/ticket/${id}/extend`, { seconds }),
  clearCancel: id => request('POST', `/ticket/${id}/clear_cancel`),
  remove: id => request('DELETE', `/ticket/${id}`),
  createTicket: body => request('POST', '/ticket', body),
  reports: range => request('GET', `/admin/reports?range=${range}`),
  createService: body => request('POST', '/admin/services', body),
  saveService: (key, body) => request('PUT', `/admin/services/${encodeURIComponent(key)}`, body),
  purge: days => request('POST', '/admin/purge', { older_than_days: days }),
  csv: type => request('GET', `/export.csv?type=${type}`),
}

/** Server-sent events do not allow custom headers, so the stream carries no personal data. */
export const eventsUrl = () => `${BASE}/events`
