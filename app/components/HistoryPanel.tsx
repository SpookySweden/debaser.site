'use client';

import { useCallback, useEffect, useState } from 'react';
import { eraseHistory, forgetOne, readHistory, readPaused, setPaused, subscribeHistory } from '../lib/recommender/history';
import type { HistoryKind, HistoryRow } from '../lib/recommender/types';
import { PLATE, PLATE_PRESSED } from '../lib/ui/controls';

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
};

const ACTION_WORD: Record<HistoryRow['action'], string> = {
  opened: 'OPENED',
  played: 'PLAYED',
  read: 'READ',
  finished: 'FINISHED',
  not_for_me: 'NOT FOR ME',
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
    if (!(await eraseHistory())) setFault('COULD NOT ERASE IT. TRY AGAIN.');
  };

  return (
    <section aria-labelledby="history-title" className="flex flex-col gap-2" data-history-panel>
      <h3 id="history-title" className="title-line text-accent-ink text-title">
        HISTORY
      </h3>
      <p className="text-key text-ink">WHAT YOU OPEN, PLAY AND READ HERE, KEPT 90 DAYS. ONLY YOU CAN SEE IT. FOR YOU PICKS FROM IT.</p>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" onClick={() => void flipPause()} aria-pressed={paused} className={paused ? PLATE_PRESSED : PLATE} data-history-pause>
          {paused ? 'PAUSED: [ RESUME HISTORY ]' : '[ PAUSE HISTORY ]'}
        </button>
        <button type="button" onClick={() => void erase()} onBlur={() => setConfirming(false)} className={PLATE} data-history-erase>
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
                <button type="button" onClick={() => void forgetOne(row.kind, row.ref)} aria-label={`Forget ${row.title || row.ref}`} className={PLATE}>
                  [ FORGET ]
                </button>
              </li>
            ))}
          </ul>
          {rows.length > shown ? (
            <button type="button" onClick={() => setShown((now) => now + STEP)} className={`${PLATE} w-fit`}>
              [ SHOW MORE ]
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
