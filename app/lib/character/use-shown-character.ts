'use client';

import { useEffect, useState } from 'react';
import { getProfileCharacterRepository, subscribeToShownCharacters, type ShownCharacter } from './profile-character-repository';

/**
 * The character `person` shows on their profile, or null. Read once, and again whenever the owner changes it in this
 * browser (so the profile behind the customiser follows at once). `undefined` while it is being read.
 */
export function useShownCharacter(person: string | null): ShownCharacter | null | undefined {
  const [state, setState] = useState<{ person: string | null; shown: ShownCharacter | null | undefined }>({ person, shown: undefined });
  // A new person starts unread, set during render as React recommends for state that follows a prop.
  if (state.person !== person) setState({ person, shown: undefined });

  useEffect(() => {
    if (person === null) return;
    let live = true;
    const read = () =>
      void getProfileCharacterRepository()
        .getShown(person)
        .then((shown) => {
          if (live) setState({ person, shown });
        })
        .catch(() => {
          if (live) setState({ person, shown: null });
        });
    read();
    const stop = subscribeToShownCharacters((changed) => {
      if (changed === person) read();
    });
    return () => {
      live = false;
      stop();
    };
  }, [person]);

  return person === null ? null : state.person === person ? state.shown : undefined;
}
