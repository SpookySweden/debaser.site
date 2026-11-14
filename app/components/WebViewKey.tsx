'use client';

import { useState } from 'react';
import { MEDIA_VIEWS, setMediaView, useMediaView } from '../lib/web/media-view';
import { FILTER_KEY, FILTER_KEY_ON } from './WebFilterFold';

/**
 * MEDIA's [ VIEW ] key (Luke, 2026-11-14): opens a row of big labelled choices, LIST, GRID, LARGE and COMPACT, each with a
 * tiny preview made of text characters and a line saying what it looks like. The chosen view is kept in this browser
 * (media-view.ts). It opens downward on its own line, so nothing beside it moves.
 */
export default function WebViewKey() {
  const view = useMediaView();
  const [open, setOpen] = useState(false);
  return (
    <div className="w-full" data-view-key>
      <button type="button" onClick={() => setOpen((now) => !now)} aria-expanded={open} aria-controls="media-view-choices" className={open ? FILTER_KEY_ON : FILTER_KEY}>
        {open ? 'VIEW' : '[ VIEW ]'}
      </button>
      <div id="media-view-choices" role="group" aria-label="View" hidden={!open} className="flex flex-wrap items-stretch gap-2 pt-2">
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
    </div>
  );
}
