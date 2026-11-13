'use client';

import type { ReactNode } from 'react';
import { DOCS_SIZE_MAX, DOCS_SIZE_MIN, DOC_KEY } from '../lib/docs/ui';
import { useDocsSize } from '../lib/docs/use-docs-size';

type DocsScaleProps = {
  children: ReactNode;
  className?: string;
};

/**
 * The wrapper every DOCS screen and window sits in: it hands the reader's TEXT SIZE step to the CSS
 * (`.docs-ui[data-docs-size]` in globals.css), which sizes the keys, the small lines and the writing.
 * A window is drawn outside the page (a portal), so each window wraps its own body in one too.
 */
export default function DocsScale({ children, className }: DocsScaleProps) {
  const { size } = useDocsSize();

  return (
    <div className={className === undefined ? 'docs-ui' : `docs-ui ${className}`} data-docs-size={size}>
      {children}
    </div>
  );
}

/** TEXT SIZE: one step smaller, one step bigger, remembered in this browser. */
export function DocsSizeKeys() {
  const { size, step } = useDocsSize();

  return (
    <span className="docs-meta inline-flex items-center gap-1 whitespace-nowrap text-ink">
      TEXT SIZE
      <button type="button" className={`${DOC_KEY} min-w-tap justify-center whitespace-nowrap`} disabled={size <= DOCS_SIZE_MIN} onClick={() => step(-1)} aria-label="Smaller text">
        [ A− ]
      </button>
      <button type="button" className={`${DOC_KEY} min-w-tap justify-center whitespace-nowrap`} disabled={size >= DOCS_SIZE_MAX} onClick={() => step(1)} aria-label="Bigger text">
        [ A+ ]
      </button>
    </span>
  );
}
