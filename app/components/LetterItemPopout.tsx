'use client';

import Link from 'next/link';
import { useState } from 'react';
import { removeThing } from '../lib/letters/store';
import { cardPicture, hrefOf, KIND_LABELS, verbOf, type LetterVerb } from '../lib/letters/things';
import type { LetterItem } from '../lib/letters/types';
import { PLATE, PLATE_MAIN } from '../lib/ui/controls';
import { useWebItem } from '../lib/web/use-web-item';
import PopoutWindow from './PopoutWindow';
import { WebRow } from './WebStream';

const NO_HOSTS = {};
const NOTHING = () => undefined;

/**
 * One thing on a letter, opened from its card (SPEC-letters.md): its picture, title and what kind of thing it is, with the
 * key that fits it, WATCH, LISTEN or READ. A MEDIA row is shown as MEDIA shows it, with its own PLAY, so it plays where the
 * site's players play (the floating player or the music bar) and never inside this window. The owner can take it out.
 */
export default function LetterItemPopout({ item, owner, onClose }: { item: LetterItem; owner: boolean; onClose: () => void }) {
  const webItem = useWebItem(item.kind === 'web' ? item.ref : null);
  const [fault, setFault] = useState<string | null>(null);
  const picture = cardPicture(item.picture);
  const verb: LetterVerb = item.kind === 'web' ? webVerb(webItem?.kind) : verbOf(item.kind);
  const href = hrefOf(item);
  const outside = item.kind === 'link';

  const remove = async () => {
    setFault(null);
    try {
      await removeThing(item.letterId, item.id);
      onClose();
    } catch (error) {
      setFault(error instanceof Error ? error.message : 'That could not be taken out.');
    }
  };

  return (
    <PopoutWindow
      title={KIND_LABELS[item.kind]}
      onClose={onClose}
      maxWidth="max-w-xl"
      centred
      actions={owner ? <button type="button" onClick={() => void remove()} className={PLATE}>[ TAKE OUT ]</button> : undefined}
    >
      {item.kind === 'web' && webItem ? (
        <ul>
          <WebRow item={{ ...webItem, alsoOn: [] }} extraHosts={NO_HOSTS} found={false} onCreator={NOTHING} />
        </ul>
      ) : (
        <div className="flex gap-3 p-3 max-sm:flex-col">
          {picture ? (
            // eslint-disable-next-line @next/next/no-img-element -- hotlinked from where the thing lives, never copied
            <img src={picture} alt="" referrerPolicy="no-referrer" className="h-32 w-32 shrink-0 border border-ink object-cover" />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="break-words text-key text-ink">{item.title || item.ref}</p>
            {outside ? <p className="mt-1 break-all text-label text-ink-quiet">{item.ref}</p> : null}
            {item.kind === 'song' ? <p className="mt-1 text-label text-ink-quiet">A BEAT BOX SONG PLAYS FOR THE PERSON WHO SAVED IT.</p> : null}
            {item.kind === 'web' && webItem === undefined ? <p className="mt-1 text-label text-ink-quiet">READING...</p> : null}
            {item.kind === 'web' && webItem === null ? <p className="mt-1 text-label text-ink-quiet">MEDIA NO LONGER HAS THIS ONE.</p> : null}
            <p className="mt-3">
              {outside ? (
                <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={PLATE_MAIN}>
                  {verb} ↗
                </a>
              ) : (
                <Link href={href} onClick={onClose} className={PLATE_MAIN}>
                  {verb}
                </Link>
              )}
            </p>
          </div>
        </div>
      )}
      {fault ? (
        <p role="status" className="bg-bubble-pale px-2 py-1 text-label text-ink-bar">
          {fault}
        </p>
      ) : null}
    </PopoutWindow>
  );
}

function webVerb(kind: string | undefined): LetterVerb {
  if (kind === 'video') return 'WATCH';
  if (kind === 'audio') return 'LISTEN';
  if (kind === 'text') return 'READ';
  return 'OPEN';
}
