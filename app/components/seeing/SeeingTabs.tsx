'use client';

import type { ReactNode } from 'react';
import { TABS_MOST, tabName, type Tabs } from '../../lib/seeing/tabs';
import { PLATE, PLATE_PRESSED } from '../../lib/ui/controls';

/** BROWSER's tabs: up to eight, each closed by its own key. The arrow keys move between them. */
/** `end`: what is yours whatever the page (HISTORY, KEPT), at the line's far end, where the tabs leave room. */
export default function SeeingTabs({ state, onShow, onClose, onNew, end = null }: { state: Tabs; onShow: (id: string) => void; onClose: (id: string) => void; onNew: () => void; end?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1" data-seeing-tabs>
      <div
        role="tablist"
        aria-label="Pages"
        className="contents"
        onKeyDown={(event) => {
          if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
          const at = state.tabs.findIndex((tab) => tab.id === state.front);
          const next = state.tabs[(at + (event.key === 'ArrowRight' ? 1 : state.tabs.length - 1)) % state.tabs.length].id;
          onShow(next);
          document.getElementById(`seeing-tab-${next}`)?.focus();
        }}
      >
        {state.tabs.map((tab) => {
          const front = tab.id === state.front;
          const name = tabName(tab);
          return (
            <span key={tab.id} role="presentation" className="flex min-w-0 max-w-[14rem] items-center">
              <button
                type="button"
                role="tab"
                id={`seeing-tab-${tab.id}`}
                aria-selected={front}
                tabIndex={front ? 0 : -1}
                title={name}
                onClick={() => onShow(tab.id)}
                className={`${front ? `${PLATE_PRESSED} cursor-pointer` : PLATE} min-w-0 truncate uppercase`}
              >
                [ {name} ]
              </button>
              <button type="button" aria-label={`Close ${name}`} title="Close" onClick={() => onClose(tab.id)} className={PLATE}>
                ×
              </button>
            </span>
          );
        })}
      </div>
      <button type="button" aria-label="New tab" title={state.tabs.length >= TABS_MOST ? `${TABS_MOST} tabs at most` : 'New tab'} disabled={state.tabs.length >= TABS_MOST} onClick={onNew} className={PLATE}>
        [ + ]
      </button>
      {end !== null ? <span className="ml-auto flex flex-wrap items-center gap-x-1">{end}</span> : null}
    </div>
  );
}
