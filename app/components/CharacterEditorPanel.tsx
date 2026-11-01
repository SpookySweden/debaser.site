'use client';

import dynamic from 'next/dynamic';
import { openCharacterBrowser } from '../lib/character/browser-window';
import { PLATE, TITLE_BAR_INACTIVE } from '../lib/ui/controls';

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
    <p className="p-4 text-label font-bold text-ink">LOADING THE WORKBENCH...</p>
  ),
});

/**
 * The character workbench: a tool strip, two views of one figure, and the shapes and properties panels - laid out
 * like a paint program's canvas window (see `CharacterViewport`).
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
export default function CharacterEditorPanel() {
  return (
    <div className="frame bg-sun-pale">
      <div className={TITLE_BAR_INACTIVE}>
        <span>CHARACTER // WORKBENCH</span>
        <span className="flex items-center gap-2">
          {/* The door to the shelf. A plain function rather than a prop, the way every other window here opens -
              and it is inside the title bar so it reads as part of the workbench's chrome. */}
          <button type="button" onClick={openCharacterBrowser} className={PLATE}>
            [ SAVED CHARACTERS ]
          </button>
        </span>
      </div>

      <div className="p-2">
        <CharacterViewport />
      </div>
    </div>
  );
}
