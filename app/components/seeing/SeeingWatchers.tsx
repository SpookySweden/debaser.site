import type { SeenDocument } from '../../lib/seeing/engine';
import { TITLE_BAR_INACTIVE } from '../../lib/ui/controls';

/** WATCHERS: who was on the page, by company where known, and what was refused. Facts about the page, never about people. */
export default function SeeingWatchers({ document }: { document: SeenDocument }) {
  return (
    <section aria-label="Watchers" className="flex w-64 shrink-0 flex-col overflow-y-auto border-l-line border-ink bg-paper p-2" data-seeing-watchers>
      <h2 className={TITLE_BAR_INACTIVE}>WATCHERS</h2>
      {document.watchers.length === 0 ? (
        <p className="p-1 text-label text-ink">NOBODY.</p>
      ) : (
        <ul>
          {document.watchers.map((watcher) => (
            <li key={`${watcher.company}:${watcher.host}`} className="rule-pixel py-1.5 text-label text-ink">
              <span className="block break-words">{watcher.company}</span>
              <span className="block break-all text-ink-quiet">{watcher.host}</span>
              {watcher.refused ? <span className="block w-fit bg-bubble-pale px-1 text-ink-bar">REFUSED</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
