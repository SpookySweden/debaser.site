'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { recallSpeechSound, setSpeechSound, setSpeechVolume, speechSoundOn, subscribeToSpeechSound } from '../lib/speech/blip';
import { PLATE_ON_BLACK, PLATE_ON_BLACK_PRESSED } from '../lib/ui/controls';
import { useMusicPlayer } from './MusicPlayerProvider';
import { explain } from '../lib/ui/explain';

const offOnServer = () => false;

/**
 * The key that lets you hear the characters talk (SPEC-character-speech.md; Luke, 2026-11-14: "give the character box
 * on the profile an audio button on the top right which starts muted, when unmuted you can hear what they are saying").
 *
 * `[ ♪ ]` with the note struck through until it is pressed, filled while it is on (the site's look for a switch that is
 * on; Luke, 2026-11-16: a symbol, no words on it), and the
 * choice is remembered in this browser, one choice for the whole site. Its own press is the press a browser needs
 * before it will sound anything. The voices follow the music bar's VOL, at about half the music's level.
 *
 * Drawn on a strip that is dark in both themes (a room's title bar), so it wears the keys made for those.
 */
export default function SpeechAudioKey() {
  const on = useSyncExternalStore(subscribeToSpeechSound, speechSoundOn, offOnServer);
  const { volume } = useMusicPlayer();

  useEffect(() => {
    recallSpeechSound();
  }, []);

  useEffect(() => {
    setSpeechVolume(volume);
  }, [volume]);

  return (
    <button
      type="button"
      onClick={() => setSpeechSound(!on)}
      aria-pressed={on}
      aria-label="Character voices"
      title={on ? 'Voices on: press to stop them' : 'Voices off: press to hear them talk'}
      data-speech-audio={on ? 'on' : 'off'}
      {...explain(on ? 'Turns the characters\' voices off.' : 'Turns the characters\' voices on, so you hear them talk.', 'The little sounds the characters make when they speak. Only on your device.')}
      className={on ? `${PLATE_ON_BLACK_PRESSED} cursor-pointer` : PLATE_ON_BLACK}
    >
      {/* A symbol only (Luke, 2026-11-16): the note, struck through while the voices are off; filled while they are on.
          Text, not a drawn icon; the name and the tip say it in words. */}
      [ <span className={on ? undefined : 'line-through'}>♪</span> ]
    </button>
  );
}
