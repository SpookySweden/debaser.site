'use client';

import { useState } from 'react';
import { getComicRepository } from '../../lib/comic/repository';
import { chapterPages, chaptersInOrder, releaseTitle } from '../../lib/comic/rules';
import type { ComicContents } from '../../lib/comic/types';
import { PLATE, PLATE_MAIN, TITLE_BAR } from '../../lib/ui/controls';
import ComicPageImage from './ComicPageImage';

/**
 * The studio's RELEASE (SPEC-comic.md, Q7, Q8): every queued page in reading order. Luke ticks the ones to send out and presses
 * `[ RELEASE ]`, then `[ YES, RELEASE <N> PAGES ]`: they all go out now, as one batch, with one "new pages" alert to followers.
 * No schedule, no undo (the alert has gone); a released page can still be replaced or deleted in PAGES.
 */
export default function StudioRelease({ contents, reload }: { contents: ComicContents; reload: () => Promise<void> }) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const queue = chaptersInOrder(contents).flatMap((chapter) =>
    chapterPages(contents, chapter.id)
      .map((page, index) => ({ page, chapter, number: index + 1 }))
      .filter((entry) => entry.page.releasedAt === null),
  );
  const chosen = queue.filter((entry) => ticked.has(entry.page.id));
  const ready = chosen.filter((entry) => entry.page.hasCopies);

  const toggle = (id: string) => {
    setAsking(false);
    setDone(null);
    setTicked((now) => {
      const next = new Set(now);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const release = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const count = await getComicRepository().release(ready.map((entry) => entry.page.id));
      setDone(`RELEASED: ${releaseTitle(count, ready.map((entry) => entry.chapter.number))}.`);
      setTicked(new Set());
      setAsking(false);
      await reload();
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : 'THE PAGES COULD NOT BE RELEASED.');
    }
    setBusy(false);
  };

  return (
    <section aria-labelledby="studio-release" className="flex flex-col gap-2">
      <h2 id="studio-release" className={TITLE_BAR}>
        QUEUE
      </h2>
      {problem ? <p className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">{problem}</p> : null}
      {done ? <p className="text-label text-accent-ink">{done}</p> : null}
      {queue.length === 0 ? <p className="text-label text-ink">NOTHING QUEUED.</p> : null}
      {queue.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {!asking ? (
            <button type="button" className={PLATE_MAIN} disabled={ready.length === 0 || busy} onClick={() => setAsking(true)}>
              [ RELEASE ]
            </button>
          ) : (
            <>
              <button type="button" className={PLATE_MAIN} disabled={busy} onClick={() => void release()}>
                {`[ YES, RELEASE ${ready.length} ${ready.length === 1 ? 'PAGE' : 'PAGES'} ]`}
              </button>
              <button type="button" className={PLATE} disabled={busy} onClick={() => setAsking(false)}>
                [ NO ]
              </button>
            </>
          )}
          <button type="button" className={PLATE} onClick={() => setTicked(new Set(queue.map((entry) => entry.page.id)))}>
            [ TICK ALL ]
          </button>
          <button type="button" className={PLATE} disabled={ticked.size === 0} onClick={() => setTicked(new Set())}>
            [ UNTICK ALL ]
          </button>
        </div>
      ) : null}
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {queue.map((entry) => (
          <li key={entry.page.id}>
            <label className="flex cursor-pointer flex-col gap-1 text-label text-ink">
              <ComicPageImage page={entry.page} label={`CHAPTER ${entry.chapter.number}, PAGE ${entry.number}`} className="frame overflow-hidden" />
              <span className="flex items-center gap-1">
                <input type="checkbox" checked={ticked.has(entry.page.id)} onChange={() => toggle(entry.page.id)} />
                {`CH ${entry.chapter.number} · P ${entry.number}`}
              </span>
              {!entry.page.hasCopies ? <span className="w-fit bg-bubble-pale px-1 text-ink-bar">NO COPIES YET</span> : null}
            </label>
          </li>
        ))}
      </ol>
    </section>
  );
}
