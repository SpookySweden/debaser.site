import type { BackdropDef, ChoiceKnob, Knob, Widget } from './knobs';

/**
 * How a background's settings window is laid out (Luke, 2026-11-17: "needs to open a slightly larger window, ideally i dont
 * want any scrolling to be necessary to see all the settings"). Every knob is on one sheet, as a property sheet or a plug-in
 * panel has them: no tabs. Each of the background's old tabs is a section with its title line, and a LOOKS section at the end
 * holds RESET, PARTY, the ready-made looks, MORPH and the ghost. The sections are shared out between two or three columns so
 * the tallest column is as short as it can be, and the window opens as wide as those columns and as tall as the tallest.
 *
 * Plain data, no browser: the window lays itself out from this, and the checks run it. The heights are the rows as the window
 * draws them (one line per slider, a line of keys per run of switches or a choice), measured on the site's 13px type; a check
 * in a real browser holds that nothing scrolls at 1366 x 768 (`Temp/check-settings-sheet.cjs` and its drive).
 */

/** A section of the sheet: one of the background's tabs, or the LOOKS at the end. */
export type SheetSection = { id: string; label: string; height: number };

export type SheetLayout = {
  /** The sections in each column, top to bottom. */
  columns: readonly (readonly SheetSection[])[];
  /** The window's size before anybody resizes it, in CSS pixels. */
  size: { w: number; h: number };
};

/** The LOOKS section's id: not a tab of any background. */
export const LOOKS_SECTION = 'looks';

/** One column's width, and the room between columns (the window's `w-82` and `gap-4`). */
export const COLUMN_W = 328;
export const COLUMN_GAP = 16;

/*
 * Rows, as drawn (measured in Chrome, 2026-11-17, `Temp/browse/settingsui-rows.cjs`): a slider's line and the pixel after it;
 * a line of bracket keys and the pixel after it, and each line more when they wrap; a section's title line and the room under
 * it; the gap between two sections; an XY pad's block.
 */
const ROW = 25;
const KEYS = 28.5;
const KEYS_MORE = 31.5;
const TITLE = 28;
const SECTION_GAP = 8;
const PAD = 97;
/** A line of 13px Plex Mono holds this many letters a pixel: each letter is 0.6em. */
const LETTER = 7.8;
/** A bracket key's own padding and the gap after it. */
const KEY_EXTRA = 12;
/** What is left of a column for a choice's keys, beside its name and its two row keys. */
const CHOICE_ROOM = COLUMN_W - 96 - 52 - 12;
/**
 * The window round the sheet (its title line, frame and padding), and the head above the columns: one line in a three-column
 * window; two in a two-column one, where the meters go under `[ THEME ]` (their strips widen as they fill).
 */
const CHROME = 56;
const HEAD = 36;
const HEAD_TWO = 61;

/** How tall a run of bracket keys is when it wraps in `room` pixels. */
const keysHeight = (labels: readonly string[], room: number) => KEYS + (keyLines(labels, room) - 1) * KEYS_MORE;

/** How many lines a run of bracket keys takes in `room` pixels. */
function keyLines(labels: readonly string[], room: number): number {
  let lines = 1;
  let used = 0;
  for (const label of labels) {
    const width = keyWidth(label);
    if (used > 0 && used + width > room) {
      lines += 1;
      used = 0;
    }
    used += width;
  }
  return lines;
}

const keyWidth = (label: string) => (label.length + 4) * LETTER + KEY_EXTRA;

/**
 * Where a choice's keys go. Beside its name, in the controls' column, when they fit on one line there (POINTER `[ STIR ]
 * [ IGNORE ]`); otherwise on lines of their own under the name, the column's full width, shared out evenly so no key is left
 * alone on a line (KALEIDOSCOPE `[ OFF ] [ 2 ] [ 4 ] [ 8 ]`, then GRAIN's seven as four and three). `rows` holds the options'
 * places in the list, line by line.
 */
export function choiceLayout(knob: ChoiceKnob): { beside: boolean; rows: number[][] } {
  const labels = knob.options.map((option) => option.label);
  if (keyLines(labels, CHOICE_ROOM) === 1) return { beside: true, rows: [labels.map((_, index) => index)] };
  return { beside: false, rows: evenRows(labels, COLUMN_W) };
}

/**
 * A run of bracket keys on as few lines as fit in `room`, shared out evenly between them (six keys on two lines: three and
 * three, not five and one). Each line is the keys' places in the list.
 */
export function evenRows(labels: readonly string[], room: number): number[][] {
  const places = labels.map((_, index) => index);
  const per = Math.ceil(labels.length / keyLines(labels, room));
  const rows: number[][] = [];
  for (let start = 0; start < places.length; start += per) rows.push(places.slice(start, start + per));
  // Even shares that would overrun the room (one long name among short ones) fall back to filling each line in turn.
  if (rows.every((row) => row.reduce((sum, index) => sum + keyWidth(labels[index]), 0) <= room)) return rows;
  const greedy: number[][] = [[]];
  let used = 0;
  for (const index of places) {
    if (used > 0 && used + keyWidth(labels[index]) > room) {
      greedy.push([]);
      used = 0;
    }
    greedy[greedy.length - 1].push(index);
    used += keyWidth(labels[index]);
  }
  return greedy;
}

/** The LOOKS section's first keys, in order: RESET, PARTY, then the background's ready-made looks. */
export const looksKeys = (def: BackdropDef): string[] => ['RESET', 'PARTY', ...def.looks.map((look) => look.label)];

/** A choice's height: one line of keys beside its name, or its name's line and then its lines of keys. */
const choiceHeight = (knob: ChoiceKnob) => {
  const { beside, rows } = choiceLayout(knob);
  return beside ? KEYS : ROW + 4 + KEYS + (rows.length - 1) * KEYS_MORE;
};

function widgetsOf(def: BackdropDef): Map<string, Widget> {
  const inWidget = new Map<string, Widget>();
  for (const widget of def.widgets) for (const key of widget.kind === 'pad' ? [widget.x, widget.y] : [widget.low, widget.high]) inWidget.set(key, widget);
  return inWidget;
}

/** A tab's section as the window draws it (`KnobList` in `BackdropSettingsWindow.tsx`, the same walk). */
export function sectionHeight(def: BackdropDef, tab: string): number {
  const inWidget = widgetsOf(def);
  const drawn = new Set<string>();
  let height = TITLE;
  let switches: string[] = [];
  const flush = () => {
    if (switches.length > 0) height += keysHeight(switches, COLUMN_W);
    switches = [];
  };
  const widgetHeight = (widget: Widget) => (widget.kind === 'pad' ? PAD : ROW);
  for (const knob of def.knobs as readonly Knob[]) {
    const widget = inWidget.get(knob.key);
    if (widget !== undefined) {
      if (widget.tab !== tab || drawn.has(widget.id) || knob.tab !== tab) continue;
      flush();
      drawn.add(widget.id);
      height += widgetHeight(widget);
      continue;
    }
    if (knob.tab !== tab) continue;
    if (knob.kind === 'switch') {
      switches.push(knob.label);
      continue;
    }
    flush();
    height += knob.kind === 'range' ? ROW : choiceHeight(knob);
  }
  flush();
  for (const widget of def.widgets) if (widget.tab === tab && !drawn.has(widget.id)) height += widgetHeight(widget);
  const actions = def.actions.filter((action) => action.tab === tab).map((action) => action.label);
  if (actions.length > 0) height += keysHeight(actions, COLUMN_W);
  return height;
}

/** The LOOKS section: RESET, PARTY and the looks on as many lines as they take, then MORPH, then the ghost. */
export function looksHeight(def: BackdropDef): number {
  const lines = evenRows(looksKeys(def), COLUMN_W).length;
  return TITLE + KEYS + (lines - 1) * KEYS_MORE + (def.looks.length > 0 ? KEYS : 0) + KEYS;
}

/** Every section of a background's sheet, in order: its tabs, then LOOKS. */
export function sheetSections(def: BackdropDef): SheetSection[] {
  return [...def.tabs.map((tab) => ({ id: tab.id, label: tab.label, height: sectionHeight(def, tab.id) })), { id: LOOKS_SECTION, label: 'LOOKS', height: looksHeight(def) }];
}

const columnHeight = (column: readonly SheetSection[]) => column.reduce((sum, section, index) => sum + section.height + (index > 0 ? SECTION_GAP : 0), 0);

/** How many pairs of sections a sheet reads out of their own order, column by column, top to bottom. */
function outOfOrder(sections: readonly SheetSection[], columns: readonly (readonly SheetSection[])[]): number {
  const read = columns.flat().map((section) => sections.indexOf(section));
  let pairs = 0;
  for (let a = 0; a < read.length; a += 1) for (let b = a + 1; b < read.length; b += 1) if (read[a] > read[b]) pairs += 1;
  return pairs;
}

/** How much taller than the shortest a sheet may be to read in its own order (LOOKS last, below the rest). */
const ORDER_ALLOWANCE = 16;

/**
 * The sections shared out between `count` columns, each column keeping the sections in their own order: whichever way makes
 * the tallest column shortest (a few sections at most, so every way is tried), unless a way that reads more nearly in order is
 * within `ORDER_ALLOWANCE` of it. Each column starts later in the list than the one before it, so the sheet reads left to right.
 */
export function shareColumns(sections: readonly SheetSection[], count: number): SheetSection[][] {
  const ways: { columns: SheetSection[][]; tallest: number; disorder: number }[] = [];
  for (let way = 0; way < count ** sections.length; way += 1) {
    const columns: SheetSection[][] = Array.from({ length: count }, () => []);
    let rest = way;
    for (const section of sections) {
      columns[rest % count].push(section);
      rest = Math.floor(rest / count);
    }
    if (columns.some((column) => column.length === 0)) continue;
    if (columns.some((column, index) => index > 0 && sections.indexOf(column[0]) < sections.indexOf(columns[index - 1][0]))) continue;
    ways.push({ columns, tallest: Math.max(...columns.map(columnHeight)), disorder: outOfOrder(sections, columns) });
  }
  if (ways.length === 0) return [Array.from(sections)];
  const shortest = Math.min(...ways.map((way) => way.tallest));
  const near = ways.filter((way) => way.tallest <= shortest + ORDER_ALLOWANCE);
  near.sort((a, b) => a.disorder - b.disorder || a.tallest - b.tallest);
  return near[0].columns;
}

/** Below this the sheet is short enough in two columns; above it, three. */
const TWO_COLUMNS_UP_TO = 480;

/** The sheet for a background: its columns, and the size its window opens at. */
export function sheetLayout(def: BackdropDef): SheetLayout {
  const sections = sheetSections(def);
  const two = shareColumns(sections, Math.min(2, sections.length));
  const columns = Math.max(...two.map(columnHeight)) <= TWO_COLUMNS_UP_TO || sections.length < 3 ? two : shareColumns(sections, 3);
  const tallest = Math.max(...columns.map(columnHeight));
  return {
    columns,
    size: { w: columns.length * COLUMN_W + (columns.length - 1) * COLUMN_GAP + 24, h: CHROME + (columns.length < 3 ? HEAD_TWO : HEAD) + tallest },
  };
}
