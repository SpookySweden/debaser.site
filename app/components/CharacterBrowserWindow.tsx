'use client';

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import {
  characterBrowserState,
  closeCharacterBrowser,
  confirmCharacterRemoval,
  subscribeToCharacterBrowser,
} from '../lib/character/browser-window';
import {
  readLibrary,
  removeCharacter,
  persistLibrary,
  saveCharacter,
  type SavedCharacter,
} from '../lib/character/library';
import { RIG_PRESETS, type RigPresetId } from '../lib/character/rig';
import { MASS_SHAPES } from '../lib/character/shapes';
import { useCharacterStore } from '../lib/character/store';
import { PLATE, PLATE_LARGE, TITLE_BAR_INACTIVE } from '../lib/ui/controls';
import PopoutWindow from './PopoutWindow';

/** Spelled out for the note, so the limit is stated rather than paraphrased. */
const MAX_SAVED_LABEL = 40;

/**
 * The saved characters, as a shelf.
 *
 * **The three verbs a shelf needs, and no fourth.** LOAD puts a figure on the bench, SAVE KEEPS THE ONE THAT IS
 * THERE (so the shelf is also how a figure is kept in the first place, rather than a second control in the
 * sidebar), and REMOVE forgets one. Anything else - renaming, duplicating, folders - is a file manager, and a
 * character creator is not one.
 *
 * **It reads the store rather than being handed its figure**, because it is drawn in `layout.tsx` where there is no
 * parent to hand it anything: the same reason every other window here reads its own state. That also means opening
 * it cannot re-render the workbench behind it.
 */
export default function CharacterBrowserWindow() {
  const state = useSyncExternalStore(subscribeToCharacterBrowser, characterBrowserState, characterBrowserState);
  const skeleton = useCharacterStore((store) => store.skeleton);
  const presetId = useCharacterStore((store) => store.presetId);
  const loadSkeleton = useCharacterStore((store) => store.loadSkeleton);
  const markKept = useCharacterStore((store) => store.markKept);

  /**
   * The shelf, read **once, lazily, during the first render**.
   *
   * **Not an effect, which is what the lint rule caught and it was right.** The obvious shape is
   * `useEffect(() => setShelf(readLibrary()), [])`, and it is wrong twice: an effect that sets state runs a second
   * render for a value that was available before the first one, and it would flash "nothing saved yet" over a shelf
   * that has figures on it. A lazy initializer reads storage exactly once, at the moment the component first needs
   * the value, and never again - so there is no second render and no empty frame.
   *
   * Writes go through `persistLibrary`, so the state and storage cannot diverge: every mutation below computes the
   * next shelf and hands the same array to both.
   */
  const [shelf, setShelf] = useState<SavedCharacter[]>(readLibrary);
  const [name, setName] = useState('');

  /** A per-preset tally, which is what makes a full shelf scannable. Derived, never stored beside it. */
  const counts = useMemo(() => {
    const tally: Record<string, number> = {};
    for (const character of shelf) tally[character.presetId] = (tally[character.presetId] ?? 0) + 1;
    return tally;
  }, [shelf]);

  const update = useCallback((next: SavedCharacter[]) => {
    setShelf(next);
    persistLibrary(next);
  }, []);

  function keep() {
    update(saveCharacter(shelf, { name, presetId, skeleton }));
    setName('');
    // The figure on the bench is now the one just kept, so it stops being unsaved work.
    markKept();
  }

  /**
   * Nothing is drawn until the shelf is open.
   *
   * **The guard is here rather than around the whole component**, because the hooks above must run on every render:
   * a `return null` before them would change the number of hooks between renders, which React reports as an error
   * and which unmounts the tree. Reading the shelf while shut costs one `localStorage` read on mount and nothing
   * afterwards.
   */
  if (!state.open) return null;

  return (
    <PopoutWindow
      title="SAVED CHARACTERS"
      badge={`[ ${shelf.length} ]`}
      onClose={closeCharacterBrowser}
      maxWidth="max-w-3xl"
      status="LOAD PUTS A FIGURE ON THE BENCH :: SAVING AGAIN REPLACES THE FIGURE ON IT, NOT THIS LIST"
    >
      <div className="space-y-2 text-[10px] text-ink">
        <div className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale p-2">
          <p className="font-bold">KEEP THE FIGURE THAT IS ON THE BENCH</p>

          <div className="mt-1 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1" htmlFor="character-save-name">
              NAME
              <input
                id="character-save-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="FIGURE"
                maxLength={24}
                className="w-40 rounded-none border-2 border-t-black border-l-black border-r-white border-b-white bg-paper px-1 py-[2px] text-[10px] text-ink"
              />
            </label>

            <button type="button" onClick={keep} className={PLATE_LARGE}>
              [ SAVE TO THE SHELF ]
            </button>
          </div>

          <p className="mt-1 text-ink-plate">
            LEAVE THE NAME EMPTY AND IT IS NUMBERED. THIS SHELF HOLDS UP TO {MAX_SAVED_LABEL} FIGURES; SAVING BEYOND
            THAT DROPS THE OLDEST.
          </p>
        </div>

        {shelf.length === 0 ? (
          <p className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale p-3 font-bold">
            NOTHING SAVED YET. BUILD A FIGURE ON THE CHAR TAB, THEN PRESS [ SAVE TO THE SHELF ] ABOVE.
          </p>
        ) : (
          <ul className="divide-y divide-ink rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale">
            {shelf.map((character) => {
              const presetLabel = RIG_PRESETS[character.presetId as RigPresetId]?.label ?? 'UNKNOWN';
              const shapes = Object.values(character.skeleton.joints).filter((joint) => joint.mass !== null).length;
              const confirming = state.confirmingId === character.id;

              return (
                <li key={character.id} className="flex flex-wrap items-center gap-2 p-2">
                  <span className="min-w-40 grow">
                    <span className="font-bold">{character.name}</span>
                    <span className="ml-2 text-ink-plate">
                      {presetLabel} :: {shapes} SHAPES :: {new Date(character.savedAt).toLocaleString()}
                    </span>
                  </span>

                  <button
                    type="button"
                    className={PLATE}
                    onClick={() => {
                      loadSkeleton(character.skeleton, character.presetId as RigPresetId);
                      closeCharacterBrowser();
                    }}
                  >
                    [ LOAD ]
                  </button>

                  {/*
                   * **REMOVE is two presses, and the confirmation is in the row.** A shelf that forgets a figure on
                   * one mis-aimed click is a shelf that loses work, and a modal for it would be a second window over
                   * a window - so the row swaps its own button for YES/NO, which is the two-press rule the board's
                   * own destructive verbs follow.
                   */}
                  {confirming ? (
                    <>
                      <button
                        type="button"
                        className={`${PLATE} bg-bubble-pale text-paper`}
                        onClick={() => {
                          update(removeCharacter(shelf, character.id));
                          confirmCharacterRemoval(null);
                        }}
                      >
                        [ YES, FORGET IT ]
                      </button>
                      <button type="button" className={PLATE} onClick={() => confirmCharacterRemoval(null)}>
                        [ NO ]
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={PLATE}
                      onClick={() => confirmCharacterRemoval(character.id)}
                      aria-label={`Forget ${character.name}`}
                    >
                      [ REMOVE ]
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className={TITLE_BAR_INACTIVE}>
          <span>
            BY PRESET:{' '}
            {Object.entries(counts)
              .map(([id, total]) => `${id.toUpperCase()} ${total}`)
              .join(' :: ') || 'NONE'}
          </span>
          <span>[ {shelf.length} ]</span>
        </div>

        <p className="text-ink-plate">
          FIGURES LIVE IN THIS BROWSER, PER ACCOUNT. THE SHAPE VOCABULARY IS {Object.values(MASS_SHAPES).length}{' '}
          PRIMITIVES, SO A FIGURE TAKEN OFF THIS SHELF KEEPS WHICHEVER OF THEM IT USES.
        </p>
      </div>
    </PopoutWindow>
  );
}
