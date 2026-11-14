// Tiny DOM helpers. Pages are built with createElement/textContent (never innerHTML), so text a customer
// types can never turn into markup, and the strict Content-Security-Policy stays simple.

export const $ = (selector, root = document) => root.querySelector(selector);

/** h('button', { class: 'btn', onClick: fn, 'aria-label': 'Close' }, 'Label', childNode) */
export function h(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value); // CSSOM is allowed by CSP
    else if (/^on[A-Z]/.test(key) && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

export function mount(parent, ...kids) {
  parent.replaceChildren(...kids.flat(Infinity).filter(k => k !== null && k !== undefined && k !== false));
}

/* Line icons (24x24). Each is a list of [element, attributes]. */
const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  clock: [['circle', { cx: 12, cy: 12, r: 8.5 }], ['path', { d: 'M12 7.5V12l3 2' }]],
  check: [['path', { d: 'm5 12.5 4.5 4.5L19 7.5' }]],
  x: [['path', { d: 'm6 6 12 12M18 6 6 18' }]],
  up: [['path', { d: 'M12 19V5M6 11l6-6 6 6' }]],
  down: [['path', { d: 'M12 5v14M6 13l6 6 6-6' }]],
  bell: [['path', { d: 'M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.5h-15Z' }], ['path', { d: 'M10 20.5a2 2 0 0 0 4 0' }]],
  alert: [['path', { d: 'M12 4 21 19.5H3Z' }], ['path', { d: 'M12 10v4M12 16.8v.01' }]],
  ticket: [['path', { d: 'M4 8.5V6.5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2a2.5 2.5 0 0 0 0 5v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a2.5 2.5 0 0 0 0-5Z' }]],
  users: [['circle', { cx: 9, cy: 8.5, r: 3 }], ['path', { d: 'M3.5 19.5a5.5 5.5 0 0 1 11 0' }], ['circle', { cx: 17, cy: 9.5, r: 2.3 }], ['path', { d: 'M16.5 14.2a4.6 4.6 0 0 1 4.3 5' }]],
  megaphone: [['path', { d: 'M3.5 10.5v3a1 1 0 0 0 1 1H7l5.5 4v-13L7 9.5H4.5a1 1 0 0 0-1 1Z' }], ['path', { d: 'M16 9.5a3.5 3.5 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10' }]],
  pause: [['path', { d: 'M8.5 5.5v13M15.5 5.5v13' }]],
  print: [['path', { d: 'M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2' }], ['path', { d: 'M7 14h10v6H7Z' }]],
  download: [['path', { d: 'M12 4v11M7 11l5 5 5-5M5 20h14' }]],
  link: [['path', { d: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1' }]],
  volume: [['path', { d: 'M4 9.5v5h3.5L13 19V5L7.5 9.5Z' }], ['path', { d: 'M16.5 9a4 4 0 0 1 0 6M18.8 6.5a7.5 7.5 0 0 1 0 11' }]],
  volumeOff: [['path', { d: 'M4 9.5v5h3.5L13 19V5L7.5 9.5Z' }], ['path', { d: 'm16 9 5 6M21 9l-5 6' }]],
  expand: [['path', { d: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5' }]],
};

export function icon(name, size = 20) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(k, v);
  svg.classList.add('icon');
  for (const [tag, attrs] of ICONS[name] || []) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}
