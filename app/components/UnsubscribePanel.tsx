'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PLATE } from '../lib/ui/controls';
import { explain } from '../lib/ui/explain';

type Step = { kind: 'working' } | { kind: 'done'; on: boolean } | { kind: 'error'; message: string };

async function send(code: string, on: boolean): Promise<Step> {
  const answer = await fetch(`/api/notify/unsubscribe?t=${encodeURIComponent(code)}${on ? '&on=1' : ''}`, { method: 'POST' }).catch(() => null);
  if (answer === null) return { kind: 'error', message: 'THE SITE DID NOT ANSWER. TRY AGAIN.' };
  const body = (await answer.json().catch(() => ({}))) as { weeklyEmail?: boolean; error?: string };
  if (!answer.ok || typeof body.weeklyEmail !== 'boolean') return { kind: 'error', message: (body.error ?? 'THAT DID NOT GO THROUGH.').toUpperCase() };
  return { kind: 'done', on: body.weeklyEmail };
}

/**
 * The weekly email's unsubscribe page (SPEC-notifications.md, 10A): opened from the email's link, it turns WEEKLY EMAIL
 * off at once, with no sign-in, and offers it back. It acts as it opens in a browser, never on a bare fetch of the
 * address, so a mail scanner opening links ahead of the reader can't unsubscribe anybody.
 */
export default function UnsubscribePanel() {
  const [code, setCode] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'working' });

  useEffect(() => {
    const found = new URLSearchParams(window.location.search).get('t') ?? '';
    let live = true;
    void send(found, false).then((next) => {
      if (!live) return;
      setCode(found);
      setStep(next);
    });
    return () => {
      live = false;
    };
  }, []);

  const flip = (on: boolean) => {
    if (code === null) return;
    setStep({ kind: 'working' });
    void send(code, on).then(setStep);
  };

  return (
    <section className="p-4 text-key text-ink" data-unsubscribe={step.kind === 'done' ? (step.on ? 'on' : 'off') : step.kind}>
      <div className="title-line text-accent-ink">
        <span>WEEKLY EMAIL</span>
      </div>
      {step.kind === 'working' ? <p className="p-2">ONE MOMENT...</p> : null}
      {step.kind === 'error' ? <p className="m-2 w-fit bg-bubble-pale px-1 text-ink-bar">{step.message}</p> : null}
      {step.kind === 'done' ? (
        <div className="flex flex-wrap items-center gap-2 p-2">
          <p>{step.on ? 'WEEKLY EMAIL: ON' : 'WEEKLY EMAIL: OFF'}</p>
          <button type="button" className={PLATE} onClick={() => flip(!step.on)} {...explain(step.on ? 'Turns the weekly email off again.' : 'Turns the weekly email back on: on Sunday evenings, a list of what you have not read.', 'You can also switch it in PREFERENCES, under NOTIFICATIONS.')}>
            {step.on ? '[ TURN IT OFF ]' : '[ TURN IT BACK ON ]'}
          </button>
          <Link href="/forum" className={PLATE} {...explain('Goes to the board, the front page of DEBASER_OS.', 'Nothing else needs doing here: your choice is already saved.')}>
            [ DEBASER_OS ]
          </Link>
        </div>
      ) : null}
    </section>
  );
}
