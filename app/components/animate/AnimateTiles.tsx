'use client';

import { getEngine } from '../../lib/animate/engine';
import { useStudio } from '../../lib/animate/store';
import { KEY_FOCUS } from '../../lib/ui/controls';

/** A word in a pop-up block: big, readable with very poor eyesight, and hit with a pen. */
const TILE = `key cursor-pointer whitespace-nowrap px-2 py-1.5 text-center text-heading leading-tight disabled:cursor-not-allowed ${KEY_FOCUS}`;
const TILE_ON = `${TILE} key-fill key-on [--key-fill:var(--color-ink)] text-paper`;
/** About the widest word, FILL ERASER, at the interface's own size. */
const TILE_WIDTH = 152;

export type TileItem = { label: string; run: () => void; on?: boolean; disabled?: boolean; name?: string };

/** How many tiles fit across what's left of the sheet: a narrow or zoomed window gets fewer, never a block cut off. */
export function useTileColumns(most: number): number {
  const uiScale = useStudio((state) => state.settings.uiScale);
  return Math.max(2, Math.min(most, Math.floor((getEngine().stageSize().w - 16) / uiScale / TILE_WIDTH)));
}

export function Tile({ item, onPress }: { item: TileItem; onPress: (item: TileItem) => void }) {
  return (
    <button type="button" className={item.on === true ? TILE_ON : TILE} aria-pressed={item.on} aria-label={item.name} disabled={item.disabled} data-animate-tile={item.label} onClick={() => onPress(item)}>
      {item.label}
    </button>
  );
}

export function TileGrid({ items, columns, onPress }: { items: TileItem[]; columns: number; onPress: (item: TileItem) => void }) {
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {items.map((item) => (
        <Tile key={item.label} item={item} onPress={onPress} />
      ))}
    </div>
  );
}

/** A value changed by steps, with the pop-up left open so the result can be watched. Two keys and its reading, no slider to aim at. */
export function Stepper({ label, value, less, more, canLess = true, canMore = true }: { label: string; value: string; less: () => void; more: () => void; canLess?: boolean; canMore?: boolean }) {
  const words = label.toLowerCase();
  return (
    <div className="flex items-center justify-between gap-2 text-heading text-ink" data-animate-stepper={label}>
      <span className="whitespace-nowrap">{label}</span>
      <span className="flex items-center gap-1">
        <button type="button" className={TILE} aria-label={`${words} down`} disabled={!canLess} onClick={less}>
          [ - ]
        </button>
        <span aria-live="polite" className="min-w-14 whitespace-nowrap text-center">
          {value}
        </span>
        <button type="button" className={TILE} aria-label={`${words} up`} disabled={!canMore} onClick={more}>
          [ + ]
        </button>
      </span>
    </div>
  );
}
