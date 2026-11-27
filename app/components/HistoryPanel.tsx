'use client';

import { useCallback, useEffect, useState } from 'react';
import { eraseHistory, forgetOne, readHistory, readPaused, setPaused, subscribeHistory } from '../lib/recommender/history';
import type { HistoryKind, HistoryRow } from '../lib/recommender/types';
import { erasePlays } from '../lib/history/plays';
import { PLATE, PLATE_PRESSED } from '../lib/ui/controls';
import { NOTE, explain } from '../lib/ui/explain';

/**
 * FOR YOU's history controls (SPEC-recommender.md, Luke 2026-11-13), on the account's PRIVACY tab and behind FOR YOU's
 * `[ HISTORY ]` key: PAUSE or RESUME, ERASE (two presses), and the list of exactly what is kept, newest first. No counts.
 */

const KIND_WORD: Record<HistoryKind, string> = {
  media: 'MEDIA',
  song: 'SONG',
  book: 'BOOK',
  thread: 'BOARD',
  room: 'ROOM',
  letter: 'LETTER',
  lore: 'LORE',
  person: 'PERSON',
  maker: 'CHANNEL',
};

const ACTION_WORD: Record<HistoryRow['action'], string> = {
  opened: 'OPENED',
  played: 'PLAYED',
  read: 'READ',
  finished: 'FINISHED',
  not_for_me: 'NOT FOR ME',
  skipped: 'SKIPPED',
  more: 'MORE LIKE THIS',
  less: 'SHOW LESS',
};

/** How many rows the list shows at first, and adds each [ SHOW MORE ]. */
const STEP = 30;

export default function HistoryPanel() {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [paused, setPausedState] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [shown, setShown] = useState(STEP);
  const [fault, setFault] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [read, isPaused] = await Promise.all([readHistory(3000), readPaused()]);
    setRows(read);
    setPausedState(isPaused);
  }, []);

  useEffect(() => {
    let live = true;
    const reload = () => {
      void load().then(() => live || undefined);
    };
    reload();
    const stop = subscribeHistory(reload);
    return () => {
      live = false;
      stop();
    };
  }, [load]);

  const flipPause = async () => {
    setFault(null);
    if (!(await setPaused(!paused))) setFault('COULD NOT CHANGE IT. TRY AGAIN.');
  };

  const erase = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setFault(null);
    // The HISTORY window's log goes too (SPEC-history.md: PRIVACY's ERASE removes both).
    const [kept, plays] = await Promise.all([eraseHistory(), erasePlays()]);
    if (!kept || !plays) setFault('COULD NOT ERASE IT. TRY AGAIN.');
  };

  return (
    <section aria-labelledby="history-title" className="flex flex-col gap-2" data-history-panel>
      <h3 id="history-title" className="title-line text-accent-ink text-title">
        HISTORY
      </h3>
      <p className="text-key text-ink">WHAT YOU OPEN, PLAY AND READ HERE, KEPT 90 DAYS. ONLY YOU CAN SEE IT. FOR YOU PICKS FROM IT. PAUSE AND ERASE ALSO COVER THE HISTORY WINDOW&apos;S LOG.</p>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" onClick={() => void flipPause()} aria-pressed={paused} className={paused ? PLATE_PRESSED : PLATE} data-history-pause {...explain(paused ? 'Starts keeping your history again.' : 'Stops keeping what you open, play and read until you resume.', 'What is kept stays. It pauses the HISTORY window\'s log too.')}>
          {paused ? 'PAUSED: [ RESUME HISTORY ]' : '[ PAUSE HISTORY ]'}
        </button>
        <button type="button" onClick={() => void erase()} onBlur={() => setConfirming(false)} className={PLATE} data-history-erase {...explain(confirming ? 'Erases all your history now, and the HISTORY window\'s log with it.' : 'Asks first, then erases all your history and the HISTORY window\'s log.', 'Press again to confirm; clicking anywhere else cancels.', NOTE.undo)}>
          {confirming ? '[ YES, ERASE IT ]' : '[ ERASE MY HISTORY ]'}
        </button>
      </div>
      {paused ? <p className="text-key text-ink-quiet">NOTHING NEW IS KEPT WHILE IT IS PAUSED.</p> : null}
      {fault !== null ? (
        <p role="alert" className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">
          {fault}
        </p>
      ) : null}
      {rows === null ? (
        <p role="status" className="text-key text-ink-quiet">
          READING...
        </p>
      ) : rows.length === 0 ? (
        <p className="text-key text-ink-quiet">NOTHING KEPT.</p>
      ) : (
        <>
          <ul aria-label="What is kept, newest first" className="flex flex-col">
            {rows.slice(0, shown).map((row) => (
              <li key={`${row.kind}:${row.ref}`} className="rule-pixel flex flex-wrap items-center gap-x-2 py-1 text-key text-ink">
                <span className="text-ink-quiet">{`${KIND_WORD[row.kind]} · ${ACTION_WORD[row.action]} · ${row.lastAt.slice(0, 10)}`}</span>
                <span className="min-w-0 flex-1 wrap-anywhere">{row.title || row.ref}</span>
                <button type="button" onClick={() => void forgetOne(row.kind, row.ref)} aria-label={`Forget ${row.title || row.ref}`} className={PLATE} {...explain('Takes this one thing out of your history.', 'So FOR YOU stops picking from it.', NOTE.undo)}>
                  [ FORGET ]
                </button>
              </li>
            ))}
          </ul>
          {rows.length > shown ? (
            <button type="button" onClick={() => setShown((now) => now + STEP)} className={`${PLATE} w-fit`} {...explain('Shows 30 more lines of your history.', 'The list starts with the most recent only.')}>
              [ SHOW MORE ]
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
