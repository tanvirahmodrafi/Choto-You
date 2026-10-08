/**
 * A minimal GIF89a encoder, used only to build the animated figures in the
 * README from the bundled avatar's frames.
 *
 * GIF allows 256 colours per image, so the frames are reduced with a median
 * cut over every frame at once: one shared palette means the character's
 * colours cannot shift from frame to frame. One index is held back for
 * transparency, so the loops sit on whatever colour GitHub renders behind them.
 */
/** Median-cut palette over every frame, so colours cannot drift between them. */
export function quantize(frames, maxColors = 255) {
  const pixels = [];
  for (const f of frames) {
    const { rgba } = f;
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3] > 128) pixels.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
    }
  }
  let boxes = [pixels];
  while (boxes.length < maxColors) {
    boxes.sort((a, b) => spread(b) - spread(a));
    const box = boxes.shift();
    if (!box || box.length < 2 || spread(box) === 0) { if (box) boxes.push(box); break; }
    const ch = widestChannel(box);
    box.sort((a, b) => a[ch] - b[ch]);
    const mid = box.length >> 1;
    boxes.push(box.slice(0, mid), box.slice(mid));
  }
  return boxes.filter((b) => b.length).map((b) => {
    let r = 0, g = 0, bl = 0;
    for (const p of b) { r += p[0]; g += p[1]; bl += p[2]; }
    return [Math.round(r / b.length), Math.round(g / b.length), Math.round(bl / b.length)];
  });
}
function range(box, ch) {
  let lo = 255, hi = 0;
  for (const p of box) { if (p[ch] < lo) lo = p[ch]; if (p[ch] > hi) hi = p[ch]; }
  return hi - lo;
}
function spread(box) { return Math.max(range(box, 0), range(box, 1), range(box, 2)); }
function widestChannel(box) {
  const r = range(box, 0), g = range(box, 1), b = range(box, 2);
  return r >= g && r >= b ? 0 : g >= b ? 1 : 2;
}

function lzw(indices, minCodeSize) {
  const out = [];
  let cur = 0, curBits = 0;
  const block = [];
  const push = (code, size) => {
    cur |= code << curBits; curBits += size;
    while (curBits >= 8) { block.push(cur & 0xff); cur >>= 8; curBits -= 8; }
  };
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let dict = new Map(), next = eoi + 1, codeSize = minCodeSize + 1;
  const reset = () => { dict = new Map(); next = eoi + 1; codeSize = minCodeSize + 1; };
  push(clear, codeSize); reset();
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = prefix * 4096 + k;
    if (dict.has(key)) { prefix = dict.get(key); continue; }
    push(prefix, codeSize);
    dict.set(key, next++);
    if (next > (1 << codeSize)) {
      if (codeSize < 12) codeSize++;
      else { push(clear, codeSize); reset(); }
    }
    prefix = k;
  }
  push(prefix, codeSize);
  push(eoi, codeSize);
  if (curBits > 0) block.push(cur & 0xff);
  for (let i = 0; i < block.length; i += 255) {
    const slice = block.slice(i, i + 255);
    out.push(slice.length, ...slice);
  }
  out.push(0);
  return Buffer.from(out);
}

/** frames: [{ rgba, delayMs }], all width x height. */
export function encodeGif(width, height, frames, { loop = 0 } = {}) {
  const palette = quantize(frames);
  const transparentIndex = palette.length; // one past the colours
  const tableSize = Math.max(2, 1 << Math.ceil(Math.log2(palette.length + 1)));
  const cache = new Map();
  const nearest = (r, g, b) => {
    const key = (r >> 2) << 12 | (g >> 2) << 6 | (b >> 2);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i];
      const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    cache.set(key, best);
    return best;
  };

  const parts = [];
  parts.push(Buffer.from('GIF89a', 'latin1'));
  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(width, 0); lsd.writeUInt16LE(height, 2);
  lsd[4] = 0x80 | (Math.log2(tableSize) - 1); // global table, size
  parts.push(lsd);
  const table = Buffer.alloc(tableSize * 3);
  palette.forEach((p, i) => { table[i * 3] = p[0]; table[i * 3 + 1] = p[1]; table[i * 3 + 2] = p[2]; });
  parts.push(table);
  // Netscape looping extension
  const nab = Buffer.from([0x21, 0xff, 0x0b]);
  parts.push(Buffer.concat([nab, Buffer.from('NETSCAPE2.0', 'latin1'), Buffer.from([0x03, 0x01, loop & 0xff, (loop >> 8) & 0xff, 0x00])]));

  const minCodeSize = Math.max(2, Math.log2(tableSize));
  for (const f of frames) {
    const delay = Math.round(f.delayMs / 10);
    const gce = Buffer.alloc(8);
    gce[0] = 0x21; gce[1] = 0xf9; gce[2] = 0x04;
    gce[3] = (2 << 2) | 0x01; // disposal: restore to background, transparency on
    gce.writeUInt16LE(delay, 4);
    gce[6] = transparentIndex; gce[7] = 0x00;
    parts.push(gce);

    const img = Buffer.alloc(10);
    img[0] = 0x2c;
    img.writeUInt16LE(0, 1); img.writeUInt16LE(0, 3);
    img.writeUInt16LE(width, 5); img.writeUInt16LE(height, 7);
    img[9] = 0x00;
    parts.push(img);

    const idx = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < f.rgba.length; i += 4, p++) {
      idx[p] = f.rgba[i + 3] > 128 ? nearest(f.rgba[i], f.rgba[i + 1], f.rgba[i + 2]) : transparentIndex;
    }
    parts.push(Buffer.from([minCodeSize]), lzw(idx, minCodeSize));
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}
