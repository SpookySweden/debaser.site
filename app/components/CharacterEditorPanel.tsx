'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { TITLE_BAR_INACTIVE } from '../lib/ui/controls';
import { useCharacterStore } from '../lib/character/store';

/**
 * The canvas is loaded in the browser only, and this is the whole reason the import is wrapped.
 *
 * `@react-three/fiber` reaches for `window` when its module is evaluated. This panel sits inside
 * `ProfileCustomiserWindow`, which `/account` renders on the server, so a plain import would run Three.js
 * where there is no browser and no GPU - and the build would fail before anybody saw a figure. `ssr: false`
 * is the documented escape, and `loading` is a plate rather than a spinner because nothing on this site
 * spins.
 */
const CharacterViewport = dynamic(() => import('./CharacterViewport'), {
  ssr: false,
  loading: () => (
    <p className="p-4 text-[10px] font-bold text-ink">LOADING THE WORKBENCH...</p>
  ),
});

/**
 * The character workbench: a 3D rig on the left, the mass that hangs off it on the right, and the controls
 * that drive both.
 *
 * **A tab of its own, `[ CHAR 🐰 ]`, and it is the middle of the customiser's three.** The other two describe an
 * account - its name, its picture, what visitors may see - and this is a third kind of thing: a workbench you sit
 * at. It is a tab rather than a panel at the foot of another one because it needs the window's full width for its
 * sidebar and two viewports, and (the reason it moved) because a workbench reached by scrolling past the dressing
 * controls reads as one more field on a form rather than as a place.
 *
 * This comment previously said the opposite - "a panel at the end of the dressing tab, not a tab of its own" -
 * and was left behind when the workbench got its own tab in `ProfileCustomiserWindow`'s `TABS`. A comment that
 * contradicts the code is worse than no comment, so it is corrected rather than deleted: the reasoning above is
 * why the tab exists, and the note is what stops the old wording coming back.
 *
 * **The layout is a 50/50 split with a sidebar, and the split is the point.** A figure being built from a
 * skeleton is easy to get wrong in one axis and right in another - an arm that reads correctly from the
 * front but sits behind the body from the side - and those two facts have to be visible at once or the
 * second one is never noticed. Hence front and side side by side rather than one view with a toggle.
 *
 * The workspace carries an **explicit height** rather than `flex-1`, because `PopoutWindow` scrolls its body
 * with `overflow-y-auto`: a canvas that sized itself to its content would be a canvas with no height at all,
 * and one that stretched would fight the scroll box. The figure sits in a `sticky` frame inside that height
 * so scrolling the customiser moves the controls past and leaves the model where it is.
 */
export default function CharacterEditorPanel({ onTouched }: { onTouched?: () => void }) {
  /**
   * **The panel reports that the figure was touched, because the figure has no stored form to compare against.**
   *
   * Every other field in the customiser can answer "is this unsaved?" by comparing a draft with what is stored.
   * This one cannot: the workbench has no persistence at all, so the moment anything is dragged, scaled or
   * reshaped, the figure is different from what a reload would bring back and nothing can say so except this.
   *
   * The subscription is a store *event* rather than a field: it fires on any change to the skeleton, which is the
   * only thing the workbench edits. Reporting per-edit is deliberate - a reader who moves a joint back to where it
   * started is still told the figure is unsaved, which is true, because there is no saved state to return to.
   */
  useEffect(() => {
    if (onTouched === undefined) return;

    const unsubscribe = useCharacterStore.subscribe((state, previous) => {
      if (state.skeleton !== previous.skeleton) onTouched();
    });

    return unsubscribe;
  }, [onTouched]);

  return (
    <div className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale">
      <div className={TITLE_BAR_INACTIVE}>
        <span>CHARACTER // BLOB HUMANOID</span>
        <span>[ 4 LAYERS ]</span>
      </div>

      <p className="border-b border-ink px-2 py-1 text-[10px] text-ink-plate">
        BUILD A FIGURE FROM A SKELETON AND THE MASS HUNG OFF IT. FRONT AND SIDE ARE THE SAME MODEL FROM TWO
        ANGLES - WHAT YOU DRAG IN ONE IS THE SAME JOINT THE OTHER SHOWS.
      </p>

      <div className="flex flex-col gap-2 p-2 lg:flex-row">
        <CharacterViewport />
      </div>
    </div>
  );
}
