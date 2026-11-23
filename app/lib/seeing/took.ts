/** How long something took, as the status line and a refusal's trace say it: 412 MS under a second, 15.2 S over. Pure. */
export function took(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} MS` : `${(ms / 1000).toFixed(1)} S`;
}

/** How big something is, as the status line says it: 812 B, 48 KB, 1.4 MB (1024s). Pure. */
export function weighs(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const weighed = new WeakMap<object, number>();

/** The page as its site sent it, in bytes, counted once a page (its files are not in it). */
export function pageBytes(document: { html: string }): number {
  let bytes = weighed.get(document);
  if (bytes === undefined) {
    bytes = new TextEncoder().encode(document.html).length;
    weighed.set(document, bytes);
  }
  return bytes;
}
