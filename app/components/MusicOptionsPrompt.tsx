'use client';

import { ACCENT_COLOUR, PLATE, PLATE_LARGE } from '../lib/ui/controls';
import { setKeysInPicture, useKeysInPicture } from '../lib/watch/keys-in-picture';
import { useOptionalAuth } from './AuthProvider';
import { useMusicPlayer } from './MusicPlayerProvider';
import PopoutWindow from './PopoutWindow';

/**
 * The player's options, one window for every way in.
 *
 * The profile screen opens this the first time there is a track to play; the player's
 * gear reopens it later. Everything here is the visitor's own choice, kept in the same
 * store the volume and loop already live in - so "play by default" and "don't show
 * again" survive a reload.
 */
export default function MusicOptionsPrompt({ onClose }: { onClose: () => void }) {
  const player = useMusicPlayer();
  const user = useOptionalAuth()?.user ?? null;
  const keysInPicture = useKeysInPicture(user?.id ?? null);

  return (
    <PopoutWindow
      title="PLAYER OPTIONS"
      onClose={onClose}
      maxWidth="max-w-sm"
      // Empty on purpose: no title-bar tip (the title names it; SPEC-less-text.md).
      status=""
    >
      <div className="space-y-3 text-label font-bold text-ink">
        <label className="flex items-center gap-2">
          <span className="w-28 shrink-0">DEFAULT VOLUME</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(player.volume * 100)}
            onChange={(event) => player.setVolume(Number(event.target.value) / 100)}
            className="h-4 flex-1 cursor-pointer"
            style={{ accentColor: ACCENT_COLOUR }}
            aria-label="Default volume"
          />
          <span className="w-7 text-right">{Math.round(player.volume * 100)}</span>
        </label>

        <button type="button" onClick={() => player.setPlayByDefault(!player.playByDefault)} className={PLATE_LARGE}>
          {player.playByDefault ? '[ AUTOPLAY PROFILES: ON ]' : '[ AUTOPLAY PROFILES: OFF ]'}
        </button>

        {/* ROOMBARS (Luke, 2026-11-21): a room's playback keys also along the foot of its picture (`keys-in-picture.ts`). */}
        <button
          type="button"
          onClick={() => setKeysInPicture(!keysInPicture)}
          aria-pressed={keysInPicture}
          aria-label="Keys in the picture: play, skip, back, seek, sound, full screen and picture in picture also along the foot of a room's picture"
          title="Also along the foot of a room's picture"
          className={PLATE_LARGE}
          data-keys-in-picture-toggle={keysInPicture ? 'on' : 'off'}
        >
          {keysInPicture ? '[ KEYS IN THE PICTURE: ON ]' : '[ KEYS IN THE PICTURE: OFF ]'}
        </button>

        <div className="flex flex-wrap items-center gap-2 border-t border-ink pt-2">
          <button
            type="button"
            onClick={() => {
              player.dismissPrompt();
              onClose();
            }}
            className={PLATE}
          >
            [ DON&apos;T SHOW AGAIN ]
          </button>
        </div>
      </div>
    </PopoutWindow>
  );
}
