'use client';

import { useEffect, useRef, useState } from 'react';
import { PLATE_ON_BLACK } from '../lib/ui/controls';
import { AUTO_QUALITY, type QualityControl } from '../lib/watch/playable';
import ArtMark from './ArtMark';

/**
 * Two keys of the stream room's player bar (SPEC-watch-together.md, reworked 2026-11-02): the speaker with its
 * slim volume slider, and QUALITY. The bar is black in both themes, so both are on-black keys.
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

/** What this viewer last picked, offered to each new video whose player has the same choice. */
let preferredQuality = AUTO_QUALITY;

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
    if (source === null || preferredQuality === AUTO_QUALITY) return;
    if (source.quality !== preferredQuality && source.qualities().some((choice) => choice.id === preferredQuality)) source.setQuality(preferredQuality);
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
                preferredQuality = choice.id;
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
