'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A sample on the style sheet page (`/specimen`), with the value the browser actually computed for it.
 *
 * The page lists every token by name; this is what keeps the numbers beside the names honest. They are
 * read from the rendered sample, not written into the page, so turning a dial in `app/theme/tokens.css`
 * changes the number shown here too.
 */
export default function SpecimenValue({
  property,
  className,
  children,
}: {
  /** The CSS property to read off the sample, e.g. `font-size`. */
  property: string;
  /** The sample's own classes: the token being shown. */
  className?: string;
  children?: ReactNode;
}) {
  const sample = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (sample.current) setValue(getComputedStyle(sample.current).getPropertyValue(property));
  }, [property]);

  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span ref={sample} className={className}>
        {children}
      </span>
      <span className="text-label text-ink-quiet">{value}</span>
    </span>
  );
}
