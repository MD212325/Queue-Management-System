// Everything the customer pages say to the server. Same-origin, no credentials: these endpoints are public.

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request(method, path, body, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal: controller.signal,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) throw new ApiError((data && data.error) || `Request failed (${res.status})`, res.status, data);
    return data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(err.name === 'AbortError' ? 'The server took too long to answer.' : 'Cannot reach the server.', 0);
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  config: () => request('GET', '/config'),
  services: () => request('GET', '/services'),
  queue: () => request('GET', '/queue'),
  ticket: id => request('GET', `/ticket/${id}`),
  createTicket: body => request('POST', '/ticket', body),
  cancelTicket: (id, reason, secret) => request('POST', `/ticket/${id}/request_cancel`, { reason, secret }),
  pushKey: () => request('GET', '/push/key'),
  subscribe: body => request('POST', '/subscribe', body),
  networkInfo: () => request('GET', '/network-info'),
};
