'use client';

/**
 * One list in the LISTS panel: a plate that opens it, and - for a list of the reader's own - a plate
 * that takes it away.
 *
 * A delete is *not* behind a confirmation, and the reason is the one this whole feature rests on: a
 * list holds pointers, not files, so taking one away cannot lose any music. What it loses is an
 * ordering, which is annoying and not destructive - and a dialog for it would cost every reader a press
 * to protect one of them from a mistake they can remake in a minute. That is the same trade the site
 * makes for folding a folder, for the same reason.
 */
export default function ListRow({
  label,
  note,
  selected,
  onSelect,
  symbol,
  onDrop,
}: {
  label: string;
  /** The count, as the row's right-hand reading. A bare number, because the title bar says the unit. */
  note: string;
  selected: boolean;
  onSelect: () => void;
  /** The glyph the list is keyed with: `♥` for LIKED, `♪` for one the reader made. */
  symbol: string;
  onDrop?: () => void;
}) {
  return (
    <div className={`flex items-center gap-1 px-1 py-[2px] ${selected ? 'bg-ena' : ''}`}>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-none px-1 py-[2px] text-left text-[10px] font-bold max-sm:min-h-11 max-sm:text-sm ${
          selected ? 'text-sun' : 'text-ink hover:bg-ice'
        }`}
      >
        <span aria-hidden="true" className="shrink-0">
          {symbol}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="shrink-0">{note}</span>
      </button>

      {onDrop === undefined ? null : (
        <button
          type="button"
          onClick={onDrop}
          title={`Delete the playlist ${label}`}
          aria-label={`Delete the playlist ${label}`}
          className={`shrink-0 cursor-pointer rounded-none border border-ink px-1 text-[10px] font-bold max-sm:min-h-11 max-sm:min-w-11 max-sm:text-sm ${
            selected ? 'bg-ink text-paper hover:bg-chrome' : 'bg-paper text-ink hover:bg-ice'
          }`}
        >
          ×
        </button>
      )}
    </div>
  );
}
