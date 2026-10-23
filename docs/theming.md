# Theming: how the look is changed

Every visual value on the site lives in three files, and components ask for **names**, never values.
`npm run tokens` (inside `npm run verify`) fails the build if a raw value creeps back in anywhere else.
To see everything at once, open **`/specimen`** (not linked from anywhere): both themes side by side,
every colour, ink-on-surface pair with its contrast, text size, face, line, key, spacing step, layer
and motion, with the measured value beside each.

| What | Where | Names components use |
|---|---|---|
| Sizes, spacing, lines, faces by job, layers, motion, the dials | `app/theme/tokens.css` | `text-label`, `p-2`, `border-line`, `font-mono`, `z-popout`, `animate-flash` |
| The faces themselves (which fonts load) | `app/theme/fonts.ts` | `--face-pixel` (only tokens.css reads it) |
| Colours: the nine dyes, and which dye plays which part in each theme | `app/lib/ui/themes.ts` | `bg-paper`, `text-ink`, `border-ink-plate` |

## Change a colour
- **A dye everywhere** (say Royal Blue): edit it in `DYES` at the top of `themes.ts`.
- **What plays a part in one theme** (say the dark windows' fill, `sun-pale`): edit that token in
  `DARK_THEME` or `DEFAULT_THEME`, pointing it at a dye.
- Then run `npm run tokens -- --write`. It rewrites the colour block in `tokens.css` (what a page shows
  before its script runs). `npm run tokens` fails until you do.
- Check contrast: `/specimen` shows every ink on every surface with its ratio (4.5 is the floor), and
  `npm run checks` (`Temp/check-themes.cjs`) does the arithmetic for every pair the site uses.
- A new colour job (a token): add it to `ThemeTokens` and both themes in `themes.ts`, then `--write`.
- People's own colours (a name's swatch, a tag's hue) and the character workbench's figure paint are
  data, not the look: `name-colours.ts`, `tag-vocabulary.ts`, `app/lib/character/`. The guard skips them.

## Change a font
- **Swap the site's face**: in `app/theme/fonts.ts`, change `DotGothic16` on the import line to another
  Google font (`import { VT323 as PixelFace } from 'next/font/google'`). Every job follows.
  - A face with several weights wants `weight` listed (or removed, for a variable font).
  - **`font-bold` trap:** 457 elements carry `font-bold`. It does nothing today because DotGothic16 has
    one weight and `font-synthesis` is off. A face *with* a bold turns all of them bold at once. Decide
    before swapping: remove the `font-bold`s, or accept them.
  - A face of your own: `next/font/local` (`localFont({ src: './face.woff2', variable: '--face-pixel' })`).
- **Give one job its own face** (say titles): load a second face in `fonts.ts` with its own variable
  (`--face-display`) and add it to `FACE_VARIABLES`, then point the job at it in `tokens.css`
  (`--font-display: var(--face-display), ...`). Titles do not wear `--font-display` yet (it would change
  their fallback faces); add `font-family: var(--font-display);` to the `.title-line` rule in globals.css.
- The jobs: `--font-body` (everything), `--font-mono` (fields, numbers, code), `--font-display` (titles,
  once wired), `--font-emote` (RADI-OH's faces: must be monospaced with a true lowercase).

## Change the scale
Two dials at the top of `tokens.css`:
- `--scale-type: 1` - every text size. `1.1` is everything 10% bigger.
- `--scale-space: 1` - every padding, gap, margin and box size on Tailwind's scale (`p-2`, `gap-3`, `w-56`).

Floors that ignore the dials: the 44px phone tap target (`--spacing-tap`, used as `min-h-tap` /
`min-w-tap`) and the phone's 16px field text (`--text-field-phone`, which stops the phone zooming in).
Outline thickness is a value, not a dial: `--border-width-line` (2px). Keep it a whole number of pixels.

To change one size rather than all: edit its token (`--text-label: calc(13px * var(--scale-type))`).

## The names
- **Text, by job:** `text-label` 13 (the floor), `text-key` 14, `text-prose` 15, `text-title` 16,
  `text-heading` 18, `text-display` 20, `text-headline` 24. `text-sm`, `text-base`, `text-xl`, `text-4xl`,
  `text-5xl` are Tailwind's steps and carry their own line spacing (mostly phone key sizes and page headings).
- **Line spacing:** `leading-tight/snug/normal/relaxed`, and `leading-readout` (14px) for single-line readouts.
- **Spacing:** Tailwind's unit, in quarter steps: `py-0.5` is 2px, `py-0.75` 3px, `gap-2.5` 10px.
- **Lines:** `border-line` (and `border-t-line`, ...), `border-thick`, plain `border` for a hairline.
- **Colours:** see `ThemeTokens` in `themes.ts` for what each job is for. `ink-plate` is Black and
  `ink-bar` is White in both themes (they replaced `black` and `white`).
- **Layers:** `z-menu` 70, `z-dock` 90, `z-banner` 95, `z-popout` 100, `z-overlay` 120. Small stacking
  inside one component keeps `z-10`..`z-50`.
- **The press:** `translate-y-press` (1px).

## What the guard refuses (`npm run tokens`)
Outside the three token files, under `app/`: colour values (`#hex`, `rgb()`), Tailwind's own palette
(`border-black`, `text-red-500`), a bracketed value on a look utility (`text-[13px]`, `py-[2px]`,
`z-[90]`, `leading-[14px]`), a numbered line width (`border-2`), a named face or `font-sans`, a literal
colour or text size in a `style={{}}`, and in CSS a literal `font-size`, `font-family`, `z-index`, line
width or spacing (use `var(--text-label)`, `--spacing(2)`, `var(--border-width-line)`). Layout sizes in
brackets are allowed (`w-[22rem]`, `max-h-[62vh]`, grid templates). Known exceptions, each with its
reason, are the `EXCEPTIONS` list in `scripts/check-tokens.cjs`.

## Proving a change moved nothing
For a refactor that should not change the look (moving values onto tokens, renaming classes):
1. Build and start the site (`npm run build`, then `npm start -- -p 3210`) *before* the change, and run
   `npm run styles -- --out Temp/styles/before` (add `--signin` for a second pass signed in as test account A).
2. Make the change, rebuild, restart, record `Temp/styles/after` the same way.
3. `npm run styles -- --compare Temp/styles/before Temp/styles/after` - every element's computed look,
   15 pages, desktop and phone, both themes. It must say `0 look differences`.

## Traps
- **Two classes for one property on one element** (`py-1` and `py-0.5`, `gap-1` and `gap-0.75`): Tailwind
  decides by its own sort order, not by the order in the class list - and named steps sort by size, while
  bracketed values (`py-[2px]`) sort after all of them. Two such pairs were hiding behind that rule when
  this framework moved the brackets onto the scale (the compact tag chip, the side panel's log-in key).
  Put one value per property on an element; give a variant its own string rather than adding on top.
- An `@theme` reset (`--color-*: initial`) clears every name declared *before* it. The colour reset lives
  once, inside the generated block; the guard refuses a second one. (One below the block wiped every
  colour during the build of this framework.)
- Do not reset `--font-*`: it also takes the weights `font-bold` reads.
- A token name must not be both a colour and a size (`text-label` works because there is no `--color-label`).
- A framed element (`.frame`, keys) takes its outline colour from `--frame-line`, never a `border-*`
  colour utility (that squares the notched corners).
