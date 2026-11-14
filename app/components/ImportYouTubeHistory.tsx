'use client';

import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { importTakeoutFile, readSummary, removeSummary, subscribeSummary } from '../lib/recommender/watch-summary';
import type { WatchSummary } from '../lib/recommender/youtube-picks';
import { PLATE } from '../lib/ui/controls';

/**
 * `[ IMPORT YOUTUBE HISTORY ]` (Luke, 2026-11-14: "we will have a button for this next to the link youtube button, and
 * replacing the link youtube button once youtube is linked"). Google's API gives no watch history, so a person may
 * bring their own: the `watch-history` file from Google Takeout, chosen or dropped here.
 *
 * The key folds its panel open in place (`aria-expanded`, the site's one open look). The panel says in plain words how
 * to get the file, takes it, and says what was kept. The file is read in this browser and never uploaded; only a summary
 * goes on the account (`recommender/watch-summary.ts`): channel names with how much they are watched, and topic words.
 * `keyClass`: the key's look, so it sits in a row of the page's own keys.
 */
export default function ImportYouTubeHistory({ keyClass = PLATE, keyClassOn = PLATE }: { keyClass?: string; keyClassOn?: string }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<WatchSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ fault: boolean; words: string } | null>(null);
  const [over, setOver] = useState(false);
  const chooser = useRef<HTMLInputElement | null>(null);
  const panelId = useId();

  useEffect(() => {
    let live = true;
    const read = () => void readSummary().then((found) => live && setSummary(found));
    read();
    const stop = subscribeSummary(read);
    return () => {
      live = false;
      stop();
    };
  }, []);

  const take = async (file: File | undefined) => {
    if (file === undefined || busy) return;
    setBusy(true);
    setSaid(null);
    const result = await importTakeoutFile(file);
    setBusy(false);
    setSaid(result.ok ? { fault: false, words: 'IMPORTED. YOUR PICKS NOW LEAN TO WHAT YOU WATCH.' } : { fault: true, words: result.problem });
    if (chooser.current) chooser.current.value = '';
  };
  const dropped = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOver(false);
    void take(event.dataTransfer.files[0]);
  };
  const remove = async () => {
    setSaid((await removeSummary()) ? { fault: false, words: 'REMOVED.' } : { fault: true, words: 'COULD NOT REMOVE IT. TRY AGAIN.' });
  };

  const names = (summary?.channels ?? []).slice(0, 5).map((channel) => channel.name.toUpperCase());
  return (
    <>
      <button type="button" onClick={() => setOpen((now) => !now)} aria-expanded={open} aria-controls={panelId} className={open ? keyClassOn : keyClass} data-youtube-import>
        {open ? 'IMPORT YOUTUBE HISTORY' : '[ IMPORT YOUTUBE HISTORY ]'}
      </button>
      <div id={panelId} hidden={!open} className="frame flex w-full basis-full flex-col gap-2 bg-paper p-2" data-youtube-import-panel>
        {open ? (
          <>
            <p className="text-key text-ink">
              YOUTUBE DOES NOT LET A SITE SEE WHAT YOU WATCH. YOU CAN BRING IT YOURSELF: GOOGLE GIVES YOU A FILE OF YOUR OWN WATCH HISTORY, AND THIS PAGE LEARNS YOUR CHANNELS AND TOPICS FROM IT.
            </p>
            <ol className="flex list-decimal flex-col gap-1 pl-6 text-key text-ink">
              <li>
                OPEN{' '}
                <a href="https://takeout.google.com/" target="_blank" rel="noopener noreferrer" className={PLATE}>
                  [ TAKEOUT.GOOGLE.COM ↗ ]
                </a>{' '}
                (GOOGLE&apos;S OWN PAGE, NEW TAB).
              </li>
              <li>PRESS &quot;DESELECT ALL&quot;, THEN TICK ONLY &quot;YOUTUBE AND YOUTUBE MUSIC&quot;.</li>
              <li>PRESS &quot;ALL YOUTUBE DATA INCLUDED&quot; AND KEEP ONLY &quot;HISTORY&quot;. PRESS &quot;MULTIPLE FORMATS&quot; AND SET HISTORY TO JSON.</li>
              <li>PRESS &quot;NEXT STEP&quot;, THEN &quot;CREATE EXPORT&quot;. GOOGLE EMAILS YOU A LINK, OFTEN WITHIN MINUTES.</li>
              <li>DOWNLOAD IT AND OPEN THE ZIP. THE FILE IS IN TAKEOUT, YOUTUBE AND YOUTUBE MUSIC, HISTORY, NAMED WATCH-HISTORY.</li>
              <li>CHOOSE THAT FILE BELOW, OR DROP IT ON THE BOX.</li>
            </ol>
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={dropped}
              className={`frame flex flex-wrap items-center gap-2 p-2 ${over ? 'bg-sun-pale' : 'bg-paper'}`}
              data-youtube-import-drop
            >
              <input ref={chooser} type="file" accept=".json,.html,.htm,application/json,text/html" onChange={(event) => void take(event.target.files?.[0])} className="sr-only" aria-label="Choose your watch-history file" tabIndex={-1} />
              <button type="button" onClick={() => chooser.current?.click()} disabled={busy} className={PLATE} data-youtube-import-choose>
                {busy ? '[ READING... ]' : '[ CHOOSE WATCH-HISTORY FILE ]'}
              </button>
              <span className="text-key text-ink">OR DROP IT HERE</span>
            </div>
            <p className="text-key text-ink">
              THE FILE IS READ IN YOUR BROWSER AND NEVER UPLOADED. ONLY A SUMMARY IS KEPT ON YOUR ACCOUNT, FOR A YEAR: CHANNEL NAMES WITH HOW MUCH YOU WATCH THEM, AND TOPIC WORDS. NO VIDEOS, TITLES OR TIMES. ONLY YOU CAN SEE IT.
            </p>
            {said !== null ? (
              <p role={said.fault ? 'alert' : 'status'} className={said.fault ? 'w-fit bg-bubble-pale px-1 text-key text-ink-bar' : 'text-key text-ink'} data-youtube-import-said>
                {said.words}
              </p>
            ) : null}
            {summary !== null ? (
              <div className="flex flex-wrap items-center gap-2" data-youtube-import-kept>
                <p className="min-w-0 break-words text-key text-ink">{`KEPT SINCE ${summary.importedAt.slice(0, 10)}: ${names.join(', ')}${summary.channels.length > names.length ? ' AND MORE' : ''}.`}</p>
                <button type="button" onClick={() => void remove()} className={PLATE} data-youtube-import-remove>
                  [ REMOVE IMPORT ]
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}
