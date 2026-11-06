'use client';

import dynamic from 'next/dynamic';

/** The studio is all canvases and browser storage, so it isn't rendered on the server. */
const AnimateStudio = dynamic(() => import('./AnimateStudio'), {
  ssr: false,
  loading: () => (
    <p role="status" className="text-title text-ink">
      OPENING THE STUDIO...
    </p>
  ),
});

export default function AnimateLoader() {
  return <AnimateStudio />;
}
