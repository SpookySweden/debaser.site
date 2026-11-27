'use client';

import { useState } from 'react';
import { ADDRESS_MOST } from '../../lib/seeing/address';
import { FIELD_TIGHT, PLATE } from '../../lib/ui/controls';
import { explain } from '../../lib/ui/explain';

type Props = {
  /** Which tab and stop this is: when it changes, the box goes back to what it starts with. */
  place: string;
  /** What the box starts with: the page in front, or the address a link brought. */
  address: string;
  canBack: boolean;
  canForward: boolean;
  busy: boolean;
  /** A new tab, with no page to reload. */
  empty: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onStop: () => void;
  onGo: (text: string) => void;
  /** What GO will do with what is in the box, and whether that is a search. */
  say: (text: string) => string;
  searches: (text: string) => boolean;
  /** The engine that is asked, and its list. */
  engine: string;
  listing: boolean;
  onList: () => void;
  onAll: (text: string) => void;
};

/** Back, forward, reload, stop and the address box. The tab's own back and forward: the site's arrows do not record pages read. */
export default function SeeingToolbar({ place, address, canBack, canForward, busy, empty, onBack, onForward, onReload, onStop, onGo, say, searches, engine, listing, onList, onAll }: Props) {
  const [text, setText] = useState(address);
  const [at, setAt] = useState(place);
  if (at !== place) {
    setAt(place);
    setText(address);
  }
  // Nothing is said of a page already in front: the box holds its address, and GO asks for it again.
  const words = text === address ? '' : say(text);
  return (
    <>
    <form
      className="flex flex-wrap items-center gap-1 pt-1"
      onSubmit={(event) => {
        event.preventDefault();
        onGo(text);
      }}
      data-seeing-toolbar
    >
      <button type="button" aria-label="Back" title="Back" disabled={!canBack} onClick={onBack} className={PLATE} {...explain('Goes back to the page this tab showed before.', 'Each tab keeps its own back and forward.')}>
        ◄
      </button>
      <button type="button" aria-label="Forward" title="Forward" disabled={!canForward} onClick={onForward} className={PLATE} {...explain('Goes forward again to the page you went back from.')}>
        ►
      </button>
      <button type="button" aria-label="Reload" title="Reload" disabled={empty || busy} onClick={onReload} className={PLATE} {...explain('Asks for this page again, fresh.', 'For a page that has changed since, or one that came badly.')}>
        ↻
      </button>
      <button type="button" aria-label="Stop" title="Stop" disabled={!busy} onClick={onStop} className={PLATE} {...explain('Stops asking for the page that is on its way.', 'For a page that is taking too long; ASK AGAIN tries it once more.')}>
        ■
      </button>
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onFocus={(event) => event.target.select()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setText(address);
        }}
        aria-label="Address"
        placeholder="ADDRESS OR WORDS"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        inputMode="url"
        maxLength={ADDRESS_MOST}
        className={`${FIELD_TIGHT} min-w-0 flex-1 basis-48`}
        data-seeing-address
      />
      <button type="submit" className={`${PLATE} shrink-0`} {...explain('Opens what is in the box: an address goes to that page, words are searched for with the engine beside it.', 'The line under the box says which it will do before you press.')}>
        [ GO ]
      </button>
      <button type="button" disabled={!searches(text)} title="The same words in three engines, a tab each" onClick={() => onAll(text)} className={`${PLATE} shrink-0`} {...explain('Searches for the words in the box with three engines at once, each in a tab of its own.', 'To compare what different engines find for the same words.')}>
        [ ALL ]
      </button>
      <button type="button" aria-expanded={listing} title="Search engines" onClick={onList} className={`${PLATE} max-w-48 truncate`} {...explain('Opens the list of search engines, to pick the one GO asks.', `${engine} is the one asked now; your pick is remembered.`)}>
        [ {engine} ▾ ]
      </button>
    </form>
    {/* Its line is always there, so nothing moves when it speaks. */}
    <p className="min-h-5 max-w-full truncate text-label text-ink-quiet" data-seeing-says>
      {words}
    </p>
    </>
  );
}
