'use client';

import { useState } from 'react';
import { ADDRESS_MOST } from '../../lib/seeing/address';
import { FIELD_TIGHT, PLATE } from '../../lib/ui/controls';

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
};

/** Back, forward, reload, stop and the address box. The tab's own back and forward: the site's arrows do not record pages read. */
export default function SeeingToolbar({ place, address, canBack, canForward, busy, empty, onBack, onForward, onReload, onStop, onGo }: Props) {
  const [text, setText] = useState(address);
  const [at, setAt] = useState(place);
  if (at !== place) {
    setAt(place);
    setText(address);
  }
  return (
    <form
      className="flex items-center gap-1 pt-1"
      onSubmit={(event) => {
        event.preventDefault();
        onGo(text);
      }}
      data-seeing-toolbar
    >
      <button type="button" aria-label="Back" title="Back" disabled={!canBack} onClick={onBack} className={PLATE}>
        ◄
      </button>
      <button type="button" aria-label="Forward" title="Forward" disabled={!canForward} onClick={onForward} className={PLATE}>
        ►
      </button>
      <button type="button" aria-label="Reload" title="Reload" disabled={empty || busy} onClick={onReload} className={PLATE}>
        ↻
      </button>
      <button type="button" aria-label="Stop" title="Stop" disabled={!busy} onClick={onStop} className={PLATE}>
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
        placeholder="ADDRESS"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        inputMode="url"
        maxLength={ADDRESS_MOST}
        className={`${FIELD_TIGHT} min-w-0 flex-1`}
        data-seeing-address
      />
      <button type="submit" className={PLATE}>
        [ GO ]
      </button>
    </form>
  );
}
