# SPEC: Readability pass ("Gnorp windows")

Interviewed 2026-10-22. Build this in a fresh session. Read `docs/design.md` and `.claude/rules/frontend.md` first.

## Goal
Make the whole site easy to read, styled after the game *(the) Gnorp Apologue*: smooth dark windows, thin
light outlines, a quiet pixel font with real lowercase. Move away from Win95 for readability and
usability, while keeping the site's palette, snap feedback and pixel feel.

## Why it reads badly today
- One face, Silkscreen, with no true lowercase (it draws small caps), and `font-bold` on about 500 elements.
- `text-[10px]` about 500 times in 110 files. Silkscreen sits on an 8px grid, so 10, 11 and 13px smear.
- Plates wobble on hover (`animate-wobble`, `bump`), so the label moves while you read it.
- Acid-yellow fields on a pink dithered desktop. Before pictures: `Temp/browse/now-desktop.png`, `now-phone.png`.

## The reference (Gnorp Apologue, Steam screenshots)
- A dark slate field. Each window is a dark fill with a thin light outline whose corners step in one pixel.
- The title sits in the top line, centred: `——— SLAM CLUB ———`.
- A thin pixel font, mixed case, never bold. Titles and pill labels in capitals.
- The selected option is a filled pill (light fill, dark text). Colour is used only for accents.
- Mock of the agreed look: `Temp/browse/font-options.png`, option C, left column (source `font-options.html`).

## Decisions (Luke, 2026-10-22)
1. **Font: DotGothic16**, from `next/font/google`, replacing Silkscreen in `app/layout.tsx`. It has one
   weight (400), so set `font-synthesis: none` globally and stop relying on bold: emphasis comes from
   colour (Daffodil) or size. The fallbacks in `globals.css` change to match.
2. **Dark by default.** The Gnorp-like dark look becomes the default. The bright yellow look stays as the
   second theme in preferences. Keep the theme *ids* (`default`, `dark`): they are what browsers have
   stored. Make `dark` the fallback for visitors who never chose, so anyone who picked the bright theme
   keeps it. Drop its EXPERIMENTAL note. The boot values in `globals.css` (`@theme`) must match the new
   default, because `check-themes` holds them together.
3. **Gnorp-style controls and windows.** No Win95 bevels.
   - Windows and panels: a 2px outline with one-step notched corners, done with CSS `clip-path` (a frame
     shape, not artwork). Keep the `--art-frame` hooks so Luke can hand-draw a frame later.
   - Title bars become the title set into the top line. Active and inactive windows differ by title
     colour (Daffodil versus field ink), not by a blue or yellow bar.
   - Buttons: outlined, with notched corners. The one main action on a screen is filled Daffodil with
     Black text. Pressed or selected states (tabs, switches) are filled pills.
   - Hover is an instant colour swap. Remove wobble, bump and shake from anything that carries text.
     Keep the press snap (1px drop, the pink flash), still with no easing. RADI-OH's `hop` stays,
     because those faces are text art, not labels.
4. **Bigger text.** The smallest label is 13px (was 10). Labels and buttons are 13–14px. Writing (posts,
   comments, comms, lore pages, profile bios) is 15–16px, with line-height about 1.5. Title lines are
   16px. Phone inputs stay at 16px. Phone tap targets stay at 44px or more.

## Defaults set while planning (tell Luke if any change)
- Labels stay in capitals, as written in the code: that is the site's voice. Prose already shows the
  case people typed, so it becomes mixed case with no copy changes.
- Out of scope: the character workbench canvas, RADI-OH faces (`--font-emote`), game boards' play
  areas, new artwork of any kind, wording changes, database changes.
- Contrast stays at 4.5:1 or better in both themes. Motion still stops under `prefers-reduced-motion`.

## Build order (commit and push after each step, each one live and verified)
1. **Font and type scale.** Swap the face. Add `font-synthesis: none`. Raise the sizes in
   `app/lib/ui/controls.ts` and the `@layer components` block in `globals.css` first. Then sweep the
   hard-coded sizes (`text-[9px]`, `[10px]`, `[11px]`, `[12px]`, `text-xs`) with the `mechanic` agent
   using an exact mapping, and review what it changed.
2. **Dark default theme.** Make it the Gnorp field: Nigrosine fill, White outline and ink, Flavine
   captions, accents in Daffodil, Pink and Emerald. Bring the bright theme onto the same frames.
3. **Frames and title lines.** `.panel` and `PANEL`, the four title-bar styles, the status bar, the
   taskbar, and the frames in `DockWindow`, `PopoutWindow` and `SiteWindow`.
4. **Controls.** Every plate style, `TITLE_BAR_BUTTON`, `GLYPH_BUTTON`, `FIELD`, `SHELF_CHIP`, and the
   scrollbar grip.
5. **Window-by-window sweep at 1440px and 390px**, fixing anything that wraps or overflows: the board,
   side panel, taskbar and start menu, player bar, music, queues, arcade and games, comms, profile and
   customiser, preferences, lore directory, page and editor, account pages, users, and the project shelves.
6. **Rewrite `docs/design.md`**: the Gnorp frame, the font and its sizes, dark by default, and no Win95.

## Proof
- `npm run verify`, then `npm run checks`. Expect deliberate updates to these checks, each with a reason:
  check-themes, check-surreal, check-shell, check-structure, check-profile-layout, check-audio,
  check-queues, check-window-layout, check-board-comments.
- `npm run capture`, then `npm run audit`. Small-text findings should fall, with no new contrast failures.
- Before and after screenshots (`npm run shot`) of each page in step 5, at desktop and phone width.
- Live: `npm run read`, plus screenshots of the deployed site.

## Gotchas
- DotGothic16 is drawn on a 16px grid. 16 and 32 are pixel-sharp; 13–15 are slightly soft but read
  well (see the mock).
- Glyphs such as ♪ ▶ ◀ ↻ fall back to system fonts, as they do today.
- Bigger text is most of the work. The player bar, side panel, title lines and taskbar will wrap.
- The lore editor's styles in `globals.css` use literal hex values. Move them onto theme tokens while
  you are there, or a dark default leaves a lore page dark-on-dark.
