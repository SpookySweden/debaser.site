'use client';

import { useEffect, useRef, useState } from 'react';
import { PLATE } from '../lib/ui/controls';
import { queueRefusal } from '../lib/watch/links';
import { addToMyQueue } from '../lib/watch/my-queue';
import { pictureLink } from '../lib/watch/pictures';
import { useAuth } from './AuthProvider';
import { explain } from '../lib/ui/explain';

/** How long the key says it worked, before it can add the picture again. */
const QUEUED_MS = 4000;

/**
 * `[ + QUEUE ]` on a picture the site holds or already trusts (SPEC-rooms-queues.md, phase 5: FILES pictures,
 * STREAM ART). One press puts it at the end of the queue you are on: your own room's (kept on your account, or in
 * this browser for a signed-out visitor), or the live room's by its crown rule (`my-queue.ts`). Only the picture's
 * address and title are filed: nothing is copied. When its turn comes it holds the screen until NEXT.
 */
export default function QueuePictureKey({ url, title, maker, className = PLATE }: { url: string; title: string; maker?: string | null; className?: string }) {
  const userId = useAuth().user?.id ?? null;
  const [state, setState] = useState<'idle' | 'busy' | 'queued' | 'listed'>('idle');
  const [refused, setRefused] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  async function press() {
    const link = pictureLink(url, title, maker);
    const refusal = queueRefusal(link);
    if (refusal !== null) {
      setRefused(refusal);
      return;
    }
    setState('busy');
    setRefused(null);
    try {
      const result = await addToMyQueue({ title: link.title, link }, userId);
      setState(result.as === 'listed' ? 'listed' : 'queued');
      timer.current = window.setTimeout(() => setState('idle'), QUEUED_MS);
    } catch (failure) {
      setState('idle');
      setRefused(failure instanceof Error ? failure.message : 'IT COULD NOT BE QUEUED.');
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void press()}
        disabled={state !== 'idle'}
        aria-label={`Add the picture "${title}" to the queue`}
        title="It holds the screen, when its turn comes, until NEXT"
        {...explain('Puts this picture at the end of the queue you are on: your own room\'s, or the live room\'s.', 'When its turn comes it holds the screen until someone presses NEXT. Only its address and title are filed; nothing is copied.')}
        className={className}
        data-queue-picture={state}
      >
        {state === 'busy' ? '[ ADDING... ]' : state === 'queued' ? '[ QUEUED ]' : state === 'listed' ? '[ ON YOUR LIST ]' : '[ + QUEUE ]'}
      </button>
      {refused === null ? null : (
        <span role="alert" className="w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">
          {refused}
        </span>
      )}
    </>
  );
}
