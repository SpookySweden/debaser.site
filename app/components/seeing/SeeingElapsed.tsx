'use client';

import { useEffect, useState } from 'react';

/**
 * How long the page in front has been asked for, in whole seconds, beside the status line's step: a slow site is seen to be slow, not
 * stuck. Its own component, so only it draws again each second; hidden from screen readers, which would hear every tick.
 */
export default function SeeingElapsed({ since }: { since: number }) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const tick = window.setInterval(() => setNow(performance.now()), 1000);
    return () => window.clearInterval(tick);
  }, [since]);
  const seconds = Math.floor((now - since) / 1000);
  return seconds < 1 ? null : <span aria-hidden="true" data-seeing-elapsed>{` · ${seconds} S`}</span>;
}
