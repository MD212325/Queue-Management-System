// QR poster page. The code is generated in the browser by ./qrcode.js: no internet, no library to download.
import { api } from '../shared/api.js';
import { $, h, icon, mount } from '../shared/dom.js';
import { drawToCanvas, encodeText, qrPath, toSvg } from './qrcode.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PATH = '/kiosk.html';
const isLocalHost = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);

const state = { school: 'STI Tanay', options: [], choice: '', custom: '', heading: 'Get your queue number' };

/* ------------------------------------------------------------- the address */

function buildOptions(lan) {
  const port = location.port ? `:${location.port}` : '';
  const options = lan.map(a => ({
    id: `lan-${a.address}`, label: `${location.protocol}//${a.address}${port}`, tag: 'Recommended',
    hint: `This computer on ${a.interface}. Phones on the same Wi-Fi can reach it.`, base: `${location.protocol}//${a.address}${port}`,
  }));
  options.push({
    id: 'here', label: location.origin, base: location.origin,
    hint: isLocalHost ? 'Only works on this computer. Phones cannot open "localhost".' : 'The address you are using right now.',
  });
  options.push({ id: 'custom', label: 'Another address…', hint: 'For example a school domain name.', base: '' });
  return options;
}

function currentBase() {
  const opt = state.options.find(o => o.id === state.choice);
  if (!opt) return '';
  return opt.id === 'custom' ? state.custom.trim() : opt.base;
}

function currentUrl() {
  const base = currentBase();
  if (!base) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(base) ? base : `http://${base}`);
    if (!/^https?:$/.test(u.protocol)) return null;
    return `${u.origin}${PATH}`;
  } catch { return null; }
}

/* ---------------------------------------------------------------- drawing */

function qrElement(qr) {
  const { total, d } = qrPath(qr, 0);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QR code that opens the queue page');
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', total); bg.setAttribute('height', total); bg.setAttribute('fill', '#fff');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d); path.setAttribute('fill', '#000');
  svg.append(bg, path);
  return svg;
}

function paintPoster() {
  const url = currentUrl();
  let qr = null;
  if (url) { try { qr = encodeText(url, 'Q'); } catch { try { qr = encodeText(url, 'M'); } catch { qr = null; } } }
  state.qr = qr; state.url = url;

  mount($('#poster'),
    h('header', {}, h('img', { src: '/img/sti-logo-sm.png', alt: '', width: 160, height: 114 }), h('b', { text: state.school })),
    h('main', {},
      h('h2', { text: state.heading || 'Get your queue number' }),
      h('p', { class: 'sub', text: 'Scan with your phone camera. No app needed.' }),
      qr ? h('div', { class: 'frame' }, qrElement(qr)) : h('div', { class: 'broken', text: 'Choose a valid address to see the QR code.' }),
      url ? h('div', { class: 'link', text: url.replace(/^https?:\/\//, '') }) : null,
      h('ol', {},
        h('li', {}, h('b', { text: '1' }), 'Scan the code'),
        h('li', {}, h('b', { text: '2' }), 'Pick your services'),
        h('li', {}, h('b', { text: '3' }), 'Wait for your number. We will alert you.'))),
    h('footer', { text: 'Please keep the page open on your phone while you wait.' }));

  for (const id of ['print', 'png', 'svg', 'copy']) $(`#${id}`).disabled = !qr;
  paintAdvice(url);
}

function paintAdvice(url) {
  const el = $('#advice');
  el.className = 'advice';
  if (!url) { el.textContent = 'That address does not look right. Use something like http://192.168.1.20:4000'; el.classList.add('warn'); return; }
  const host = new URL(url).hostname;
  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    el.textContent = 'Phones cannot open "localhost". Choose this computer\'s network address above.';
    el.classList.add('warn');
  } else if (url.startsWith('http://')) {
    el.textContent = 'This works on the school Wi-Fi. Alerts while the page is closed need https; otherwise customers keep the page open.';
  } else el.textContent = '';
}

function paintOptions() {
  mount($('#options'), state.options.map(o => h('label', { class: 'opt' },
    h('input', { type: 'radio', name: 'address', value: o.id, checked: o.id === state.choice, onChange: () => { state.choice = o.id; $('#custom-wrap').hidden = o.id !== 'custom'; paintPoster(); } }),
    h('span', {}, h('b', {}, o.label, o.tag ? h('span', { class: 'tag', text: o.tag }) : null), h('small', { text: o.hint })))));
  $('#custom-wrap').hidden = state.choice !== 'custom';
}

/* ---------------------------------------------------------------- actions */

function say(text) {
  $('#status').textContent = text;
  clearTimeout(say.t);
  say.t = setTimeout(() => { $('#status').textContent = ''; }, 4000);
}

function download(name, blob) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function copyLink() {
  try { await navigator.clipboard.writeText(state.url); say('Link copied.'); }
  catch {
    const tmp = h('input', { type: 'text', value: state.url, 'aria-hidden': 'true' });
    document.body.append(tmp); tmp.select();
    let done = false; try { done = document.execCommand('copy'); } catch { /* ignore */ }
    tmp.remove();
    say(done ? 'Link copied.' : `Copy this link: ${state.url}`);
  }
}

function wire() {
  mount($('#print'), icon('print'), 'Print poster');
  mount($('#png'), icon('download', 18), 'Save PNG');
  mount($('#svg'), icon('download', 18), 'Save SVG');
  mount($('#copy'), icon('link', 18), 'Copy link');
  $('#print').addEventListener('click', () => window.print());
  $('#png').addEventListener('click', () => {
    if (!state.qr) return;
    const canvas = drawToCanvas(state.qr, document.createElement('canvas'), { scale: 16, border: 4 });
    canvas.toBlob(blob => { if (blob) { download('queue-qr.png', blob); say('PNG saved.'); } }, 'image/png');
  });
  $('#svg').addEventListener('click', () => { if (state.qr) { download('queue-qr.svg', new Blob([toSvg(state.qr)], { type: 'image/svg+xml' })); say('SVG saved.'); } });
  $('#copy').addEventListener('click', () => { if (state.url) copyLink(); });
  $('#custom').addEventListener('input', e => { state.custom = e.target.value; paintPoster(); });
  $('#heading').addEventListener('input', e => { state.heading = e.target.value; paintPoster(); });
}

async function start() {
  wire();
  let lan = [];
  try { state.school = (await api.config()).schoolName || state.school; } catch { /* keep default */ }
  try { lan = (await api.networkInfo()).addresses || []; } catch { /* no network info: manual entry still works */ }
  state.options = buildOptions(lan);
  state.choice = isLocalHost && lan.length ? state.options[0].id : 'here';
  document.title = `QR poster · ${state.school}`;
  paintOptions();
  paintPoster();
}

start();
