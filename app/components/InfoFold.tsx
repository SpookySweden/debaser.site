import type { ReactNode } from 'react';
import { PLATE } from '../lib/ui/controls';

type InfoFoldProps = {
  /** What the explanation is about, for screen readers: "About {topic}". */
  topic: string;
  children: ReactNode;
  className?: string;
};

/**
 * The one place an explanation lives: a `[ ? ]` key that folds the words open underneath it and shut
 * again. It replaces the explanatory sentence on screen and the hover tip (which a phone never shows),
 * so only a reader who asks pays for the words. Native `<details>`, so it works without script and the
 * keyboard gets it for free; the stock marker is already hidden in globals.css.
 *
 * It opens downward and takes a line of its own, so give it the end of a row or a line to itself: in
 * the middle of a row the open text would push the controls after it.
 */
export default function InfoFold({ topic, children, className }: InfoFoldProps) {
  return (
    <details className={`group ${className ?? ''}`}>
      <summary className={`${PLATE} inline-block`} aria-label={`About ${topic}`}>
        <span className="group-open:hidden">[ ? ]</span>
        <span className="hidden group-open:inline">[ × ]</span>
      </summary>
      <div className="mt-1 text-label text-ink-quiet">{children}</div>
    </details>
  );
}
