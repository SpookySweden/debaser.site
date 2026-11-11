/**
 * Letting the visualiser hear what plays (Luke, 2026-11-11; the research's "two technical gotchas"). A browser lets a page
 * analyse a sound only when the sound's host allows it (CORS), and only when the page asked for it that way before loading
 * (`crossOrigin="anonymous"`). So:
 *
 *   - an address is asked that way only when its host is known to allow it: this site's own files, archive.org (checked
 *     2026-11-11: `Access-Control-Allow-Origin: *` on its file servers), and the site's Supabase storage; MEDIA audio
 *     through /api/web/audio only for the platforms whose files are archive.org's (the Archive, LibriVox). A podcast's
 *     host decides for itself, and most don't allow it, so a podcast is never asked that way;
 *   - should a host ever refuse after all, the element drops the request and loads the same address again plainly, so
 *     the music never stops for the sake of a picture (`prepareForAnalysis`);
 *   - the visualiser listens through a copy of the element's sound (`captureStream`), never by re-routing the element
 *     itself, so nothing anyone hears passes through the visualiser.
 */

const ARCHIVE_HOST = /^(?:www\.)?archive\.org$|^(?:ia|dn)\d{1,8}\.(?:[a-z]{2}\.)?archive\.org$/;
const ANALYSABLE_AUDIO_ROUTE = /^\/api\/web\/audio\/(internet_archive|audiobooks)\//;

function storageHost(): string | null {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname || null;
  } catch {
    return null;
  }
}

/** Whether an address's host lets the page analyse its sound. `origin` is this page's own (`window.location.origin`). */
export function analysableSrc(src: string | undefined | null, origin: string): boolean {
  if (!src) return false;
  let url: URL;
  try {
    url = new URL(src, origin);
  } catch {
    return false;
  }
  if (url.origin === origin) return !url.pathname.startsWith('/api/web/audio/') || ANALYSABLE_AUDIO_ROUTE.test(url.pathname);
  if (url.protocol !== 'https:') return false;
  return ARCHIVE_HOST.test(url.hostname) || url.hostname === storageHost();
}

/**
 * Called just before an element is given a new address: asks for it the analysable way only when its host allows it.
 * If that load fails anyway, the same address is loaded once more the plain way (the visualiser then goes quiet, the
 * music plays on). Returns whether it was asked the analysable way.
 */
export function prepareForAnalysis(element: HTMLMediaElement, src: string): boolean {
  const asked = typeof window !== 'undefined' && analysableSrc(src, window.location.origin);
  if (!asked) {
    element.removeAttribute('crossorigin');
    return false;
  }
  element.crossOrigin = 'anonymous';
  const retry = () => {
    if (element.getAttribute('crossorigin') === null || element.currentSrc === '' || !element.error) return;
    const at = element.currentTime;
    element.removeAttribute('crossorigin');
    element.load();
    if (at > 0) element.currentTime = at;
  };
  element.addEventListener('error', retry, { once: true });
  return true;
}

type Capturable = HTMLMediaElement & { captureStream?: () => MediaStream };

/**
 * A copy of an element's sound to listen to, or null where the browser can't give one or the host didn't allow it. Only
 * the standard `captureStream` (Chrome, Edge): Firefox's own `mozCaptureStream` takes the sound away from the speakers,
 * and Safari has neither, so there the visualiser moves on its own rhythm.
 */
export function tapSound(element: HTMLMediaElement | null): MediaStream | null {
  if (element === null || element.getAttribute('crossorigin') === null) return null;
  const capturable = element as Capturable;
  try {
    const stream = capturable.captureStream?.() ?? null;
    return stream !== null && stream.getAudioTracks().length > 0 ? stream : null;
  } catch {
    return null;
  }
}
