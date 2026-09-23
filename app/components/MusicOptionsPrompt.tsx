'use client';

import { ACCENT_COLOUR, PLATE, PLATE_LARGE } from '../lib/ui/controls';
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

  return (
    <PopoutWindow
      title="PLAYER OPTIONS"
      badge="[ ♪ ]"
      onClose={onClose}
      maxWidth="max-w-sm"
      status="HOW A PROFILE'S TRACK SHOULD BEHAVE"
    >
      <div className="space-y-3 text-[10px] font-bold text-ink">
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
          {player.playByDefault ? '[ PLAY BY DEFAULT: ON ]' : '[ PLAY BY DEFAULT: OFF ]'}
        </button>

        <p className="text-ink">
          PLAY BY DEFAULT STARTS A PROFILE&apos;S TRACK AS SOON AS ITS PAGE LOADS. LEAVE IT OFF TO PRESS PLAY BY HAND.
        </p>

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
