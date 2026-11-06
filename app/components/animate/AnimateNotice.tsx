'use client';

import { useStudio } from '../../lib/animate/store';

/** One line of feedback along the foot. A fault is a Rose chip; it stays until the next thing happens. */
export default function AnimateNotice() {
  const notice = useStudio((state) => state.notice);
  return (
    <p role="status" data-animate-notice className="min-h-6 border-t-line border-ink bg-sun-pale px-2 py-0.5 text-key text-ink">
      {notice !== null && <span className={notice.fault ? 'bg-bubble-pale px-1 text-ink-bar' : ''}>{notice.text}</span>}
    </p>
  );
}
