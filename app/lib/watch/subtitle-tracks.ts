import { normaliseLanguage } from '../web/language';
import type { ArchiveSubtitleFile, SubtitleTrack } from '../web/subtitles';
import { fetchSubtitleVtt } from '../web/subtitles-client';
import type { SubtitleControl } from './playable';

/**
 * The SUBS key's players for the stage's own `<video>` (SPEC-subtitles.md): a stream's subtitle tracks, and an
 * Internet Archive video's subtitle files. Each is one viewer's: nothing is synced or stored, and a control is
 * made per play and undone (`detach`) when the play changes, since files share one element.
 */

export type VideoSubtitles = SubtitleControl & { detach: () => void };

function emitter() {
  const listeners = new Set<() => void>();
  return {
    emit: () => listeners.forEach((listener) => listener()),
    on: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear: () => listeners.clear(),
  };
}

/** A text track that is somebody's subtitles: not the empty `<track>` the stage keeps for screen readers, not ours. */
function isListed(track: TextTrack): boolean {
  return (track.kind === 'subtitles' || track.kind === 'captions') && (track.label.length > 0 || track.language.length > 0);
}

/**
 * A stream's own subtitle tracks, as the element knows them: hls.js and dash.js put each of a stream's subtitle
 * tracks on the element, and Safari's own HLS player does too. Showing one is setting its mode; hls.js follows
 * the element's choice and loads that track's parts.
 */
export function streamSubtitles(video: HTMLVideoElement): VideoSubtitles {
  const heard = emitter();
  const tracks = () => Array.from(video.textTracks).filter(isListed);
  const idOf = (track: TextTrack, index: number) => track.id || `${index}:${track.language}:${track.label}`;
  const changed = () => heard.emit();
  video.textTracks.addEventListener('addtrack', changed);
  video.textTracks.addEventListener('removetrack', changed);
  video.textTracks.addEventListener('change', changed);
  return {
    subtitles: () =>
      tracks().map((track, index): SubtitleTrack => ({
        id: idOf(track, index),
        language: normaliseLanguage(track.language || track.label),
        label: track.label || track.language,
        auto: /auto/i.test(track.label),
      })),
    get subtitle() {
      const listed = tracks();
      const index = listed.findIndex((track) => track.mode === 'showing');
      return index === -1 ? null : idOf(listed[index], index);
    },
    setSubtitle: (id) => {
      tracks().forEach((track, index) => {
        track.mode = idOf(track, index) === id ? 'showing' : 'disabled';
      });
      heard.emit();
    },
    onSubtitles: heard.on,
    detach: () => {
      video.textTracks.removeEventListener('addtrack', changed);
      video.textTracks.removeEventListener('removetrack', changed);
      video.textTracks.removeEventListener('change', changed);
      heard.clear();
    },
  };
}

/**
 * An Archive video's subtitle files (listed by our route from the item's metadata). A file is fetched only when
 * this viewer switches it on - through our route, which passes the Archive's text through and keeps nothing -
 * and shown as a `<track>` on the element; `detach` takes every track it added away and lets the text go.
 */
export function archiveSubtitles(video: HTMLVideoElement, item: string, files: readonly ArchiveSubtitleFile[]): VideoSubtitles {
  const heard = emitter();
  const list: SubtitleTrack[] = files.map((file) => ({ id: file.file, language: file.language, label: file.stem.split('/').pop() ?? file.file, auto: file.auto }));
  const added = new Map<string, { element: HTMLTrackElement; url: string }>();
  let now: string | null = null;
  let asked = 0;
  let detached = false;

  const show = (id: string | null) => {
    for (const [file, { element }] of added) element.track.mode = file === id ? 'showing' : 'disabled';
    hushOthers();
  };
  /** The browser may switch the stage's own empty <track> on beside ours, even after ours loads: only ours shows. */
  const hushOthers = () => {
    if (now === null) return;
    const ours = new Set(Array.from(added.values(), ({ element }) => element.track));
    for (const track of Array.from(video.textTracks)) if (!ours.has(track) && track.mode !== 'disabled') track.mode = 'disabled';
  };
  video.textTracks.addEventListener('change', hushOthers);

  return {
    subtitles: () => list,
    get subtitle() {
      return now;
    },
    setSubtitle: (id) => {
      if (id !== null && !list.some((track) => track.id === id)) return;
      now = id;
      const ask = ++asked;
      heard.emit();
      if (id === null || added.has(id)) {
        show(id);
        return;
      }
      void fetchSubtitleVtt(item, id).then((url) => {
        if (url === null || detached) {
          if (url !== null) URL.revokeObjectURL(url);
          // The text could not be had: the key goes back to what is really showing.
          if (!detached && ask === asked) {
            now = null;
            show(null);
            heard.emit();
          }
          return;
        }
        const track = list.find((each) => each.id === id);
        const element = document.createElement('track');
        element.kind = 'subtitles';
        element.label = track?.label ?? id;
        if (track?.language) element.srclang = track.language;
        element.src = url;
        element.dataset.subtitleFile = id;
        video.appendChild(element);
        added.set(id, { element, url });
        // Only the latest pick shows, if several were asked for in a row.
        show(ask === asked ? id : now);
      });
    },
    onSubtitles: heard.on,
    detach: () => {
      detached = true;
      video.textTracks.removeEventListener('change', hushOthers);
      for (const { element, url } of added.values()) {
        element.remove();
        URL.revokeObjectURL(url);
      }
      added.clear();
      heard.clear();
    },
  };
}
