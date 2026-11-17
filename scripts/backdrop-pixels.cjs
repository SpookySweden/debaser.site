/*
 * How many of a simulated background's cells show something inside a box of screen pixels, read off the screen.
 *
 * The drives used to read the background's canvas straight (`getContext('2d').getImageData`), but FLUID's canvas is handed to
 * a thread of its own now (PERF 1b, 2026-11-17: `app/lib/backdrops/backdrop.worker.ts`), and a canvas handed over can't be read
 * from the page. So it is read from a screenshot taken with everything but the background see-through for that moment (ink
 * under a window still counts, as it did). Each cell is read at its middle; a cell counts when it is not
 * empty: not (near) black, and not (near) the theme's ground that empty water is painted in while the background's THEME is
 * on (the canvas says which, `data-ground`). `sum` changes when what is drawn there changes.
 *
 *   const { backdropCells } = require('./backdrop-pixels.cjs');
 *   const seen = await backdropCells(page, { x, y, width, height }, 'Temp/browse/cells.png');
 *   // { count, cells, sum }
 */
const { readPng } = require('./png-read.cjs');

async function backdropCells(page, box, file) {
  const where = await page.evaluate(() => {
    const canvas = document.querySelector('.backdrop-canvas');
    const rect = canvas.getBoundingClientRect();
    return { cell: Number(canvas.dataset.cell), ground: Number(canvas.dataset.ground || 0), left: rect.left, top: rect.top, vw: window.innerWidth, vh: window.innerHeight };
  });
  // The ground as the engine packs a colour (alpha, blue, green, red from the top byte down); 0 is none.
  const ground = where.ground > 0 ? [where.ground & 255, (where.ground >>> 8) & 255, (where.ground >>> 16) & 255] : null;
  const empty = (r, g, b) => r + g + b < 24 || (ground !== null && Math.abs(r - ground[0]) <= 8 && Math.abs(g - ground[1]) <= 8 && Math.abs(b - ground[2]) <= 8);
  if (!(where.cell > 0)) throw new Error('the background canvas has no data-cell');
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(where.vw, Math.ceil(box.x + box.width));
  const y1 = Math.min(where.vh, Math.ceil(box.y + box.height));
  const seen = { count: 0, cells: 0, sum: 0 };
  if (x1 <= x0 || y1 <= y0) return seen;
  // Only the background, for the moment of the picture: everything else see-through (opacity, which the background's own
  // reading of where windows are takes no notice of), so ink under a window is seen as the old canvas read saw it.
  await page.evaluate(() => {
    for (let at = document.querySelector('.backdrop-canvas'); at !== null; at = at.parentElement) at.setAttribute('data-peek-keep', '');
    const style = document.createElement('style');
    style.id = 'backdrop-peek';
    style.textContent = 'body *:not([data-peek-keep]) { opacity: 0 !important; transition: none !important; animation: none !important; }';
    document.head.appendChild(style);
  });
  try {
    await page.screenshot({ path: file, clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
  } finally {
    await page.evaluate(() => {
      document.getElementById('backdrop-peek')?.remove();
      for (const kept of document.querySelectorAll('[data-peek-keep]')) kept.removeAttribute('data-peek-keep');
    });
  }
  const shot = readPng(file);
  if (shot.error) throw new Error(`could not read ${file}: ${shot.error}`);
  const { cell, left, top } = where;
  for (let gy = Math.floor((y0 - top) / cell); top + gy * cell < y1; gy += 1) {
    const cy = Math.floor(top + gy * cell + cell / 2) - y0;
    if (cy < 0 || cy >= shot.height) continue;
    for (let gx = Math.floor((x0 - left) / cell); left + gx * cell < x1; gx += 1) {
      const cx = Math.floor(left + gx * cell + cell / 2) - x0;
      if (cx < 0 || cx >= shot.width) continue;
      seen.cells += 1;
      const at = (cy * shot.width + cx) * shot.channels;
      const [r, g, b] = [shot.pixels[at], shot.pixels[at + 1], shot.pixels[at + 2]];
      if (empty(r, g, b)) continue;
      seen.count += 1;
      seen.sum += (r * 3 + g * 5 + b * 7 + gx * 11 + gy * 13) % 9973;
    }
  }
  return seen;
}

module.exports = { backdropCells };
