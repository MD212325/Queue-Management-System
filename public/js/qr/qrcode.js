// A small, dependency-free QR Code generator (ISO/IEC 18004, Model 2).
//
// The old QR page loaded its generator from a CDN, which fails on a school network with no internet.
// This module covers what the app needs: text in byte mode (UTF-8), versions 1 to 20, all four error
// correction levels. 20 is far more than a URL needs (version 6 holds ~100 characters at level M).
//
//   const qr = encodeText('http://192.168.1.20:4000/kiosk.html', 'M');
//   qr.size      // modules per side
//   qr.dark(x,y) // true if that module is dark
//   toSvg(qr)    // SVG markup string
//
// Output is verified in tests by decoding it with an independent QR reader.

const ECC_INDEX = { L: 0, M: 1, Q: 2, H: 3 };
const ECC_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };
const MAX_VERSION = 20;

// Index 0 is unused so tables can be indexed by version (1..20).
const ECC_CODEWORDS_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28],
];
const NUM_ERROR_CORRECTION_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25],
];

const getBit = (value, i) => ((value >>> i) & 1) !== 0;

/* ------------------------------------------------------------ capacity maths */

function numRawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function numDataCodewords(ver, ecl) {
  const i = ECC_INDEX[ecl];
  return Math.floor(numRawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[i][ver] * NUM_ERROR_CORRECTION_BLOCKS[i][ver];
}

function alignmentPositions(ver) {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step = Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

/* ------------------------------------------------------------- Reed-Solomon */

function rsMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = rsMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = rsMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= rsMultiply(coef, factor); });
  }
  return result;
}

function addEccAndInterleave(data, ver, ecl) {
  const i = ECC_INDEX[ecl];
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[i][ver];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[i][ver];
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const blocks = [];
  const divisor = rsDivisor(blockEccLen);
  for (let b = 0, k = 0; b < numBlocks; b++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (b < numShortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (b < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const result = [];
  for (let col = 0; col < blocks[0].length; col++) {
    blocks.forEach((block, j) => {
      // Short blocks carry one padding slot in the data area; skip it.
      if (col !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[col]);
    });
  }
  return result;
}

/* ---------------------------------------------------------------- the grid */

class Grid {
  constructor(ver) {
    this.ver = ver;
    this.size = ver * 4 + 17;
    this.cells = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
    this.fixed = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
    this.drawFunctionPatterns();
  }

  setFunction(x, y, dark) {
    this.cells[y][x] = dark;
    this.fixed[y][x] = true;
  }

  drawFunctionPatterns() {
    const n = this.size;
    for (let i = 0; i < n; i++) { this.setFunction(6, i, i % 2 === 0); this.setFunction(i, 6, i % 2 === 0); }
    this.finder(3, 3); this.finder(n - 4, 3); this.finder(3, n - 4);
    const pos = alignmentPositions(this.ver);
    const last = pos.length - 1;
    pos.forEach((px, i) => pos.forEach((py, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return; // would overlap a finder
      this.alignment(px, py);
    }));
    this.drawFormat(0, 'L'); // reserve the area; real bits are written after the mask is chosen
    this.drawVersion();
  }

  finder(cx, cy) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < this.size && y >= 0 && y < this.size) this.setFunction(x, y, dist !== 2 && dist !== 4);
      }
    }
  }

  alignment(cx, cy) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }

  drawFormat(mask, ecl) {
    const data = (ECC_FORMAT_BITS[ecl] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const n = this.size;
    for (let i = 0; i <= 5; i++) this.setFunction(8, i, getBit(bits, i));
    this.setFunction(8, 7, getBit(bits, 6));
    this.setFunction(8, 8, getBit(bits, 7));
    this.setFunction(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFunction(14 - i, 8, getBit(bits, i));
    for (let i = 0; i < 8; i++) this.setFunction(n - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) this.setFunction(8, n - 15 + i, getBit(bits, i));
    this.setFunction(8, n - 8, true); // the always-dark module
  }

  drawVersion() {
    if (this.ver < 7) return;
    let rem = this.ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = getBit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunction(a, b, bit);
      this.setFunction(b, a, bit);
    }
  }

  drawCodewords(data) {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.fixed[y][x] && i < data.length * 8) {
            this.cells[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }

  applyMask(mask) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        let invert;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        }
        if (!this.fixed[y][x] && invert) this.cells[y][x] = !this.cells[y][x];
      }
    }
  }

  /** Lower is better: the standard four penalty rules that make a code easier for a camera to read. */
  penalty() {
    const n = this.size, c = this.cells;
    let score = 0;
    const line = get => { // runs of 5+ same-colour modules, and finder-like 1:1:3:1:1 patterns
      let run = 1;
      for (let i = 1; i < n; i++) {
        if (get(i) === get(i - 1)) { run++; if (run === 5) score += 3; else if (run > 5) score += 1; } else run = 1;
      }
      for (let i = 0; i + 11 <= n; i++) {
        const w = []; for (let k = 0; k < 11; k++) w.push(get(i + k) ? 1 : 0);
        const s = w.join('');
        if (s === '10111010000' || s === '00001011101') score += 40;
      }
    };
    for (let y = 0; y < n; y++) line(i => c[y][i]);
    for (let x = 0; x < n; x++) line(i => c[i][x]);
    for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) if (c[y][x] === c[y][x + 1] && c[y][x] === c[y + 1][x] && c[y][x] === c[y + 1][x + 1]) score += 3;
    let dark = 0;
    for (const row of c) for (const v of row) if (v) dark++;
    const total = n * n;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return score;
  }
}

/* ------------------------------------------------------------------ public */

export function encodeText(text, ecl = 'M') {
  if (!(ecl in ECC_INDEX)) throw new Error('Error correction level must be L, M, Q or H');
  const bytes = Array.from(new TextEncoder().encode(String(text)));

  let ver = 1;
  for (;; ver++) {
    if (ver > MAX_VERSION) throw new Error('That text is too long for a QR code here. Use a shorter address.');
    const countBits = ver <= 9 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= numDataCodewords(ver, ecl) * 8) break;
  }

  // Byte-mode segment: 0100, character count, the bytes; then terminator and padding.
  const bits = [];
  const push = (value, count) => { for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, ver <= 9 ? 8 : 16);
  bytes.forEach(b => push(b, 8));
  const capacityBits = numDataCodewords(ver, ecl) * 8;
  push(0, Math.min(4, capacityBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) push(pad, 8);

  const data = new Array(bits.length / 8).fill(0);
  bits.forEach((bit, i) => { data[i >>> 3] |= bit << (7 - (i & 7)); });

  const grid = new Grid(ver);
  grid.drawCodewords(addEccAndInterleave(data, ver, ecl));

  let best = 0, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    grid.applyMask(mask);
    grid.drawFormat(mask, ecl);
    const score = grid.penalty();
    if (score < bestScore) { bestScore = score; best = mask; }
    grid.applyMask(mask); // XOR again = undo
  }
  grid.applyMask(best);
  grid.drawFormat(best, ecl);

  return { version: ver, ecl, size: grid.size, mask: best, dark: (x, y) => x >= 0 && y >= 0 && x < grid.size && y < grid.size && grid.cells[y][x] };
}

/** SVG path data for the dark modules, plus the full side length including the quiet zone. */
export function qrPath(qr, border = 4) {
  const parts = [];
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (!qr.dark(x, y)) continue;
      let len = 1;
      while (x + len < qr.size && qr.dark(x + len, y)) len++;
      parts.push(`M${x + border},${y + border}h${len}v1h-${len}z`);
      x += len;
    }
  }
  return { total: qr.size + border * 2, d: parts.join('') };
}

/** Crisp vector output as markup (for downloads). `border` is the quiet zone in modules (the spec asks for 4). */
export function toSvg(qr, { border = 4, dark = '#000000', light = '#ffffff' } = {}) {
  const { total, d } = qrPath(qr, border);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="QR code">`
    + `<rect width="${total}" height="${total}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}

/** Draw onto a canvas at a whole number of pixels per module (keeps edges sharp for scanning). */
export function drawToCanvas(qr, canvas, { scale = 8, border = 4, dark = '#000', light = '#fff' } = {}) {
  const total = (qr.size + border * 2) * scale;
  canvas.width = canvas.height = total;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = light; ctx.fillRect(0, 0, total, total);
  ctx.fillStyle = dark;
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.dark(x, y)) ctx.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
  return canvas;
}
