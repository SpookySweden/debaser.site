'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { KEY_FOCUS } from '../lib/ui/controls';
import { goSiteHistory, siteHistoryServerWays, siteHistoryWays, subscribeToSiteHistory } from '../lib/ui/site-history';
import { redoStep, startUndoTrail, subscribeToUndoTrail, undoStep, undoTrailServerState, undoTrailState } from '../lib/ui/undo-trail';

/**
 * `◄ ►` at the start of the top bar (SPEC-floating-player.md; small, without brackets, Luke 2026-11-06). Since 2026-11-14 they are
 * UNDO and REDO for what a person does on screen (Luke: "act like a general undo button, for every function such as expanding
 * even, with the other button acting in reverse"): a page change, anything folded open or shut, a window opened or closed, in the
 * order done (`../lib/ui/undo-trail.ts`). With nothing in the trail (a first visit, a reload) they are back and forward through
 * the site's own history, as they always were.
 *
 * Each says what a press will do, as its hover tip and to a screen reader, and goes quiet when it has nothing to do. A page step
 * keeps the plain names Back and Forward. `pointer-coarse`: a phone is given the 1280 layout (`layout.tsx`), so the width can't
 * tell a finger from a mouse, and a finger gets the full tap size.
 */
const ARROW = `${KEY_FOCUS} key hit cursor-pointer inline-flex h-7 min-w-0 items-center px-0.5 text-label font-bold leading-none active:translate-y-press active:bg-bubble active:text-ink-plate disabled:cursor-not-allowed max-md:min-h-tap pointer-coarse:min-h-tap pointer-coarse:min-w-tap`;

/**
 * A press of an arrow. The trail first; with nothing in it, or when every step left in it turned out to be gone (and nothing was
 * said about a sent thing), the site's own history, so a press always does what the arrow can still do.
 */
function pressUndo(hasSteps: boolean): void {
  if (hasSteps && (undoStep() || undoTrailState().notice !== null)) return;
  goSiteHistory(-1);
}

function pressRedo(hasSteps: boolean): void {
  if (hasSteps && redoStep()) return;
  goSiteHistory(1);
}

/** `CLOSE FILTERS` as a screen reader should say it: `close filters`. */
const spoken = (words: string) => words.toLowerCase();

export default function SiteArrows() {
  const ways = useSyncExternalStore(subscribeToSiteHistory, siteHistoryWays, siteHistoryServerWays);
  const trail = useSyncExternalStore(subscribeToUndoTrail, undoTrailState, undoTrailServerState);
  useEffect(() => startUndoTrail(), []);

  const back = ways === 'back' || ways === 'both';
  const forward = ways === 'forward' || ways === 'both';
  // The trail first; with nothing in it, the site's own history.
  const undoes = trail.steps > 0;
  const redoes = trail.redoWords !== null;
  const undoName = !undoes || trail.undoKind === 'page' ? 'Back' : trail.undoWords === null ? 'Undo' : `Undo: ${spoken(trail.undoWords)}`;
  const redoName = !redoes || trail.redoKind === 'page' ? 'Forward' : `Redo: ${spoken(trail.redoWords ?? '')}`;
  const undoTip = !undoes ? 'Back' : trail.undoWords === null ? 'UNDO' : `UNDO: ${trail.undoWords}`;
  const redoTip = redoes ? `REDO: ${trail.redoWords}` : 'Forward';

  return (
    // `relative` so the one-line notice hangs under the arrows and takes no room in the bar.
    <span className="relative inline-flex items-center gap-1">
      <button type="button" data-undo-arrow="undo" onClick={() => pressUndo(undoes)} disabled={!undoes && !back} aria-label={undoName} title={undoTip} className={ARROW}>
        ◄
      </button>
      <button type="button" data-undo-arrow="redo" onClick={() => pressRedo(redoes)} disabled={!redoes && !forward} aria-label={redoName} title={redoTip} className={ARROW}>
        ►
      </button>
      {trail.notice === null ? null : (
        <span role="status" className="absolute left-0 top-full z-menu mt-1 w-max bg-bubble-pale px-1 text-label text-ink-bar">
          {trail.notice}
        </span>
      )}
    </span>
  );
}
