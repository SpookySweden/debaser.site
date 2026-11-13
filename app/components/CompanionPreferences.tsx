'use client';

import { useSyncExternalStore } from 'react';
import { companionOut, withSwitch } from '../lib/companion/choices';
import {
  companionChoicesState,
  serverCompanionChoices,
  setCompanionChoices,
  subscribeToCompanionChoices,
} from '../lib/companion/companion-slot';
import { useShownCharacter } from '../lib/character/use-shown-character';
import { usePhone } from '../lib/companion/use-phone';
import { TITLE_BAR_INACTIVE } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';

/** One choice's row: the same pressed-key look as the theme and cursor rows above it. */
function ChoiceRow({ label, note, active, onPress }: { label: string; note: string; active: boolean; onPress: () => void }) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={active}
      title={note}
      className={`flex w-full cursor-pointer items-center gap-2 px-2 py-1 text-left text-label max-sm:min-h-tap max-sm:px-3 max-sm:text-sm ${
        active ? 'key key-fill [--key-fill:var(--color-ink)] text-paper' : 'key'
      }`}
    >
      <span className="min-w-0 flex-1 truncate">[ {label} ]</span>
    </button>
  );
}

/**
 * The COMPANION row in Preferences (SPEC-companion.md, decision 2): your companion on or off on this kind of device (a
 * computer and a phone keep separate switches; a phone starts off). It always wears your profile's SHOWN character (Luke,
 * 2026-11-13: "Only the shown one"), so there is nothing to pick. Signed out, there is no companion and no row.
 */
export default function CompanionPreferences() {
  const { user } = useAuth();
  const choices = useSyncExternalStore(subscribeToCompanionChoices, companionChoicesState, serverCompanionChoices);
  const phone = usePhone();
  // A SHOWN character makes the companion on by default on a computer.
  const shown = useShownCharacter(user?.id ?? null);

  if (user === null || phone === null || shown === undefined) return null;

  const on = companionOut(choices, { signedIn: true, phone, hasShown: shown !== null });
  const where = phone ? 'ON THIS PHONE' : 'ON A COMPUTER';

  return (
    <section className="mt-2" data-companion-preferences>
      <div className={TITLE_BAR_INACTIVE}>
        <span title="YOUR CHARACTER, WALKING ALONG THE BOTTOM OF THE SITE">COMPANION</span>
      </div>

      <div className="space-y-1 p-2">
        <ChoiceRow
          label="ON"
          note={`YOUR COMPANION WALKS ALONG THE BOTTOM ${where}`}
          active={on}
          onPress={() => setCompanionChoices(withSwitch(choices, phone, true))}
        />
        <ChoiceRow
          label="OFF"
          note={`NO COMPANION ${where}`}
          active={!on}
          onPress={() => setCompanionChoices(withSwitch(choices, phone, false))}
        />
      </div>

    </section>
  );
}
