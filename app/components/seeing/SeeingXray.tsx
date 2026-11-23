import type { Census, Pointed } from '../../lib/seeing/frame';
import { TITLE_BAR_INACTIVE } from '../../lib/ui/controls';

/** X-RAY's panel: the element pointed at, and what the page is made of. Every word is a page's own, drawn as words. */
export default function SeeingXray({ point, census }: { point: Pointed | null; census: Census | null }) {
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
          <ul>
            {census.rows.map((row, index) => (
              <li key={index} className="truncate" style={{ paddingLeft: `${row.depth * 0.75}em` }}>
                {row.name}
                {row.inside > 0 ? <span className="text-ink-quiet"> {row.inside}</span> : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
