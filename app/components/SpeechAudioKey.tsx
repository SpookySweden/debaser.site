'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { recallSpeechSound, setSpeechSound, setSpeechVolume, speechSoundOn, subscribeToSpeechSound } from '../lib/speech/blip';
import { PLATE_ON_BLACK, PLATE_ON_BLACK_PRESSED } from '../lib/ui/controls';
import { useMusicPlayer } from './MusicPlayerProvider';

const offOnServer = () => false;

/**
 * The key that lets you hear the characters talk (SPEC-character-speech.md; Luke, 2026-11-14: "give the character box
 * on the profile an audio button on the top right which starts muted, when unmuted you can hear what they are saying").
 *
 * `[ ♪ OFF ]` until it is pressed, a filled `♪ ON` while it is on (the site's look for a switch that is on), and the
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
      title={on ? 'Stop the voices' : 'Hear them talk'}
      data-speech-audio={on ? 'on' : 'off'}
      className={on ? `${PLATE_ON_BLACK_PRESSED} cursor-pointer` : PLATE_ON_BLACK}
    >
      {on ? '♪ ON' : '[ ♪ OFF ]'}
    </button>
  );
}
