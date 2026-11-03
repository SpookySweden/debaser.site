'use client';

import { useEffect, useRef, useState } from 'react';
import { PLATE_ON_BLACK, PLATE_ON_BLACK_PRESSED } from '../lib/ui/controls';
import { AUTO_QUALITY, type QualityControl, type SubtitleControl } from '../lib/watch/playable';
import type { LanguageTag } from '../lib/web/language';
import { audioLanguage, choiceOf, defaultSubtitle, orderSubtitles, subtitleName, trackForChoice, type SubtitleChoice, type SubtitleTrack } from '../lib/web/subtitles';
import ArtMark from './ArtMark';
import LanguageFlag from './LanguageFlag';

/**
 * Three keys of the stream room's player bar (SPEC-watch-together.md, reworked 2026-11-02): the speaker with its
 * slim volume slider, QUALITY, and SUBS (SPEC-subtitles.md). The bar is black in both themes, so both are on-black keys.
 */

/** The speaker marks (`mark-speaker`, `mark-speaker-muted` in app/lib/ui/art/slots.ts), shown at 16px. */
const SPEAKER_SRC = '/assets/icons/speaker.png';
const SPEAKER_MUTED_SRC = '/assets/icons/speaker-muted.png';
const MARK_SIZE = 16;
/** Until the drawings land: the system font's speaker, asked for as a symbol rather than a coloured emoji. */
const SPEAKER_GLYPH = '\u{1F508}︎';
const SPEAKER_MUTED_GLYPH = '\u{1F507}︎';

/** The sound key (a press mutes and unmutes) and the volume beside it. A phone has its own volume keys. */
export function SpeakerKey({ muted, volume, onMuted, onVolume }: { muted: boolean; volume: number; onMuted: (muted: boolean) => void; onVolume: (volume: number) => void }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      <button type="button" className={`${PLATE_ON_BLACK} shrink-0`} aria-pressed={muted} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'} onClick={() => onMuted(!muted)}>
        {/* The symbol at the drawing's own 16px, so it reads as a speaker rather than a dot. */}
        {muted ? (
          <ArtMark key="muted" src={SPEAKER_MUTED_SRC} size={MARK_SIZE} fallback={<span className="text-title leading-none">{SPEAKER_MUTED_GLYPH}</span>} />
        ) : (
          <ArtMark key="sound" src={SPEAKER_SRC} size={MARK_SIZE} fallback={<span className="text-title leading-none">{SPEAKER_GLYPH}</span>} />
        )}
      </button>
      <input
        type="range"
        aria-label="Volume"
        min={0}
        max={1}
        step={0.05}
        // Muted reads as empty, as a player's slider does; moving it brings the sound back.
        value={muted ? 0 : volume}
        onChange={(event) => {
          onVolume(Number(event.target.value));
          if (muted) onMuted(false);
        }}
        className="h-3 w-16 shrink-0 accent-sun max-sm:hidden"
      />
    </span>
  );
}

/**
 * What this viewer last picked, by what the key says (`720P`, `HIGH`), offered to each new video whose
 * player has a choice of the same name. By name, not id: a stream's ids are its own level numbers, so the
 * same id on the next stream can be a different height. Null is AUTO, which every player starts on.
 */
let preferredLabel: string | null = null;

/**
 * QUALITY: what the player on the stage can be asked for (playable.ts), in a little list over the key. Not
 * drawn while there is nothing to choose - a plain file has one quality, and some sites will not let a video
 * be changed.
 */
export function QualityKey({ source }: { source: QualityControl | null }) {
  const [, heard] = useState(0);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (source === null) return;
    return source.onQualities(() => heard((count) => count + 1));
  }, [source]);

  const choices = source?.qualities() ?? [];
  const current = source?.quality ?? AUTO_QUALITY;
  const offered = choices.map((choice) => choice.id).join();

  // A new video whose player has what was picked last time starts on it.
  useEffect(() => {
    if (source === null || preferredLabel === null) return;
    const same = source.qualities().find((choice) => choice.label === preferredLabel);
    if (same !== undefined && source.quality !== same.id) source.setQuality(same.id);
  }, [source, offered]);

  // The list closes on a press anywhere else, or ESC.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (boxRef.current !== null && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  if (source === null || choices.length === 0) return null;
  const label = choices.find((choice) => choice.id === current)?.label ?? 'AUTO';

  return (
    <span ref={boxRef} className="relative shrink-0">
      <button type="button" className={PLATE_ON_BLACK} aria-haspopup="menu" aria-expanded={open} aria-label={`Quality: ${label}`} title="Quality" onClick={() => setOpen((value) => !value)} data-watch-quality={current}>
        [ {label} ▴ ]
      </button>
      {open ? (
        // Over the key, so opening it moves nothing on the bar.
        <span role="menu" aria-label="Quality" className="absolute bottom-full right-0 z-30 mb-1 flex min-w-24 flex-col frame bg-ink-plate p-1">
          {choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              role="menuitemradio"
              aria-checked={choice.id === current}
              className={`${PLATE_ON_BLACK} text-left`}
              onClick={() => {
                preferredLabel = choice.id === AUTO_QUALITY ? null : choice.label;
                source.setQuality(choice.id);
                setOpen(false);
              }}
            >
              {choice.id === current ? `▶ ${choice.label}` : `  ${choice.label}`}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

/**
 * What this viewer last picked on SUBS inside a series, carried on to its next episode (SPEC-subtitles.md); a
 * video outside that series starts from the rule. Only this tab's: never synced, never stored.
 */
let carried: { seriesId: string; choice: SubtitleChoice } | null = null;

function carry(seriesId: string, choice: SubtitleChoice) {
  carried = { seriesId, choice };
}

/**
 * SUBS (SPEC-subtitles.md, Luke 2026-11-03): `[ SUBS: [flag] ▾ ]` when the video on the stage has subtitles to
 * switch, its pop-up listing OFF, the human-made languages, then the AUTO ones. Each viewer's own: a pick changes
 * only this player. A video starts on English when its audio isn't English (or on the series' carried pick);
 * subtitles burned into the picture say `SUBS: [flag] IN PICTURE`, with nothing to open. The room keys it by the
 * play, so a skip while the pop-up is open closes it and the next video starts from its own rule.
 */
export function SubsKey({
  source,
  seriesId,
  textAudio,
  burnedIn,
}: {
  source: SubtitleControl | null;
  /** The playing episode's series (one add), for the carried pick; null outside a series. */
  seriesId: string | null;
  /** The audio's language as its title (or the Archive item) says. */
  textAudio: LanguageTag | null;
  burnedIn: LanguageTag | null;
}) {
  const [, heard] = useState(0);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLSpanElement>(null);
  /** This viewer picked during this play (the key is per play): from then on their pick stands, OFF included, through seeks. */
  const picked = useRef(false);

  useEffect(() => {
    if (source === null) return;
    return source.onSubtitles(() => heard((count) => count + 1));
  }, [source]);

  const tracks = source === null ? [] : orderSubtitles(source.subtitles());
  const current = source?.subtitle ?? null;
  const offered = tracks.map((track) => track.id).join();

  // The start, as the player says what it carries (a stream may list its tracks one by one): the series' carried
  // pick, else the rule. Asked again only when the list changes, and never once this viewer has picked.
  useEffect(() => {
    if (source === null || picked.current || tracks.length === 0) return;
    const carriedHere = carried !== null && seriesId !== null && carried.seriesId === seriesId ? trackForChoice(tracks, carried.choice) : undefined;
    const target = carriedHere !== undefined ? carriedHere : defaultSubtitle(tracks, audioLanguage(tracks, textAudio));
    if (target !== source.subtitle) source.setSubtitle(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, offered]);

  // The list closes on a press anywhere else, or ESC.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (boxRef.current !== null && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  if (tracks.length === 0) {
    if (burnedIn === null) return null;
    return (
      <span className="flex shrink-0 items-center gap-1" data-watch-subs="in-picture">
        SUBS: <LanguageFlag tag={burnedIn} subtitles onBar /> IN PICTURE
      </span>
    );
  }

  const showing = tracks.find((track) => track.id === current) ?? null;
  const name = showing === null ? 'OFF' : `${subtitleName(showing)}${showing.auto ? ' (AUTO)' : ''}`;
  const pick = (track: SubtitleTrack | null) => {
    picked.current = true;
    source?.setSubtitle(track === null ? null : track.id);
    if (seriesId !== null) carry(seriesId, choiceOf(track));
    setOpen(false);
  };

  return (
    // On a phone the list spans the bar (the bar is its anchor), so it opens as a sheet the width of the screen.
    <span ref={boxRef} className="shrink-0 sm:relative">
      <button
        type="button"
        className={`${PLATE_ON_BLACK} inline-flex items-center gap-1`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Subtitles: ${name}`}
        title="Subtitles"
        onClick={() => setOpen((value) => !value)}
        data-watch-subs={current ?? 'off'}
      >
        [ SUBS:{' '}
        {showing !== null && showing.language !== null ? <LanguageFlag tag={showing.language} subtitles onBar /> : <span>{showing === null ? 'OFF' : name}</span>} ▾ ]
      </button>
      {open ? (
        <span
          role="menu"
          aria-label="Subtitles"
          className="absolute bottom-full right-0 z-30 mb-1 flex max-h-72 min-w-48 flex-col overflow-y-auto frame bg-ink-plate p-1 max-sm:left-0 max-sm:max-h-[60vh]"
          data-watch-subs-menu
        >
          {[null, ...tracks].map((track) => {
            const on = (track?.id ?? null) === current;
            return (
              <button
                key={track?.id ?? 'off'}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                className={`${on ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK} flex items-center gap-1.5 text-left max-sm:min-h-tap`}
                onClick={() => pick(track)}
                data-subs-choice={track?.id ?? 'off'}
              >
                {track === null ? (
                  'OFF'
                ) : (
                  <>
                    {track.language !== null ? <LanguageFlag tag={track.language} subtitles onBar={!on} /> : null}
                    <span>{subtitleName(track)}</span>
                    {track.auto ? <span>AUTO</span> : null}
                  </>
                )}
              </button>
            );
          })}
        </span>
      ) : null}
    </span>
  );
}
