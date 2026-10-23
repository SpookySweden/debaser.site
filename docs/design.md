# DEBASER_OS design guide

Read this before any UI work. It is not needed for backend or logic tasks.

**How to change the look** (a colour, a font, the overall size) is `docs/theming.md`: every value lives in
`app/theme/tokens.css`, `app/theme/fonts.ts` and `app/lib/ui/themes.ts`, and `/specimen` shows all of them
in both themes on one page.

## Palette: "Dyacid Dyes"
- Nigrosine #1A1525
- Royal Blue #1D3CA6
- Daffodil Yellow #FFF000
- Flavine #E1FF00
- Brilliant Pink #FF00A0
- Rose #E6004C
- Emerald #28C745
- Plus black and white

Use with creative liberty. Do not force a rigid colour-to-role mapping. Colours reach components only
through the theme tokens (`app/lib/ui/themes.ts`, copied into `app/theme/tokens.css`); no hex values in components.

## The look: Gnorp windows (SPEC-readability.md, 2026-10-22)
Styled after *(the) Gnorp Apologue*: smooth dark windows, thin light outlines, a quiet pixel font.
No Win95 bevels anywhere - not on windows, not on buttons, not on the scrollbar.

- **Dark by default.** A visitor who never chose a theme gets the dark one (`FALLBACK_THEME`, id `dark`):
  Nigrosine windows, White outlines and words, Flavine captions, accents in Daffodil, Pink and Emerald.
  The bright theme (id `default`: Flavine windows, Black outlines, the pink desktop) is the second choice
  in Preferences. The ids never change - they are what browsers have stored.
- **The frame** (`.frame`): a 2px outline in the field ink whose four corners step in one pixel. Only
  **windows** (the OS window, docked and pop-up windows, menus) and **fields** wear it - a box is what
  says "type here". It is drawn as background stripes, not `clip-path`, so focus rings, menus and resize
  grips inside a window are never cut off - which also means a framed element must not get a `border-*`
  colour utility (that squares the corners). `--art-frame` stays the hook for a hand-drawn frame.
  Also kept: pictures, the player's black LED screens and the game boards' play areas.
- **Flat sections** (SPEC-efficiency.md, 2026-10-23): a section inside a window has no outline and no
  fill of its own (`PANEL` is empty). Its title line is what separates it. Dotted row separators inside
  lists (`rule-pixel`) stay. Never put a box inside a box.
- **Title lines** (`TITLE_BAR`, `.title-line`): the name set between two rules, `——— SLAM CLUB ———`, with
  no bar behind it. The window being worked in is titled in the accent ink (Daffodil on dark, Royal Blue
  on bright); furniture in the field ink. Counts and keys sit at the right end; on a phone they drop to
  their own row (a window's own title keeps one row so its close key stays in the corner).
- **Taskbar:** a rule across the foot of the OS window holding `[ START ]` and the sprite slot (no status
  line; gone on a phone). Docked and pop-up windows have no foot unless they carry their own keys there.
- **Keys are bracket keys** (`PLATE`, `.key`; SPEC-efficiency.md, 2026-10-23): a key is its label in
  brackets, `[ LOG IN ]`, in the accent ink, with **no outline**. Accent-ink brackets mean "press me", so
  a bracketed readout that is not a key (`[ 3 ]`, `[ READ ONLY ]`) is cut or loses its brackets.
  - Under the pointer it fills, instantly: the accent ink becomes the fill and the words take the
    window's own colour (`paper`: Nigrosine on Daffodil, White on Royal Blue - never Black, which is
    2.2:1 on Royal Blue). The press keeps its 1px drop and the Brilliant Pink flash.
  - Disabled keys go quiet: the quiet ink (16:1), no fill under the pointer, the not-allowed pointer.
  - On a phone a key keeps its 44px tap height (`min-h-tap`) as invisible padding, not a visible box.
  - A key on a strip that is Black in both themes (the guest banner) is `PLATE_ON_BLACK`: Daffodil.
  - A key that sits straight on the desktop gets a window under it (the folded player is a framed tile).
  - Glyph keys in a row of glyphs (the nav glyphs ⌂ ≡ ☻ ✉ ⚿, the transport ◀ ▶) stay bare glyphs.
  - **Filled pills, the three exceptions:** the one main action on a screen (post, send, save, log in,
    + new post) is `PLATE_MAIN` - filled Daffodil, Black words, Emerald under the pointer, one per
    screen; a tab or switch that is on is a filled pill in the field ink (`PLATE_PRESSED`, `key-fill`);
    `PLATE_ACCENT` (`[ INJECT ]`) is the one Brilliant Pink pill.
- **Explanations are tips.** A sentence that explains how to use something is the `title` (hover tip)
  of the thing it explains, or of its section's title line - not a line on screen. A page's intro is
  the window title's tip (`SiteWindow`'s `tip`); a window's how-to line is its title line's tip
  (`DockWindow`/`PopoutWindow`'s `status`). Errors, refusals and empty states stay on screen. Phones do
  not see tips; that is accepted. A tip on a disabled button goes on a wrapping `<span>`.
- **Say it once.** No badge that repeats a window's title, no count of what is plainly on screen, no
  readback of a setting. A guest gets one sign-in call per screen (the banner's `[ LOG IN ]`); a locked
  action elsewhere is one line, `[ LOG IN ] TO <DO THE THING>`.
- Colour is for accents. Big fills are the window colour; colour marks what matters.
- **Faults are Rose chips** (errors, refusals, warnings, the unread count): White words on a Rose strip,
  `bg-bubble-pale px-1 text-ink-bar` (`w-fit` on a block), 4.70:1 in both themes. Never Rose *words* on
  the window: that is 3.79:1 on Nigrosine and 4.14:1 on Flavine. `Temp/check-themes.cjs` holds it.

## Type
- One face: **IBM Plex Mono**, for everything (titles too), **weight 400 only** (SPEC-efficiency.md,
  2026-10-23; it replaced DotGothic16, whose dotted capitals smeared at 13-15px). `font-synthesis: none`
  and no bold is loaded, so the `font-bold`s in class lists do nothing - emphasis comes from colour (the
  accent ink) or size, never weight. Fallbacks: `'Courier New', monospace`.
- Sizes: the smallest label is **13px** (`text-label`); labels and buttons 13-14px (`text-key`); title
  lines **16px** (`text-title`); writing (posts, comments, comms, lore pages, bios, notes, and the fields
  they are typed in) **15px at line-height 1.5** (`text-prose`). Phone inputs stay 16px (stops the zoom).
  Nothing below 13px.
- Plex Mono is **about 20% wider** than DotGothic16 (each letter 0.6em, not 0.5em). Tight strips - the
  player bar, the side panel, title lines with extras, the taskbar - were cut down before the swap; keep
  them short.
- Labels stay in capitals, as written: that is the site's voice. Prose shows the case people typed.
- Glyphs like ♪ ▶ ◀ ↻ ⌂ ☻ ✉ ⚿ fall back to system fonts. RADI-OH's faces use `--font-emote` (a
  typewriter face).

## Feel
- Pacing: 90s hip-hop call-and-response. Transitions in the spirit of Samurai Champloo.
- NO smooth transitions or easing. Feedback is instant and mechanical.
- **Hover is an instant colour swap** (a bracket key fills with the accent ink). Nothing that carries a
  label moves under the pointer: no wobble, bump or shake on text.
- **The press** is the one movement left: a 1px drop and the Brilliant Pink flash, no easing.
- RADI-OH's faces may hop - they are text art, not labels. Motion stops under `prefers-reduced-motion`.
- Pixel-art accents. No soft drop shadows.

## Readability floors
- Text contrast 4.5:1 or better in both themes (`check-themes` holds the token pairs; `npm run contrast`
  measures a real page in both themes).
- Phone tap targets 44px or more. Every screen works at 390px with no sideways scroll.

## Checking visual work
- Take screenshots at desktop (1440) and phone (390) width and compare them against what was asked for,
  in the dark theme first. List the differences and fix them.
- Run `npm run capture` then `npm run audit`, and `npm run contrast` for colour changes.
