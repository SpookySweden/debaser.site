'use client';

import type { Census, Pointed } from '../../lib/seeing/frame';
import { TITLE_BAR_INACTIVE } from '../../lib/ui/controls';

/** X-RAY's panel: what is pointed at, and what the page is made of; a row of that, pointed at or reached by the keyboard, is outlined on the page. */
export default function SeeingXray({ point, census, lit, onLit }: { point: Pointed | null; census: Census | null; lit: string | null; onLit: (at: string | null) => void }) {
  return (
    <section aria-label="X-ray" className="flex w-72 shrink-0 flex-col gap-2 overflow-y-auto border-l-line border-ink bg-paper p-2 text-label text-ink" data-seeing-xray>
      <h2 className={TITLE_BAR_INACTIVE}>POINTED AT</h2>
      {/* Held open whether or not anything is pointed at, so the tree below doesn't move under the pointer. */}
      <div className="min-h-48">
        {point === null ? (
          <p>NOTHING.</p>
        ) : (
          <>
            <p>
              {point.kind} · {point.size} · {point.inside} INSIDE
            </p>
            <p className="break-words text-ink-quiet">{point.path.join(' > ')}</p>
            <p className="break-words">{point.face}</p>
            <p className="break-words">
              {point.ink} ON {point.ground}
            </p>
            <p className="line-clamp-3 break-words text-ink-quiet">{point.words}</p>
          </>
        )}
      </div>
      <h2 className={TITLE_BAR_INACTIVE}>MADE OF</h2>
      {census === null ? null : (
        <>
          <ul className="grid grid-cols-2 gap-x-2 tabular-nums">
            {(Object.entries(census.counts) as [string, number][]).map(([name, count]) => (
              <li key={name}>
                {name.toUpperCase()} {count}
              </li>
            ))}
          </ul>
          <ul onMouseLeave={() => onLit(null)}>
            {census.rows.map((row, index) => (
              <li key={index} className="truncate" style={{ paddingLeft: `${row.depth * 0.75}em` }}>
                {row.at === null ? (
                  row.name
                ) : (
                  <button
                    type="button"
                    onClick={() => onLit(row.at)}
                    onMouseEnter={() => onLit(row.at)}
                    onFocus={() => onLit(row.at)}
                    onBlur={() => onLit(null)}
                    className={`max-w-full truncate text-left ${lit === row.at ? 'bg-ink text-paper' : ''}`}
                    data-seeing-xray-row
                  >
                    {row.name}
                  </button>
                )}
                {row.inside > 0 ? <span className="text-ink-quiet"> {row.inside}</span> : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
