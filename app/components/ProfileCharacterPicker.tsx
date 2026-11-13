'use client';

import { useEffect, useState } from 'react';
import { readLibrary, subscribeToLibrary, type SavedCharacter } from '../lib/character/library';
import { RIG_PRESETS, type RigPresetId } from '../lib/character/rig';
import { MOODS, type Mood } from '../lib/character/sheet';
import { hideFromProfile, setProfileMood, showOnProfile } from '../lib/character/show-on-profile';
import { useShownCharacter } from '../lib/character/use-shown-character';
import { PLATE, PLATE_PRESSED } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';

/**
 * ON YOUR PROFILE, in the [ CHAR ] tab (SPEC-profile-characters.md): which saved character lives on your profile, and its
 * mood. Picking one bakes it there and then: every motion drawn once, in this browser, as pixel art, and saved as one small
 * picture strip. Visitors only ever get the pictures.
 */
export default function ProfileCharacterPicker() {
  const { user, status } = useAuth();
  const person = status === 'signed-in' && user !== null ? user.id : null;
  const shown = useShownCharacter(person);
  const [shelf, setShelf] = useState<SavedCharacter[]>(readLibrary);
  const [work, setWork] = useState<{ kind: 'idle' | 'baking' | 'saving' | 'done' } | { kind: 'failed'; message: string }>({ kind: 'idle' });
  const [moodChoice, setMoodChoice] = useState<Mood>('calm');
  useEffect(() => subscribeToLibrary(() => setShelf(readLibrary())), []);

  if (person === null) {
    return <p className="px-2 py-1 text-label font-bold text-ink">SIGN IN TO PUT A CHARACTER ON YOUR PROFILE.</p>;
  }

  const mood = shown?.mood ?? moodChoice;
  const busy = work.kind === 'baking' || work.kind === 'saving';
  const shownStillSaved = shown !== null && shown !== undefined && shelf.some((character) => character.id === shown.characterId);

  async function pick(id: string) {
    if (person === null) return;
    try {
      if (id === '') {
        setWork({ kind: 'saving' });
        await hideFromProfile(person);
      } else {
        const character = shelf.find((entry) => entry.id === id);
        if (character === undefined) return;
        setWork({ kind: 'baking' });
        await showOnProfile(person, character, mood);
      }
      setWork({ kind: 'done' });
    } catch (error) {
      setWork({ kind: 'failed', message: error instanceof Error && /^[A-Z ,.']+$/.test(error.message) ? error.message : 'COULD NOT BAKE IT. TRY AGAIN.' });
    }
  }

  async function chooseMood(next: Mood) {
    setMoodChoice(next);
    if (person === null || shown === null || shown === undefined) return;
    try {
      setWork({ kind: 'saving' });
      await setProfileMood(person, next);
      setWork({ kind: 'done' });
    } catch {
      setWork({ kind: 'failed', message: 'COULD NOT SAVE THE MOOD.' });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink px-2 py-1 text-label font-bold text-ink">
      <label className="flex items-center gap-1" htmlFor="profile-character-pick">
        ON YOUR PROFILE
        <select
          id="profile-character-pick"
          value={shownStillSaved ? shown.characterId : ''}
          disabled={busy || shown === undefined}
          onChange={(event) => void pick(event.target.value)}
          className="frame bg-paper px-1 py-0.5 text-label text-ink max-sm:min-h-tap"
        >
          <option value="">NONE</option>
          {shelf.map((character) => (
            <option key={character.id} value={character.id}>
              {character.name} ({RIG_PRESETS[character.presetId as RigPresetId]?.label ?? 'FIGURE'})
            </option>
          ))}
        </select>
      </label>

      <span className="flex items-center gap-1" role="group" aria-label="Mood">
        MOOD
        {MOODS.map((entry) => (
          <button
            key={entry}
            type="button"
            disabled={busy}
            aria-pressed={mood === entry}
            onClick={() => void chooseMood(entry)}
            className={mood === entry ? PLATE_PRESSED : PLATE}
          >
            [ {entry.toUpperCase()} ]
          </button>
        ))}
      </span>

      <span role="status" className={work.kind === 'failed' ? 'bg-bubble-pale px-1 text-ink-bar' : ''}>
        {work.kind === 'baking'
          ? 'BAKING...'
          : work.kind === 'saving'
            ? 'SAVING...'
            : work.kind === 'failed'
              ? work.message
              : shown !== null && shown !== undefined
                ? 'ON YOUR PROFILE.'
                : shelf.length === 0
                  ? 'SAVE A CHARACTER FIRST.'
                  : ''}
      </span>
    </div>
  );
}
