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
 *     itself, so nothing anyone hears passes through the visualiser;
 *   - **one copy for each element, taken once and kept** (`tapSound`). Measured in Chrome and Edge on 2026-11-14
 *     (`Temp/probe-tap.cjs`): taking a second copy of an element silences the first, and when the element starts a
 *     new song the kept copy gains a new track while the old track stays "live" and silent. So the copy is never
 *     taken again, and whoever listens follows its newest live track (`soundTrack`). Before this the visualiser took
 *     a fresh copy every two seconds, which dropped the sound each time.
 *
 * Nothing here records, keeps or sends sound: a copy is only ever measured, in the page, while the picture is drawn.
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

/** The one copy kept for each element: a second copy would silence the first (see the note at the top). */
const taps = new WeakMap<HTMLMediaElement, MediaStream>();

/**
 * The copy of an element's sound to listen to, or null where the browser can't give one or the host didn't allow it.
 * Taken once for each element and kept; ask as often as you like. Only the standard `captureStream` (Chrome, Edge):
 * Firefox's own `mozCaptureStream` takes the sound away from the speakers, and Safari has neither, so there the
 * visualiser moves on its own rhythm (`whyDeaf` says which).
 */
export function tapSound(element: HTMLMediaElement | null): MediaStream | null {
  if (element === null || element.getAttribute('crossorigin') === null) return null;
  const kept = taps.get(element);
  if (kept !== undefined) return kept;
  const capturable = element as Capturable;
  try {
    const stream = capturable.captureStream?.() ?? null;
    if (stream === null) return null;
    taps.set(element, stream);
    return stream;
  } catch {
    return null;
  }
}

/**
 * The track of a kept copy that carries the sound now: its newest live one. Each new song adds a track and leaves the
 * one before it live and silent, so the first track is the wrong one from the second song on. Null before the first
 * song has loaded.
 */
export function soundTrack(stream: MediaStream | null): MediaStreamTrack | null {
  if (stream === null) return null;
  const live = stream.getAudioTracks().filter((track) => track.readyState === 'live');
  return live.length > 0 ? live[live.length - 1] : null;
}

/**
 * Why the visualiser can't hear what plays, for the line that says so: an outside `player` (YouTube, Vimeo, PeerTube)
 * that never shares its sound, a `browser` with no way to copy a sound without taking it from the speakers (Firefox,
 * Safari), or a `host` that doesn't allow its files to be analysed (most podcasts). Null when it can hear.
 */
export function whyDeaf(element: HTMLMediaElement | null): 'player' | 'browser' | 'host' | null {
  if (element === null) return 'player';
  if (typeof (element as Capturable).captureStream !== 'function') return 'browser';
  if (element.getAttribute('crossorigin') === null) return 'host';
  return null;
}
