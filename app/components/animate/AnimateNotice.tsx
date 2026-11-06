'use client';

import { useEffect } from 'react';
import { useStudio } from '../../lib/animate/store';

/** One line of feedback along the foot. A fault is a Rose chip; it stays until the next thing happens. */
export default function AnimateNotice() {
  const notice = useStudio((state) => state.notice);
  // It takes no room of its own: it sits over the sheet, a moment at a time.
  useEffect(() => {
    if (notice === null || notice.fault) return undefined;
    const timer = setTimeout(() => useStudio.setState({ notice: null }), 2500);
    return () => clearTimeout(timer);
  }, [notice]);
  return (
    <p role="status" data-animate-notice className="pointer-events-none absolute bottom-20 left-1/2 z-20 -translate-x-1/2 text-title">
      {notice !== null && <span className={notice.fault ? 'bg-bubble-pale px-2 py-1 text-ink-bar' : 'bg-ink px-2 py-1 text-paper'}>{notice.text}</span>}
    </p>
  );
}
