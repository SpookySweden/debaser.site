'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { findIn, HISTORY_DAYS, type Seen } from '../../lib/seeing/history';
import { clearHistory, forgetOne, historyRows, historyRowsOnServer, subscribeToHistory } from '../../lib/seeing/history-store';
import { trailOf } from '../../lib/seeing/trail';
import { FIELD_TIGHT, PLATE, PLATE_PRESSED, TITLE_BAR_INACTIVE } from '../../lib/ui/controls';
import { subscribeToTheme, themeState } from '../../lib/ui/theme-slot';
import { themeById } from '../../lib/ui/themes';
import { explain, NOTE } from '../../lib/ui/explain';

const ROWS_SHOWN = 200;

/** HISTORY and TRAIL: yours alone, over the page. */
export default function SeeingHistory({ onGo, onClose }: { onGo: (address: string) => void; onClose: () => void }) {
  const rows = useSyncExternalStore(subscribeToHistory, historyRows, historyRowsOnServer);
  const [view, setView] = useState<'list' | 'trail'>('list');
  const [words, setWords] = useState('');
  const [clearing, setClearing] = useState(false);
  const [failed, setFailed] = useState(false);
  const found = useMemo(() => findIn(rows, words), [rows, words]);
  return (
    <section aria-label="History" className="absolute inset-0 z-30 flex flex-col bg-paper p-2 text-label text-ink" data-seeing-history>
      <div className="flex flex-wrap items-center gap-1">
        <h2 className={`${TITLE_BAR_INACTIVE} min-w-40 flex-1`}>HISTORY</h2>
        <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')} className={view === 'list' ? `${PLATE_PRESSED} cursor-pointer` : PLATE} {...explain('Shows your history as a list, newest first, by day.', 'To find a page by when you saw it, or by words with FIND.')}>
          [ LIST ]
        </button>
        <button type="button" aria-pressed={view === 'trail'} onClick={() => setView('trail')} className={view === 'trail' ? `${PLATE_PRESSED} cursor-pointer` : PLATE} {...explain('Shows your history as a map of sites, with lines for how you went from one to the next.', 'To see where your reading wandered; press a site to go back to the last page you saw there.')}>
          [ TRAIL ]
        </button>
        <input value={words} onChange={(event) => setWords(event.target.value)} aria-label="Find in history" placeholder="FIND" spellCheck={false} className={`${FIELD_TIGHT} w-40`} />
        <button
          type="button"
          disabled={rows.length === 0}
          onClick={() => {
            // Two presses: there is no bringing it back.
            if (clearing) void clearHistory().then((done) => setFailed(!done));
            setClearing(!clearing);
          }}
          onBlur={() => setClearing(false)}
          className={PLATE}
          {...explain(clearing ? 'Press again to wipe your whole BROWSER history.' : 'Wipes your whole BROWSER history, after asking once.', 'History is yours alone and goes by itself after 90 days; this clears it now.', NOTE.undo)}
        >
          {clearing ? '[ CLEAR ALL? ]' : '[ CLEAR ]'}
        </button>
        <button type="button" aria-label="Close history" onClick={onClose} className={PLATE} {...explain('Closes HISTORY and goes back to the page.')}>
          [ × ]
        </button>
      </div>
      <p className="text-ink-quiet">ONLY YOU SEE THIS. {HISTORY_DAYS} DAYS. KEPT ON YOUR ACCOUNT, SO IT FOLLOWS YOU TO ANOTHER DEVICE: THE PAGES OWN EYE SHOWED TOO, BY ADDRESS AND TITLE.</p>
      {failed ? <p role="status">IT COULD NOT BE CLEARED FROM YOUR ACCOUNT: TRY AGAIN.</p> : null}
      {rows.length === 0 ? (
        <p className="p-1">NOTHING YET.</p>
      ) : found.length === 0 ? (
        <p className="p-1">NOTHING FOUND.</p>
      ) : view === 'list' ? <List rows={found} onGo={onGo} /> : <TrailMap rows={found} onGo={onGo} />}
    </section>
  );
}

const dayOf = (at: number): string => new Date(at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();

function List({ rows, onGo }: { rows: readonly Seen[]; onGo: (address: string) => void }) {
  return (
    <ul className="min-h-0 flex-1 overflow-y-auto">
      {rows.slice(0, ROWS_SHOWN).map((row, i) => {
        const date = new Date(row.at);
        const on = dayOf(row.at);
        const first = i === 0 || dayOf(rows[i - 1].at) !== on;
        return (
          <li key={`${row.at} ${row.address}`} className="rule-pixel flex flex-wrap items-baseline gap-x-2 py-1">
            {first ? <span className="basis-full text-accent-ink">{on}</span> : null}
            <span className="tabular-nums text-ink-quiet">{date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
            <button type="button" onClick={() => onGo(row.address)} title={row.address} className={`${PLATE} max-w-full min-w-0 truncate`} {...explain('Opens this page again in this tab.')}>
              {row.title}
            </button>
            {row.own === true ? (
              <span className="text-ink-quiet" data-seeing-history-own={row.told === true ? 'account' : 'here'} title={row.told === true ? 'Shown by your own browser, signed in. Its address and title are in your history on your account, like the rest; this mark is kept in this browser.' : 'Shown by your own browser before your account kept such pages: this one stays in this browser only.'}>
                {row.told === true ? 'OWN EYE' : 'OWN EYE · KEPT IN THIS BROWSER ONLY'}
              </span>
            ) : null}
            <button type="button" aria-label={`Forget ${row.title}`} title="Forget" onClick={() => forgetOne(row)} className={PLATE} {...explain('Takes this one visit out of your history.', 'To forget a single page without clearing the rest.', NOTE.undo)}>
              ×
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The map: words where the places are, and the steps between them as plain lines behind. */
function TrailMap({ rows, onGo }: { rows: readonly Seen[]; onGo: (address: string) => void }) {
  const trail = useMemo(() => trailOf(rows), [rows]);
  const box = useRef<HTMLDivElement>(null);
  const lines = useRef<HTMLCanvasElement>(null);
  const themeId = useSyncExternalStore(subscribeToTheme, themeState, themeState).id;

  useEffect(() => {
    const draw = () => {
      const [room, canvas] = [box.current, lines.current];
      const pen = canvas?.getContext('2d') ?? null;
      if (room === null || canvas === null || pen === null) return;
      const [wide, high] = [room.clientWidth, room.clientHeight];
      canvas.width = wide;
      canvas.height = high;
      pen.strokeStyle = themeById(themeId).tokens['accent-ink'];
      const where = new Map(trail.places.map((place) => [place.site, place]));
      for (const step of trail.steps) {
        const [from, to] = [where.get(step.from), where.get(step.to)];
        if (from === undefined || to === undefined) continue;
        pen.lineWidth = Math.min(4, step.times);
        pen.beginPath();
        pen.moveTo(from.x * wide, from.y * high);
        pen.lineTo(to.x * wide, to.y * high);
        pen.stroke();
      }
    };
    draw();
    const watch = new ResizeObserver(draw);
    if (box.current !== null) watch.observe(box.current);
    return () => watch.disconnect();
  }, [trail, themeId]);

  return (
    <div ref={box} className="relative min-h-0 flex-1 overflow-hidden" data-seeing-trail>
      <canvas ref={lines} aria-hidden="true" className="absolute inset-0" />
      {trail.places.map((place) => (
        <button
          key={place.site}
          type="button"
          onClick={() => onGo(place.last)}
          title={`${place.visits} ${place.visits === 1 ? 'visit' : 'visits'}`}
          className={`${PLATE} absolute -translate-x-1/2 -translate-y-1/2 bg-paper whitespace-nowrap`}
          {...explain(`Opens the last page you saw on ${place.site}.`, 'Each site on the TRAIL is a place you went; the lines show which you came to from which.')}
          style={{ left: `${place.x * 100}%`, top: `${place.y * 100}%` }}
        >
          {place.site}
        </button>
      ))}
      {/* The map's legend: what is on it, and while there is no line, what makes one. */}
      <p className="absolute bottom-0 left-0 bg-paper p-1 text-ink-quiet tabular-nums" data-seeing-trail-legend>
        {trail.places.length} {trail.places.length === 1 ? 'PLACE' : 'PLACES'} · {trail.steps.length} {trail.steps.length === 1 ? 'WAY' : 'WAYS'} BETWEEN THEM
        {trail.steps.length === 0 ? '. A LINE IS DRAWN WHEN YOU GO FROM ONE SITE TO ANOTHER IN A TAB.' : ''}
      </p>
    </div>
  );
}
