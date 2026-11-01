/**
 * Two fingerprints of a file, both computed in the browser before anything is uploaded.
 *
 *   sha256   of the bytes. Two files with the same hash are the same file, so the catalogue keeps one
 *            row per hash and a second upload of the same picture or song is answered with the original.
 *   dHash    of how a picture *looks*: the image is shrunk to 9x8 grey pixels and each pixel is compared
 *            with its right-hand neighbour, which gives 64 bits that survive resizing, re-saving and
 *            small colour changes. Two pictures whose hashes differ in few bits look alike, so the
 *            composer can recommend the original. It is a nudge, not a gate: crops and recolours are
 *            found poorly and rotations not at all (SPEC-media-catalogue.md, risks).
 *
 * No library and no AI: `crypto.subtle` and a canvas are all either needs.
 */

export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The looks-alike hash of a picture, 16 hex characters; undefined when the picture cannot be read. */
export async function imageLooksHash(file: Blob): Promise<string | undefined> {
  if (typeof document === 'undefined') return undefined;

  const url = URL.createObjectURL(file);

  try {
    const image = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = 9;
    canvas.height = 8;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) return undefined;

    // The best downscale the browser offers, so this hash sits close to the one the migration script
    // computes with sharp for the files that were here first (the two are not identical: a nudge).
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, 9, 8);
    const { data } = context.getImageData(0, 0, 9, 8);

    const grey: number[] = [];
    for (let index = 0; index < data.length; index += 4) {
      grey.push(0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]);
    }

    return hashFromGrey(grey);
  } catch {
    return undefined;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 64 comparisons (each pixel against its right-hand neighbour, 8 per row) packed into 16 hex characters. */
export function hashFromGrey(grey: number[]): string {
  let bits = '';

  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const left = grey[row * 9 + column];
      const right = grey[row * 9 + column + 1];
      bits += left > right ? '1' : '0';
    }
  }

  let hex = '';
  for (let index = 0; index < 64; index += 4) {
    hex += parseInt(bits.slice(index, index + 4), 2).toString(16);
  }

  return hex;
}

/** How many of the 64 bits differ. 0 is the same picture; up to about 10 looks the same. */
export function hashDistance(a: string, b: string): number {
  if (a.length !== b.length) return 64;

  let distance = 0;
  for (let index = 0; index < a.length; index += 1) {
    let xor = parseInt(a[index], 16) ^ parseInt(b[index], 16);
    while (xor > 0) {
      distance += xor & 1;
      xor >>= 1;
    }
  }

  return distance;
}

/** Two looks-alike hashes are a match at or under this distance. */
export const LOOKS_ALIKE_DISTANCE = 10;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('THE PICTURE COULD NOT BE READ.'));
    image.src = url;
  });
}

/** A picture's pixel size, read in the browser; undefined when it cannot be read. */
export async function imageSize(file: Blob): Promise<{ width: number; height: number } | undefined> {
  if (typeof document === 'undefined') return undefined;

  const url = URL.createObjectURL(file);

  try {
    const image = await loadImage(url);
    return { width: image.naturalWidth, height: image.naturalHeight };
  } catch {
    return undefined;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A sound or video file's running time as a list prints it (`5:12`); undefined when it cannot be read. */
export async function mediaLength(file: Blob, kind: 'audio' | 'video'): Promise<string | undefined> {
  if (typeof document === 'undefined') return undefined;

  const url = URL.createObjectURL(file);
  const element = document.createElement(kind);

  try {
    const seconds = await new Promise<number>((resolve, reject) => {
      element.preload = 'metadata';
      element.onloadedmetadata = () => resolve(element.duration);
      element.onerror = () => reject(new Error('THE FILE COULD NOT BE READ.'));
      element.src = url;
    });

    if (!Number.isFinite(seconds)) return undefined;

    const whole = Math.round(seconds);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const rest = whole % 60;
    const two = (value: number) => String(value).padStart(2, '0');

    return hours > 0 ? `${hours}:${two(minutes)}:${two(rest)}` : `${minutes}:${two(rest)}`;
  } catch {
    return undefined;
  } finally {
    element.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
}
