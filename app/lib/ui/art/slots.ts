/**
 * The artwork slot registry: every drawing the site asks for, one entry each.
 *
 * A *slot* is a named hole that a hand-drawn file fills. Nothing in this module
 * draws anything - it is a list of what may be drawn, how big the file must be,
 * and what the site shows instead while the file is missing. `npm run art` reads
 * it, checks the files on disk against it, and prints what is still to draw.
 *
 * ## The size rule
 *
 *     natural = shown x k          (k a whole number)
 *
 * `shown` is the box, in CSS pixels, that the component lays out. `k` is the
 * whole-number zoom: draw at `natural`, show at `shown`, and every drawn pixel
 * maps onto a whole number of screen pixels, so the edge lands hard. A file that
 * is not `shown x k` is *wrong*, not merely off - a 40x40 drawing in a 24x24 box
 * resamples and every line goes soft, which is the one thing pixel art cannot do.
 *
 * A slot with more than one box in `shown` (a flag is drawn 18x12 in a byline and
 * 24x16 on a profile) takes its `k` from the *first* box and the others are held
 * to dividing `natural` evenly - 72x48 is 4x18x12 and 3x24x16, both whole.
 *
 * `scales: true` is the documented exception: a slot the layout asks for at many
 * sizes (a profile picture is shown at 20, 28, 56, 80 and 128) is drawn once at
 * one size and the browser resamples with `image-rendering: pixelated`, which
 * stays hard-edged at a fractional ratio - uneven, but never blurred. Such a
 * slot only has to be drawn at least as big as the largest box.
 *
 * ## The two states, and why the fallback is required
 *
 * Every slot names a CSS fallback: what the site draws when the file is absent.
 * That is what makes art additive - the `default` theme grows one file at a time
 * and never shows a hole - and it is also the only honest brief, because it says
 * what the drawing has to *beat*.
 *
 * ## Placeholders
 *
 * `placeholder: true` marks a file that exists at a size deliberately smaller
 * than the drawing's (the three cursors are 4x4 stand-ins from Phase 1). The
 * audit lists those as "waiting" rather than failing, but a placeholder that has
 * grown to the drawing's size is an error - take the flag off.
 *
 * This module deliberately imports nothing, so `npm run art` can compile it on
 * its own in a second. The ink tokens a slot names are validated against
 * `../themes.ts` by the theme check, which owns that list.
 */

/** What sort of thing a slot is - it decides which checks apply and how it is drawn. */
export type ArtSlotKind =
  | 'tile'
  | 'cursor'
  | 'frame'
  | 'bar'
  | 'plate'
  | 'field'
  | 'panel'
  | 'chip'
  | 'mark'
  | 'sprite'
  | 'flag'
  | 'sheet'
  | 'portrait';

/** How a drawing is fitted into its box when the box is not the drawing's size. */
export type ArtFit =
  | 'stretch'
  | 'slice'
  | 'tile'
  | 'contain';

export type ArtSlot = {
  /** Stable name. A theme maps this id to a file path; nothing else may name a slot. */
  readonly id: string;
  /** Human label, printed in the brief and in the audit. */
  readonly label: string;
  readonly kind: ArtSlotKind;
  /** Path from the project root. `{code}` and `{n}` are per-file slots (flags, cursors). */
  readonly path: string;
  /** The boxes the site lays out, in CSS pixels. The first one fixes `k`. */
  readonly shown: readonly (readonly [number, number])[];
  /** The whole-number zoom. `natural = shown[0] x k`. */
  readonly k: number;
  /** 9-slice insets, in drawn pixels, as `[top, right, bottom, left]`. Omitted for one-piece art. */
  readonly margins?: readonly [number, number, number, number];
  readonly fit: ArtFit;
  /** Drawn once, shown at whatever size a caller asks for. Only for pictures. */
  readonly scales?: true;
  /** A file that exists but is deliberately not the drawing yet. */
  readonly placeholder?: true;
  /** CSS custom properties this drawing feeds, if any. */
  readonly css?: readonly string[];
  /** Token the drawing's own ink resolves to, from `<themes.ts>`. Absent for multicolour art. */
  readonly ink?: string;
  /** What the site draws while the file is absent. */
  readonly fallback: string;
  /** One line for the artist: what this drawing is for. */
  readonly brief: string;
};

/**
 * Every slot, in the order the brief prints them: the desktop first, then the
 * things that sit on it, then the controls, then the pictures.
 */
export const ART_SLOTS = [
  /* ---------------------------------------------------------------- the desktop */
  {
    id: 'desktop-tile',
    label: 'DESKTOP TILE',
    kind: 'tile',
    path: 'assets/desktop/desktop-tile.png',
    shown: [[128, 128]],
    k: 1,
    fit: 'tile',
    css: ['--art-desktop-tile'],
    fallback: "the CSS dither `.desktop-tile` lays down (two colours, 4px, no file)",
    brief: 'The desktop behind every window. Repeats seamlessly, so no edge may show.',
  },
  {
    id: 'taskbar-strip',
    label: 'TASKBAR STRIP',
    kind: 'bar',
    path: 'assets/desktop/taskbar-strip.png',
    shown: [[24, 24]],
    k: 2,
    margins: [6, 8, 6, 8],
    fit: 'slice',
    css: ['--art-taskbar'],
    fallback: 'the woven strip `.taskbar` draws with one repeating linear-gradient',
    brief: 'The bar along the bottom of the screen. Stretches the full width.',
  },

  /* ----------------------------------------------------------------- the cursors */
  {
    id: 'cursor-arrow',
    label: 'CURSOR: ARROW',
    kind: 'cursor',
    path: 'assets/cursors/arrow.png',
    shown: [[32, 32]],
    k: 1,
    fit: 'contain',
    placeholder: true,
    css: ['--art-cursor-arrow'],
    fallback: 'the system cursor (`auto` ends every `cursor:` list)',
    brief: 'The pointer itself. Hotspot at 0,0 - the tip is the pixel that clicks.',
  },
  {
    id: 'cursor-pointer',
    label: 'CURSOR: HAND',
    kind: 'cursor',
    path: 'assets/cursors/pointer.png',
    shown: [[32, 32]],
    k: 1,
    fit: 'contain',
    placeholder: true,
    css: ['--art-cursor-pointer'],
    fallback: 'the system cursor (`pointer`)',
    brief: 'Over anything pressable. Hotspot on the finger tip.',
  },
  {
    id: 'cursor-text',
    label: 'CURSOR: I-BEAM',
    kind: 'cursor',
    path: 'assets/cursors/text.png',
    shown: [[32, 32]],
    k: 1,
    fit: 'contain',
    placeholder: true,
    css: ['--art-cursor-text'],
    fallback: 'the system cursor (`text`)',
    brief: 'Over a text field. Hotspot at the middle of the bar.',
  },

  /* ----------------------------------------------------------------- the windows */
  {
    id: 'window-frame',
    label: 'WINDOW FRAME',
    kind: 'frame',
    path: 'assets/windows/window-frame.png',
    shown: [[32, 32]],
    k: 2,
    margins: [10, 8, 10, 8],
    fit: 'slice',
    css: ['--art-frame'],
    fallback: 'the two-colour bevel `BEVEL_OUT` writes as Tailwind borders',
    brief: 'The raised plate every window is made of: light top-left, dark bottom-right.',
  },
  {
    id: 'window-frame-inset',
    label: 'INSET FRAME',
    kind: 'frame',
    path: 'assets/windows/window-frame-inset.png',
    shown: [[32, 32]],
    k: 2,
    margins: [10, 8, 10, 8],
    fit: 'slice',
    css: ['--art-frame-inset'],
    fallback: 'the sunken bevel `BEVEL_IN` writes as Tailwind borders',
    brief: 'The sunken version: dark top-left, light bottom-right. A well inside a well.',
  },
  {
    id: 'title-bar',
    label: 'TITLE BAR (ACTIVE)',
    kind: 'bar',
    path: 'assets/windows/title-bar.png',
    shown: [[24, 24]],
    k: 2,
    margins: [4, 10, 4, 10],
    fit: 'slice',
    css: ['--art-title-bar'],
    ink: 'ink-bar',
    fallback: 'the Nigrosine-to-Royal-Blue gradient `.title-bar` paints',
    brief: 'The bar a window is dragged by and the bar text sits on. Only the middle stretches.',
  },
  {
    id: 'title-bar-inactive',
    label: 'TITLE BAR (INACTIVE)',
    kind: 'bar',
    path: 'assets/windows/title-bar-inactive.png',
    shown: [[24, 24]],
    k: 2,
    margins: [4, 10, 4, 10],
    fit: 'slice',
    css: ['--art-title-bar-inactive'],
    ink: 'ink-quiet',
    fallback: 'the flat Flavine `TITLE_BAR_INACTIVE` uses',
    brief: 'The same bar on a window nobody is working in. It has to read quieter than the active one.',
  },
  {
    id: 'status-bar',
    label: 'STATUS BAR',
    kind: 'bar',
    path: 'assets/windows/status-bar.png',
    shown: [[22, 22]],
    k: 2,
    margins: [5, 8, 5, 8],
    fit: 'slice',
    css: ['--art-status-bar'],
    ink: 'ink-bar',
    fallback: 'the ruled strip `STATUS_BAR` draw',
    brief: 'The last row of a window, where the counts and the hints live.',
  },

  /* ---------------------------------------------------------------- the controls */
  {
    id: 'plate',
    label: 'PLATE (RESTING)',
    kind: 'plate',
    path: 'assets/controls/plate.png',
    shown: [[24, 24]],
    k: 2,
    margins: [6, 6, 6, 6],
    fit: 'slice',
    css: ['--art-plate', '--art-plate-rest'],
    fallback: 'the raised bevel `PLATE` writes, over `bg-chrome`',
    brief: 'Every button at rest. The middle is flat - only the four corners are art.',
  },
  {
    id: 'plate-hover',
    label: 'PLATE (HOVER)',
    kind: 'plate',
    path: 'assets/controls/plate-hover.png',
    shown: [[24, 24]],
    k: 2,
    margins: [6, 6, 6, 6],
    fit: 'slice',
    css: ['--art-plate-hover'],
    fallback: '`plate-invert` swapping the two bevel colours',
    brief: 'The same plate with a pointer over it. It must read as the same plate, lit.',
  },
  {
    id: 'plate-pressed',
    label: 'PLATE (PRESSED)',
    kind: 'plate',
    path: 'assets/controls/plate-pressed.png',
    shown: [[24, 24]],
    k: 2,
    margins: [6, 6, 6, 6],
    fit: 'slice',
    css: ['--art-plate-pressed'],
    fallback: '`PLATE_PRESSED`: `BEVEL_IN` over `bg-ena`',
    brief: 'The plate under a finger. The bevel turns inside out; that inversion is the whole press.',
  },
  {
    id: 'plate-disabled',
    label: 'PLATE (DISABLED)',
    kind: 'plate',
    path: 'assets/controls/plate-disabled.png',
    shown: [[24, 24]],
    k: 2,
    margins: [6, 6, 6, 6],
    fit: 'slice',
    css: ['--art-plate-disabled'],
    ink: 'ink-plate',
    fallback: 'the `disabled:` bevel `PLATE` falls back to',
    brief: 'A control that cannot be pressed. It must not look pressable - that is its job.',
  },
  {
    id: 'plate-accent',
    label: 'PLATE (ACCENT)',
    kind: 'plate',
    path: 'assets/controls/plate-accent.png',
    shown: [[24, 24]],
    k: 2,
    margins: [6, 6, 6, 6],
    fit: 'slice',
    css: ['--art-plate-accent'],
    ink: 'ink-bar',
    fallback: '`PLATE_ACCENT` over `bg-ena`',
    brief: 'A verb that reaches out of a window onto the board, so it is findable in a list of plates.',
  },
  {
    id: 'field',
    label: 'TEXT FIELD',
    kind: 'field',
    path: 'assets/controls/field.png',
    shown: [[24, 24]],
    k: 2,
    margins: [8, 8, 8, 8],
    fit: 'slice',
    css: ['--art-field'],
    ink: 'ink',
    fallback: '`FIELD`: `BEVEL_IN` over `bg-paper`',
    brief: 'Where words go in. Sunken, and the writing sits on plain White.',
  },
  {
    id: 'panel',
    label: 'PANEL',
    kind: 'panel',
    path: 'assets/controls/panel.png',
    shown: [[24, 24]],
    k: 2,
    margins: [8, 8, 8, 8],
    fit: 'slice',
    css: ['--art-panel'],
    fallback: '`PANEL`: a raised plinth with a sunken well inside it',
    brief: 'The raised box a group of controls stands on. Two bevels: one out, one in.',
  },
  {
    id: 'chip',
    label: 'SHELF CHIP',
    kind: 'chip',
    path: 'assets/controls/chip.png',
    shown: [[22, 22]],
    k: 2,
    margins: [6, 8, 6, 8],
    fit: 'slice',
    css: ['--art-chip'],
    ink: 'ink-plate',
    fallback: '`SHELF_CHIP`: the flat plate with a hairline border',
    brief: 'One track, one tag, one label on a shelf. Small, flat, and legible at 22px.',
  },
  {
    id: 'title-bar-button',
    label: 'TITLE-BAR BUTTON',
    kind: 'plate',
    path: 'assets/controls/title-bar-button.png',
    shown: [[18, 18]],
    k: 2,
    margins: [4, 4, 4, 4],
    fit: 'slice',
    css: ['--art-title-bar-button'],
    fallback: '`TITLE_BAR_BUTTON`: the 18px bevel plate each bar key wears',
    brief: 'Close, minimise, and the keys beside them. 18px square, so the glyph is the artwork.',
  },
  {
    id: 'sprite-slot',
    label: 'SPRITE SLOT FACE',
    kind: 'plate',
    path: 'assets/controls/sprite-slot.png',
    shown: [[24, 24]],
    k: 2,
    margins: [6, 6, 6, 6],
    fit: 'slice',
    css: ['--art-sprite-slot'],
    fallback: '`SPRITE_SLOT`: the empty dark field a waiting sprite reads against',
    brief: 'The field behind a hand-drawn sprite, and the face of a slot still waiting for one.',
  },

  /* ------------------------------------------------------------------- the marks */
  {
    id: 'mark-signin',
    label: 'SIGN-IN MARK',
    kind: 'mark',
    path: 'assets/icons/google-retro.png',
    shown: [[20, 20]],
    k: 2,
    fit: 'contain',
    css: ['--art-mark-signin'],
    fallback: 'the provider name in a bordered plate (`/signin`)',
    brief: 'The mark beside "SIGN IN WITH ...". A glyph, not a logo lock-up, at 20px.',
  },

  /* ----------------------------------------------------------------- the moving */
  {
    id: 'sprite-walk',
    label: 'SPRITE: WALK CYCLE',
    kind: 'sprite',
    path: 'assets/sprites/walk-cycle.gif',
    shown: [[24, 24]],
    k: 1,
    fit: 'contain',
    css: ['--art-sprite-walk'],
    fallback: 'an empty sprite slot, which reads as "no drawing yet"',
    brief: 'The looping figure on the taskbar and in the Start menu. 24px, frames laid out horizontally.',
  },
  {
    id: 'sprite-profile',
    label: 'SPRITE: PROFILE',
    kind: 'sprite',
    path: 'assets/sprites/profile.gif',
    shown: [[24, 24]],
    k: 1,
    fit: 'contain',
    css: ['--art-sprite-profile'],
    fallback: 'an empty sprite slot, which reads as "no drawing yet"',
    brief: 'The figure beside an account name. 24px, still or looping, and it must read as a person.',
  },

  /* ------------------------------------------------------------------ the flags */
  {
    id: 'flag',
    label: 'COUNTRY FLAG',
    kind: 'flag',
    path: 'assets/flags/{code}.png',
    shown: [
      [18, 12],
      [24, 16],
    ],
    k: 4,
    fit: 'contain',
    css: ['--art-flag'],
    fallback: 'the two-letter code in a bordered plate (`CountryFlag` draws it)',
    brief: 'One file per country in `app/lib/profile/countries.ts`, named by its two-letter code.',
  },

  /* ---------------------------------------------------------------- the pictures */
  {
    id: 'concept-sheet',
    label: 'CONCEPT SHEET',
    kind: 'sheet',
    path: 'assets/concepts/{n}.png',
    shown: [[352, 366]],
    k: 1,
    fit: 'contain',
    fallback: '`[ ARTWORK FILE NOT FOUND ]` naming the path it wanted (`SheetImage`)',
    brief: 'A full sheet. The size is its manifest entry and the file must match that exactly.',
  },
  {
    id: 'avatar-default',
    label: 'DEFAULT PROFILE PICTURE',
    kind: 'portrait',
    path: 'assets/profiles/avatar-default.png',
    shown: [
      [128, 128],
      [80, 80],
      [56, 56],
      [28, 28],
      [20, 20],
    ],
    k: 2,
    fit: 'contain',
    scales: true,
    fallback: 'the anonymous slot `ProfileAvatar` draws: dithered field, "[ NO PICTURE ]" at 96px',
    brief: 'The house picture: the site\'s own account, and every account that has filed none.',
  },
] as const satisfies readonly ArtSlot[];

/**
 * The ids as a union, derived from the registry, so a theme cannot name a slot
 * that is not a slot. `ART_SLOT_IDS` is the same list at runtime.
 */
export type ArtSlotId = (typeof ART_SLOTS)[number]['id'];

export const ART_SLOT_IDS: readonly ArtSlotId[] = ART_SLOTS.map((slot) => slot.id);

/** The box a slot's file must be drawn at: `shown[0] x k`. */
export function naturalSize(slot: ArtSlot): readonly [number, number] {
  const [w, h] = slot.shown[0];
  return [w * slot.k, h * slot.k];
}

/** The slot with this id, or `undefined`. */
export function artSlot(id: string): ArtSlot | undefined {
  return ART_SLOTS.find((slot) => slot.id === id);
}

/** True when this slot names one file per code or number (`{code}`, `{n}`). */
export function isPerFileSlot(slot: ArtSlot): boolean {
  return slot.path.includes('{');
}


