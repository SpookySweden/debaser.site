'use client';

import dynamic from 'next/dynamic';
import { TITLE_BAR_INACTIVE } from '../lib/ui/controls';

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
 * **A panel at the end of the dressing tab, not a tab of its own.** The customiser's two tabs are about
 * *describing* an account - its name, its picture, what visitors may see - and this is a third thing: a
 * workbench you sit at. It goes at the foot of the tab that dresses the page, so a reader reaches it by
 * scrolling past the tags they have just been editing, and so the sidebar and the two viewports get the
 * panel's full width rather than a tab body's.
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
