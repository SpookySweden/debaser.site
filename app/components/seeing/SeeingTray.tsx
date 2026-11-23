'use client';

import { useState } from 'react';
import { lengthText, type TrayItem } from '../../lib/seeing/media';
import { probeVideoLink } from '../../lib/watch/links';
import { playInMainRoom } from '../../lib/watch/main-room-play';
import { addToMyQueue, NO_ROOM_YET, queueIsALiveRoom } from '../../lib/watch/my-queue';
import { TITLE_BAR_INACTIVE } from '../../lib/ui/controls';
import { useAuth } from '../AuthProvider';
import SplitKey from '../SplitKey';

/** The media tray: what the page plays, and the Room's own two halves for each. Titles are a page's words, drawn as words. */
export default function SeeingTray({ items }: { items: readonly TrayItem[] }) {
  return (
    <section aria-label="Media" className="flex w-80 shrink-0 flex-col overflow-y-auto border-l-line border-ink bg-paper p-2 text-label text-ink" data-seeing-tray>
      <h2 className={TITLE_BAR_INACTIVE}>MEDIA</h2>
      {items.length === 0 ? (
        <p className="p-1">NOTHING FOUND.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <TrayRow key={item.key} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TrayRow({ item }: { item: TrayItem }) {
  const { user } = useAuth();
  const [said, setSaid] = useState<{ words: string; fault: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  /** A file is proved in this browser first; a platform's own player needs no proof. */
  const proved = async (): Promise<boolean> => {
    if (item.rung !== 2 || item.link.kind === 'audio') return item.rung !== 5;
    if (item.link.kind !== 'file') return true;
    const refusal = await probeVideoLink(item.link.url);
    if (refusal === null) return true;
    setSaid({ words: refusal, fault: true });
    return false;
  };
  const run = async (work: () => Promise<void> | void) => {
    setBusy(true);
    setSaid(null);
    try {
      if (await proved()) await work();
    } catch (failure) {
      setSaid({ words: failure instanceof Error ? failure.message : 'SOMETHING WENT WRONG.', fault: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rule-pixel py-2">
      <p className="break-words">{item.title}</p>
      <p className="text-ink-quiet">
        {item.site} · {item.kind}
        {item.seconds !== null ? ` · ${lengthText(item.seconds)}` : ''}
      </p>
      {item.rung === 5 ? (
        <p>{item.reason}</p>
      ) : (
        <SplitKey
          label={item.title}
          first={{
            words: '▶ PLAY IN ROOM',
            label: `Play in room: ${item.title}`,
            disabled: busy,
            busy,
            press: () =>
              void run(() => {
                const went = playInMainRoom({ link: item.link }, item.title);
                if (went === 'none') setSaid({ words: NO_ROOM_YET, fault: true });
              }),
          }}
          second={{
            words: '+ QUEUE',
            label: `Queue: ${item.title}`,
            disabled: busy,
            press: () =>
              void run(async () => {
                const added = await addToMyQueue({ title: item.title, link: item.link }, user?.id ?? null);
                setSaid({ words: added.where === 'room' && queueIsALiveRoom() ? 'IN THE ROOM\'S QUEUE.' : 'IN YOUR QUEUE.', fault: false });
              }),
          }}
        />
      )}
      {said !== null ? (
        <p role="status" className={said.fault ? 'mt-1 w-fit bg-bubble-pale px-1 text-ink-bar' : 'mt-1'}>
          {said.words}
        </p>
      ) : null}
    </li>
  );
}
