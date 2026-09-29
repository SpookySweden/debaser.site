/**
 * Read a PNG's pixels with no image library, so "is the figure drawn" can be answered from the screenshot.
 *
 * The screenshot is the composited page - what a person sees - and unlike a WebGL drawing buffer it is stable,
 * so it is the honest thing to measure. `readPixels` inside `requestAnimationFrame` told us the renderer runs;
 * this tells us what survived to the screen.
 *
 * A PNG is decompressed here by hand because this is a scratch script and `pngjs` would be a dependency added
 * for one diagnostic. Only what a screenshot from Chrome produces is supported: 8-bit RGBA, no interlacing,
 * filter types 0-4. Anything else returns a clear refusal rather than a wrong count.
 */
const { inflateSync } = require('node:zlib');

function readPng(file) {
  const buffer = require('node:fs').readFileSync(file);
  if (buffer.readUInt32BE(0) !== 0x89504e47) return { error: 'not a PNG' };

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colourType = data[9];
      if (data[12] !== 0) return { error: 'interlaced PNG unsupported' };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }

    offset += 12 + length;
  }

  if (bitDepth !== 8) return { error: `bit depth ${bitDepth} unsupported` };
  if (colourType !== 6 && colourType !== 2) return { error: `colour type ${colourType} unsupported` };

  const channels = colourType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);

  // Undo the per-scanline filters. Each row starts with a filter byte; the filters reference the row above and
  // the byte to the left, so they have to be replayed in order.
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prior = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);

    for (let x = 0; x < stride; x += 1) {
      const rawByte = line[x];
      const left = x >= channels ? out[x - channels] : 0;
      const up = prior[x];
      const upLeft = x >= channels ? prior[x - channels] : 0;

      let value;
      if (filter === 0) value = rawByte;
      else if (filter === 1) value = rawByte + left;
      else if (filter === 2) value = rawByte + up;
      else if (filter === 3) value = rawByte + ((left + up) >> 1);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value = rawByte + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      } else return { error: `filter ${filter} unsupported` };

      out[x] = value & 0xff;
    }
  }

  return { width, height, channels, pixels };
}

module.exports = { readPng };
