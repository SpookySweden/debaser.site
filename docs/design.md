# DEBASER_OS design guide

Read this before any UI work. It is not needed for backend or logic tasks.

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
through the theme tokens (`app/globals.css`, `app/lib/ui/themes.ts`); no hex values in components.

## The look: Gnorp windows (SPEC-readability.md, 2026-10-22)
Styled after *(the) Gnorp Apologue*: smooth dark windows, thin light outlines, a quiet pixel font.
No Win95 bevels anywhere - not on windows, not on buttons, not on the scrollbar.

- **Dark by default.** A visitor who never chose a theme gets the dark one (`FALLBACK_THEME`, id `dark`):
  Nigrosine windows, White outlines and words, Flavine captions, accents in Daffodil, Pink and Emerald.
  The bright theme (id `default`: Flavine windows, Black outlines, the pink desktop) is the second choice
  in Preferences. The ids never change - they are what browsers have stored.
- **The frame** (`.frame`): a 2px outline in the field ink whose four corners step in one pixel. Every
  window, panel, well and field wears it. It is drawn as background stripes, not `clip-path`, so focus
  rings, menus and resize grips inside a window are never cut off - which also means a framed element
  must not get a `border-*` colour utility (that squares the corners). `--art-frame` stays the hook for
  a hand-drawn frame.
- **Title lines** (`TITLE_BAR`, `.title-line`): the name set between two rules, `——— SLAM CLUB ———`, with
  no bar behind it. The window being worked in is titled in the accent ink (Daffodil on dark, Royal Blue
  on bright); furniture in the field ink. Counts and keys sit at the right end; on a phone they drop to
  their own row (a window's own title keeps one row so its close key stays in the corner).
- **Status line and taskbar:** a rule across the foot of the window, quiet words under it.
- **Keys** (`PLATE`, `.key`): outlined in their own ink, on the window's fill.
  - The one main action on a screen (post, send, save, log in, + new post) is `PLATE_MAIN`: filled
    Daffodil, Black words, Emerald under the pointer. One per screen.
  - A tab or switch that is on is a filled pill in the field ink (`PLATE_PRESSED`, `key-fill`).
  - `PLATE_ACCENT` (inject to post) is the one Brilliant Pink pill.
  - Disabled keys draw a dotted outline.
- Colour is for accents. Big fills are the window colour; colour marks what matters.
- **Faults are Rose chips** (errors, refusals, warnings, the unread count): White words on a Rose strip,
  `bg-bubble-pale px-1 text-ink-bar` (`w-fit` on a block), 4.70:1 in both themes. Never Rose *words* on
  the window: that is 3.79:1 on Nigrosine and 4.14:1 on Flavine. `Temp/check-themes.cjs` holds it.

## Type
- One face: **DotGothic16**, one weight. `font-synthesis: none`, so bold does nothing - emphasis comes
  from colour (the accent ink) or size, never weight.
- Sizes: the smallest label is **13px**; labels and buttons 13-14px; title lines **16px**; writing
  (posts, comments, comms, lore pages, bios, notes, and the fields they are typed in) **15px at
  line-height 1.5**. Phone inputs stay 16px (stops the zoom). Nothing below 13px.
- DotGothic16 is drawn on a 16px grid: 16 and 32 are pixel-sharp, 13-15 are slightly soft but read well.
- Labels stay in capitals, as written: that is the site's voice. Prose shows the case people typed.
- Glyphs like ♪ ▶ ◀ ↻ fall back to system fonts. RADI-OH's faces use `--font-emote` (a typewriter face).

## Feel
- Pacing: 90s hip-hop call-and-response. Transitions in the spirit of Samurai Champloo.
- NO smooth transitions or easing. Feedback is instant and mechanical.
- **Hover is an instant colour swap** (words and outline turn the accent ink). Nothing that carries a
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
