// Push notifications: lets the phone alert its owner even with the page closed.
import { api } from '../shared/api.js';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(base64Url) {
  const pad = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob((base64Url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

export async function registerWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('/sw.js'); } catch { return null; }
}

/** 'unsupported' | 'server-off' | 'blocked' | 'ready' (can ask) | 'on' (already allowed) */
export async function availability() {
  if (!supported()) return 'unsupported';
  try {
    const { publicKey } = await api.pushKey();
    if (!publicKey) return 'server-off';
  } catch { return 'unsupported'; }
  if (Notification.permission === 'denied') return 'blocked';
  return Notification.permission === 'granted' ? 'on' : 'ready';
}

/** Must be called from a tap when permission is still undecided. Returns the new availability. */
export async function enable(mine) {
  if (!supported()) return 'unsupported';
  const { publicKey } = await api.pushKey();
  if (!publicKey) return 'server-off';
  if (Notification.permission === 'default') await Notification.requestPermission();
  if (Notification.permission !== 'granted') return Notification.permission === 'denied' ? 'blocked' : 'ready';

  const reg = (await registerWorker()) && (await navigator.serviceWorker.ready);
  if (!reg) return 'unsupported';
  const wanted = keyBytes(publicKey);
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with an older server key would silently fail, so replace it.
  if (sub && sub.options && sub.options.applicationServerKey) {
    const have = new Uint8Array(sub.options.applicationServerKey);
    if (have.length !== wanted.length || have.some((v, i) => v !== wanted[i])) { await sub.unsubscribe(); sub = null; }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wanted });
  await api.subscribe({ subscription: sub.toJSON(), ticketId: mine.id, secret: mine.secret || '' });
  return 'on';
}
