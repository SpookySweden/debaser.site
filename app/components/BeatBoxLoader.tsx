'use client';

import dynamic from 'next/dynamic';

/**
 * Audio and MIDI don't exist on the server, and the synth is large, so the beat box loads in the browser
 * and on this page only. The words stay until it arrives.
 */
const BeatBoxRoom = dynamic(() => import('./BeatBoxRoom'), {
  ssr: false,
  loading: () => (
    <p role="status" className="p-3 text-title font-bold text-ink">
      LOADING THE BEAT BOX...
    </p>
  ),
});

export default function BeatBoxLoader() {
  return <BeatBoxRoom />;
}
