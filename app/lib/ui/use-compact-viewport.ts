'use client';

import { useEffect, useState } from 'react';

/**
 * Whether this window is the narrow, single-column layout.
 *
 * The breakpoint is the one the rest of the site already uses (`sm`), so "mobile"
 * here means the same thing it means in the layout. It is only ever read on the
 * client - the pop-up window is client-only anyway - so the server render stays
 * on the desktop answer.
 */
const COMPACT_QUERY = '(max-width: 639px)';

export function useCompactViewport(): boolean {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY);
    const apply = () => setCompact(query.matches);

    apply();
    query.addEventListener('change', apply);

    return () => query.removeEventListener('change', apply);
  }, []);

  return compact;
}
