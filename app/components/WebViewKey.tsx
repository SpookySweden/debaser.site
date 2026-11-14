'use client';

import { MEDIA_VIEWS, setMediaView, useMediaView } from '../lib/web/media-view';
import { FILTER_KEY, FILTER_KEY_ON } from './WebFilterFold';

/**
 * MEDIA's VIEW choices (Luke, 2026-11-14), the inside of the VIEW section in the FILTERS panel: LIST, GRID, LARGE and
 * COMPACT as big labelled keys, each with a tiny preview made of text characters and a line saying what it looks like.
 * The chosen view is kept in this browser (media-view.ts). Changing it asks nothing of any source: only the layout changes.
 */
export default function WebViewKey() {
  const view = useMediaView();
  return (
    <div className="flex flex-wrap items-stretch gap-2" data-view-key>
      {MEDIA_VIEWS.map((choice) => {
        const on = choice.value === view;
        return (
          <button
            key={choice.value}
            type="button"
            onClick={() => setMediaView(choice.value)}
            aria-pressed={on}
            aria-label={`View: ${choice.label}. ${choice.line}`}
            className={`${on ? FILTER_KEY_ON : FILTER_KEY} flex flex-col items-start gap-1 text-left`}
            data-view={choice.value}
          >
            <span>{on ? choice.label : `[ ${choice.label} ]`}</span>
            <span aria-hidden="true" className="font-mono text-label leading-tight whitespace-pre">
              {choice.preview.join('\n')}
            </span>
            <span className="text-label">{choice.line}</span>
          </button>
        );
      })}
    </div>
  );
}
