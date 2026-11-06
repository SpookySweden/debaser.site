/**
 * Reads the lines away from the pen: pictures come in, a region map goes out. Painting never waits on this.
 */
import { buildRegionMap, lineMaskFromAlpha } from './regions-core';

type Request = { id: number; width: number; height: number; maxGap: number; pictures: ImageBitmap[] };

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, width, height, maxGap, pictures } = event.data;
  try {
    const started = performance.now();
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx === null) throw new Error('no 2d context');
    const mask = new Uint8Array(width * height);
    for (const picture of pictures) {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(picture, 0, 0);
      picture.close();
      lineMaskFromAlpha(ctx.getImageData(0, 0, width, height).data, width, height, mask);
    }
    const map = buildRegionMap(mask, width, height, maxGap);
    self.postMessage({ id, map, ms: performance.now() - started }, { transfer: [map.labels.buffer, map.isLine.buffer, map.boxes.buffer] });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
