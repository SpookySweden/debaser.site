import { PLATE, PLATE_PRESSED } from '../lib/ui/controls';
import { QUEUE_SOURCES, QUEUE_TYPES, queueSearchPlan, withQueueFilter } from '../lib/watch/blank-screen';
import type { FilterKey } from '../lib/web/web-filters';
import { SORT_OPTIONS, type SortChoice } from '../lib/web/web-sort';

/**
 * The stream queue search's filters (Luke, 2026-11-04): the same rows as the archive search's, offering only what a
 * room can play. Each key writes its filter into the bar, which stays the one truth (`withQueueFilter`), so the keys
 * and the typed words (`in:youtube`, `from:name`, `vibe:on`, `sort:popular`) can never disagree.
 */
export default function QueueSearchFilters({
  bar,
  disabled,
  onPick,
}: {
  /** What the search bar says. */
  bar: string;
  /** A pasted link is in the bar: there is nothing to filter. The rows stay put, so nothing under them moves. */
  disabled: boolean;
  /** A key was pressed: the bar's new words. */
  onPick: (next: string) => void;
}) {
  const plan = queueSearchPlan(bar);
  const pick = (key: FilterKey, value: string) => onPick(withQueueFilter(bar, key, value));
  const pickSort = (choice: SortChoice) => pick('sort', choice.sort === 'date' ? (choice.dir === 'asc' ? 'oldest' : 'newest') : choice.sort);
  const { sort } = plan;

  return (
    <div className="space-y-1" data-queue-filters>
      <div role="group" aria-label="Source" className="flex flex-wrap items-center gap-1">
        <span className="text-label font-bold text-ink-quiet">SOURCE:</span>
        {QUEUE_SOURCES.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => pick('in', option.value)}
            aria-pressed={plan.source === option.value}
            aria-label={`Source: ${option.label}`}
            className={plan.source === option.value ? PLATE_PRESSED : PLATE}
          >
            {`[ ${option.label} ]`}
          </button>
        ))}
      </div>
      <div role="group" aria-label="Type" className="flex flex-wrap items-center gap-1">
        <span className="text-label font-bold text-ink-quiet">TYPE:</span>
        {QUEUE_TYPES.map((option) => {
          const on = (plan.preset ?? 'all') === option.value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              onClick={() => pick('type', option.value)}
              aria-pressed={on}
              aria-label={`Type: ${option.label}`}
              className={on ? PLATE_PRESSED : PLATE}
            >
              {`[ ${option.label} ]`}
            </button>
          );
        })}
      </div>
      <div role="group" aria-label="Vibe" className="flex flex-wrap items-center gap-1">
        <span className="text-label font-bold text-ink-quiet">VIBE:</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => pick('vibe', plan.vibe ? 'off' : 'on')}
          aria-pressed={plan.vibe}
          aria-label="Vibe search: mood and tag words"
          className={plan.vibe ? PLATE_PRESSED : PLATE}
        >
          {plan.vibe ? '[ ON ]' : '[ OFF ]'}
        </button>
        <span className="text-label text-ink-quiet">MOODS, TAGS, GENRES, DECADES</span>
      </div>
      <div role="group" aria-label="Sort" className="flex flex-wrap items-center gap-1">
        <span className="text-label font-bold text-ink-quiet">SORT:</span>
        {SORT_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => pickSort({ sort: option.value, dir: option.value === 'date' ? sort.dir : 'desc' })}
            aria-pressed={sort.sort === option.value}
            aria-label={`Sort: ${option.label}`}
            className={sort.sort === option.value ? PLATE_PRESSED : PLATE}
          >
            {`[ ${option.label} ]`}
          </button>
        ))}
        <button
          type="button"
          onClick={() => pickSort({ sort: 'date', dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
          disabled={disabled || sort.sort !== 'date'}
          aria-label={sort.sort !== 'date' ? 'Flip the order: only for DATE' : sort.dir === 'asc' ? 'Oldest first: flip to newest first' : 'Newest first: flip to oldest first'}
          className={PLATE}
        >
          {sort.dir === 'asc' && sort.sort === 'date' ? '[ ↑ ]' : '[ ↓ ]'}
        </button>
        <span className="text-label text-ink-quiet">{sort.sort === 'date' ? (sort.dir === 'asc' ? 'OLDEST FIRST' : 'NEWEST FIRST') : 'EACH SITE TAKES TURNS'}</span>
      </div>
    </div>
  );
}
