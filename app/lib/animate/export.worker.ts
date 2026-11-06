/**
 * Building a GIF away from the pen and the page: finding each frame's colours is the slow part. gifenc (MIT) does the encoding.
 */
import { GIFEncoder, applyPalette, quantize } from 'gifenc';

type Message =
  | { type: 'begin'; width: number; height: number }
  | { type: 'frame'; pixels: ArrayBuffer; delay: number }
  | { type: 'finish' };

let encoder: ReturnType<typeof GIFEncoder> | null = null;
let width = 0;
let height = 0;

self.onmessage = (event: MessageEvent<Message>) => {
  const message = event.data;
  try {
    if (message.type === 'begin') {
      encoder = GIFEncoder();
      width = message.width;
      height = message.height;
      self.postMessage({ type: 'ready' });
    } else if (message.type === 'frame' && encoder !== null) {
      const pixels = new Uint8ClampedArray(message.pixels);
      const palette = quantize(pixels, 256);
      const index = applyPalette(pixels, palette);
      encoder.writeFrame(index, width, height, { palette, delay: message.delay });
      self.postMessage({ type: 'wrote' });
    } else if (message.type === 'finish' && encoder !== null) {
      encoder.finish();
      const bytes: Uint8Array = encoder.bytes();
      const copy = bytes.slice();
      self.postMessage({ type: 'done', bytes: copy }, { transfer: [copy.buffer] });
      encoder = null;
    }
  } catch (error) {
    self.postMessage({ type: 'error', error: String(error) });
  }
};
