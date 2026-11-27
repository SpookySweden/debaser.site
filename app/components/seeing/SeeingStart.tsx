'use client';

import { useSyncExternalStore } from 'react';
import { shortName } from '../../lib/seeing/address';
import { KEYS_LINE } from '../../lib/seeing/keys';
import { recentPages } from '../../lib/seeing/history';
import { historyRows, historyRowsOnServer, subscribeToHistory } from '../../lib/seeing/history-store';
import { TEST_ADDRESS } from '../../lib/seeing/test-engine';
import { PLATE, PLATE_MAIN, TITLE_BAR_INACTIVE } from '../../lib/ui/controls';
import SeeingEngines from './SeeingEngines';
import { explain } from '../../lib/ui/explain';

const RECENT_MOST = 8;

/** A new tab: what the machine is in a line, the way back to the last pages, the GOOD ones, and the engines. */
export default function SeeingStart({ good, ownEye, onGo }: { good: readonly { address: string; title: string }[]; ownEye: boolean; onGo: (address: string) => void }) {
  const rows = useSyncExternalStore(subscribeToHistory, historyRows, historyRowsOnServer);
  const recent = recentPages(rows, RECENT_MOST);
  return (
    <div className="min-w-0 flex-1 overflow-y-auto p-4 text-label text-ink" data-seeing-start>
      <p className="max-w-prose">
        AN ADDRESS OR WORDS IN THE BOX ABOVE. A LENS CHANGES HOW A PAGE IS SEEN, NEVER THE PAGE; NOTHING OF IT IS KEPT BUT WHAT YOU KEEP.
      </p>
      {/* The keyboard's keys, said only where the pointer is a mouse: a phone's reader has no ALT to press. */}
      <p className="mt-1 text-ink-quiet pointer-coarse:hidden" data-seeing-keys>
        {KEYS_LINE}
      </p>
      <button type="button" className={`${PLATE_MAIN} mt-3`} onClick={() => onGo(TEST_ADDRESS)} {...explain('Opens the house\'s own test page, made for trying BROWSER out.', 'A safe page to try the lenses, notes and keeping on before you open a real site.')}>
        OPEN THE TEST PAGE
      </button>
      {recent.length > 0 ? (
        <section aria-label="Seen last" className="mt-4" data-seeing-recent>
          <h2 className={TITLE_BAR_INACTIVE}>SEEN LAST</h2>
          <ul>
            {recent.map((row) => (
              <li key={row.address} className="flex min-w-0 items-baseline gap-2">
                <button type="button" onClick={() => onGo(row.address)} title={row.address} className={`${PLATE} min-w-0 max-w-full truncate`} {...explain('Opens this page again in this tab.', 'SEEN LAST: the pages you looked at most recently, to get back to them in one press.')}>
                  {row.title}
                </button>
                <span className="shrink-0 text-ink-quiet">{shortName(row.address)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {good.length > 0 ? (
        <section aria-label="Good pages" className="mt-4">
          <h2 className={TITLE_BAR_INACTIVE}>GOOD</h2>
          <ul aria-label="Good pages" data-seeing-good>
            {good.slice(0, 30).map((page) => (
              <li key={page.address}>
                <button type="button" onClick={() => onGo(page.address)} title={page.address} className={`${PLATE} max-w-full truncate`} {...explain('Opens this page in this tab.', 'GOOD: pages you marked as good, kept here as your own short list.')}>
                  {page.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <SeeingEngines ownEye={ownEye} onClose={null} />
    </div>
  );
}
