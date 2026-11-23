'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { findIn, HISTORY_DAYS, type Seen } from '../../lib/seeing/history';
import { clearHistory, forgetOne, historyRows, historyRowsOnServer, subscribeToHistory } from '../../lib/seeing/history-store';
import { trailOf } from '../../lib/seeing/trail';
import { FIELD_TIGHT, PLATE, PLATE_PRESSED, TITLE_BAR_INACTIVE } from '../../lib/ui/controls';
import { subscribeToTheme, themeState } from '../../lib/ui/theme-slot';
import { themeById } from '../../lib/ui/themes';

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
        <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')} className={view === 'list' ? `${PLATE_PRESSED} cursor-pointer` : PLATE}>
          [ LIST ]
        </button>
        <button type="button" aria-pressed={view === 'trail'} onClick={() => setView('trail')} className={view === 'trail' ? `${PLATE_PRESSED} cursor-pointer` : PLATE}>
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
        >
          {clearing ? '[ CLEAR ALL? ]' : '[ CLEAR ]'}
        </button>
        <button type="button" aria-label="Close history" onClick={onClose} className={PLATE}>
          [ × ]
        </button>
      </div>
      <p className="text-ink-quiet">ONLY YOU SEE THIS. {HISTORY_DAYS} DAYS.</p>
      {failed ? <p role="status">IT COULD NOT BE CLEARED FROM YOUR ACCOUNT: TRY AGAIN.</p> : null}
      {rows.length === 0 ? <p className="p-1">NOTHING YET.</p> : view === 'list' ? <List rows={found} onGo={onGo} /> : <TrailMap rows={found} onGo={onGo} />}
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
            <button type="button" onClick={() => onGo(row.address)} title={row.address} className={`${PLATE} max-w-full min-w-0 truncate`}>
              {row.title}
            </button>
            <button type="button" aria-label={`Forget ${row.title}`} title="Forget" onClick={() => forgetOne(row)} className={PLATE}>
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
          style={{ left: `${place.x * 100}%`, top: `${place.y * 100}%` }}
        >
          {place.site}
        </button>
      ))}
    </div>
  );
}
