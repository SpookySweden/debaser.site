'use client';

import type { CSSProperties } from 'react';
import {
  NAME_COLOURS_THAT_GLOW,
  NAME_COLOURS_THAT_READ,
  SITE_COLOUR_LABEL,
  nameColourDark,
  nameColourPairLabel,
  nameColourWearsStrip,
  nameOnThemes,
} from '../lib/profile/name-colours';
import { KEY_FOCUS, PLATE_MAIN } from '../lib/ui/controls';
import PopoutWindow from './PopoutWindow';

const NOTE = 'text-label font-bold text-ink';

/**
 * A choice of name colour is a whole row: a tick, a block of the colour, its name in the window's own ink, then
 * the reader's own name in that colour on the window itself. It doesn't fill under the pointer as a key does,
 * because the fill would cover the very thing the row is showing.
 */
const COLOUR_ROW = `${KEY_FOCUS} flex w-full cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 px-1 py-1 text-left text-prose text-ink min-h-9 active:translate-y-press pointer-coarse:min-h-tap`;

/** The two groups the arithmetic produces (see app/lib/profile/name-colours.ts). */
const NAME_COLOUR_GROUPS = [
  { label: 'READS ON ITS OWN', colours: NAME_COLOURS_THAT_READ },
  { label: 'DARK STRIP ON BRIGHT THEMES', colours: NAME_COLOURS_THAT_GLOW },
];

/** The pair `.name-ink` picks between (globals.css), so this draws exactly what the board draws. */
export function nameInkStyle(hex: string): CSSProperties {
  return { '--name-ink': hex, '--name-ink-dark': nameColourDark(hex) } as CSSProperties;
}

function NameColourRow({ hex, label, sample, chosen, onChoose }: { hex: string; label: string; sample: string; chosen: boolean; onChoose: (hex: string) => void }) {
  // No swatch means the theme's own ink, which has no pair to pick between.
  const ink = hex.length === 0 ? { className: 'text-ink', style: undefined } : { className: 'name-ink', style: nameInkStyle(hex) };
  // The block shows what the name is drawn in. A colour on the strip takes its dark reading on every theme.
  const stripped = nameColourWearsStrip(hex);
  const dark = nameColourDark(hex);
  const blockStyle = stripped ? ({ '--name-ink': dark, '--name-ink-dark': dark } as CSSProperties) : ink.style;

  return (
    <button
      type="button"
      onClick={() => onChoose(hex)}
      aria-pressed={chosen}
      aria-label={label}
      className={`${COLOUR_ROW} ${chosen ? 'outline-2 -outline-offset-2 outline-ink' : 'hover:outline-2 hover:-outline-offset-2 hover:outline-dotted hover:outline-ink'}`}
    >
      {/* A fixed width: the tick falls back to a wider face, and picking a row must not nudge its words. */}
      <span aria-hidden="true" className="w-12 shrink-0 whitespace-pre">
        {chosen ? '[ ✓ ]' : '[   ]'}
      </span>
      <span aria-hidden="true" className={`${ink.className} h-6 w-6 shrink-0 border-line border-ink bg-current`} style={blockStyle} />
      <span className="w-52 shrink-0">{label}</span>
      <span aria-hidden="true" className="min-w-0 flex-1 basis-40 truncate text-title">
        {/* Its own inline box, so a strip is as wide as the name and not the row. The block above never wears one. */}
        <span className={`${ink.className} ${stripped ? 'name-strip' : ''}`} style={ink.style}>
          {sample}
        </span>
      </span>
    </button>
  );
}

/** The choice on every theme, each line in that theme's own window colour. Says so in words if one ever fails. */
function NameOnEveryTheme({ hex, sample }: { hex: string; sample: string }) {
  return (
    <>
      <p className={NOTE}>YOUR PICK ON EVERY THEME</p>
      <ul className="mt-1 border-line border-ink">
        {nameOnThemes(hex).map((theme) => (
          <li
            key={theme.id}
            className="flex min-h-8 flex-wrap items-center gap-x-2 px-2 py-1 text-key"
            style={{ backgroundColor: theme.field, color: theme.ink }}
          >
            <span className="w-24 shrink-0">{theme.label}</span>
            <span className="min-w-0 flex-1 basis-40 truncate text-title">
              <span className={theme.strip === null ? undefined : 'px-1'} style={{ color: theme.value, backgroundColor: theme.strip ?? undefined }}>
                {sample}
              </span>
            </span>
            {theme.readable ? null : <span className="shrink-0">HARD TO READ</span>}
          </li>
        ))}
      </ul>
    </>
  );
}

/** The chooser itself, apart from its window. The theme lines stay in view while the list scrolls under them. */
export function NameColourChooser({ hex, sample, onChoose }: { hex: string; sample: string; onChoose: (hex: string) => void }) {
  return (
    <div>
      <div className="sticky top-0 z-10 bg-sun-pale pb-2">
        <NameOnEveryTheme hex={hex} sample={sample} />
      </div>
      <p className={NOTE}>NO COLOUR OF YOUR OWN</p>
      <div className="mt-1">
        <NameColourRow hex="" label={SITE_COLOUR_LABEL} sample={sample} chosen={hex.length === 0} onChoose={onChoose} />
      </div>
      {NAME_COLOUR_GROUPS.map((group) => (
        <div key={group.label} className="mt-2">
          <p className={NOTE}>{group.label}</p>
          <div className="mt-1">
            {group.colours.map((colour) => (
              <NameColourRow
                key={colour.id}
                hex={colour.hex}
                label={nameColourPairLabel(colour)}
                sample={sample}
                chosen={hex === colour.hex}
                onChoose={onChoose}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The `[ CHANGE COLOUR ]` window (Luke, 2026-11-07). A pick is a draft like every other field in the editor: it shows at
 * once, and the editor's `[ SAVE ]` is what keeps it, so the unsaved-changes prompt still covers it.
 */
export default function NameColourWindow({ hex, sample, onChoose, onClose }: { hex: string; sample: string; onChoose: (hex: string) => void; onClose: () => void }) {
  return (
    <PopoutWindow
      title="NAME COLOUR"
      onClose={onClose}
      status=""
      maxWidth="max-w-3xl"
      actions={
        <button type="button" onClick={onClose} className={PLATE_MAIN}>
          [ DONE ]
        </button>
      }
    >
      <NameColourChooser hex={hex} sample={sample} onChoose={onChoose} />
    </PopoutWindow>
  );
}
