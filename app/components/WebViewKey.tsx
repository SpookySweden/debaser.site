'use client';

import { MEDIA_VIEWS, setMediaView, useMediaView } from '../lib/web/media-view';
import { explain } from '../lib/ui/explain';
import { FILTER_KEY, FILTER_KEY_ON } from './WebFilterFold';

/**
 * MEDIA's VIEW choices (Luke, 2026-11-14), the inside of the VIEW section in the FILTERS panel: LIST, GRID, LARGE and
 * COMPACT as big labelled keys, each with a tiny preview made of text characters and a line saying what it looks like.
 * The chosen view is kept in this browser (media-view.ts). Changing it asks nothing of any source: only the layout changes.
 */
export default function WebViewKey() {
  const view = useMediaView();
  return (
    // `data-undo-picks`: the top bar's arrows may undo a change of view (app/lib/ui/undo-trail.ts).
    <div className="flex flex-wrap items-stretch gap-2" data-view-key data-undo-picks="VIEW">
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
            {...explain(`Lays the results out as ${choice.label}: ${choice.line.toLowerCase()}`, 'Changes only how rows look, not what is found. The little drawing shows the layout. Saved to your account.')}
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
