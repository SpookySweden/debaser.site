/** gifenc ships no types; these are the parts ANIMATE uses. */
declare module 'gifenc' {
  export type GifPalette = number[][];
  export function GIFEncoder(): {
    writeFrame(index: Uint8Array, width: number, height: number, options: { palette: GifPalette; delay: number; repeat?: number }): void;
    finish(): void;
    bytes(): Uint8Array;
  };
  export function quantize(pixels: Uint8ClampedArray, colours: number): GifPalette;
  export function applyPalette(pixels: Uint8ClampedArray, palette: GifPalette): Uint8Array;
}
