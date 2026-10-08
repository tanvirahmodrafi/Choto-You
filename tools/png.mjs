import { deflateSync, inflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encode an RGBA8 buffer (width*height*4) as a PNG. */
export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  // 10..12 = compression, filter, interlace -> all 0

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Decode a PNG to an RGBA8 buffer.
 *
 * Covers what the artwork in `art/` actually is: 8 bits per channel, no
 * interlacing, greyscale or truecolour with or without alpha. Anything else
 * throws rather than quietly producing a wrong picture — these inputs are
 * committed files, so an unsupported one is a mistake to fix at the source, not
 * a case to paper over.
 */
export function decodePng(buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (const [index, byte] of signature.entries()) {
    if (buffer[index] !== byte) throw new Error('Not a PNG file.');
  }

  let width = 0;
  let height = 0;
  let depth = 0;
  let colourType = 0;
  const parts = [];

  for (let offset = 8; offset + 8 <= buffer.length; ) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colourType = body[9];
      if (depth !== 8) throw new Error(`Only 8-bit PNGs are supported, got ${depth}-bit.`);
      if (body[12] !== 0) throw new Error('Interlaced PNGs are not supported.');
    } else if (type === 'IDAT') {
      parts.push(body);
    } else if (type === 'IEND') {
      break;
    }
  }

  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colourType];
  if (!channels) throw new Error(`Unsupported PNG colour type ${colourType}.`);

  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);

  // Undo the per-scanline filters. Each line is predicted from the one above
  // and the pixel to the left, so this has to run in order.
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const previous = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? out[x - channels] : 0;
      const up = previous ? previous[x] : 0;
      const upLeft = previous && x >= channels ? previous[x - channels] : 0;
      let value = line[x];
      switch (filter) {
        case 0:
          break;
        case 1:
          value += left;
          break;
        case 2:
          value += up;
          break;
        case 3:
          value += (left + up) >> 1;
          break;
        case 4: {
          // Paeth: whichever neighbour the gradient points at.
          const p = left + up - upLeft;
          const dLeft = Math.abs(p - left);
          const dUp = Math.abs(p - up);
          const dUpLeft = Math.abs(p - upLeft);
          value += dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft;
          break;
        }
        default:
          throw new Error(`Unknown PNG filter type ${filter}.`);
      }
      out[x] = value & 0xff;
    }
  }

  if (channels === 4) return { width, height, rgba: pixels };

  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const source = i * channels;
    const grey = channels <= 2;
    rgba[i * 4] = grey ? pixels[source] : pixels[source];
    rgba[i * 4 + 1] = grey ? pixels[source] : pixels[source + 1];
    rgba[i * 4 + 2] = grey ? pixels[source] : pixels[source + 2];
    rgba[i * 4 + 3] = channels === 2 ? pixels[source + 1] : 255;
  }
  return { width, height, rgba };
}
