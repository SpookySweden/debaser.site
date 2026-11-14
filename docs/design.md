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

## Palette: "SHERBET" (the third template only, 2026-10-31)
Candy #FFB7E6, Carnation #FFA1C5, Salmon #FF9DA2, Coral #FF987F, Tangerine #FF9368, Mint #67DCA9,
Orchid #B149AA, Lime #C5FF3F. Worn only by the SHERBET template's three options (PINK, NIGHT, MINT),
picked under SHERBET in Preferences. All are light except Orchid, and Orchid words fail on the pastels
(3:1), so SHERBET's words and links borrow Black, Nigrosine and Royal Blue from the palette above.
Light/dark CSS (name colours, the CONTRAST cursor) reads `data-scheme`, not a theme id. One borrowing outside it: the beat box's loop bar is
Orchid under White numbers, because BeepBox's is purple and Orchid is the only purple there is (Luke, 2026-11-06).

## The cover card (SPEC-music-queues.md, 2026-11-03)
A room's screen while a song plays has a look of its own, the same in every theme: still retro, an Ash grey
ground (#3D3C44) with coloured words, the title in Flavine and the rest in Candy (`cover-card`,
`cover-card-title`, `cover-card-ink` in themes.ts). The song's cover sits above its words.

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
- **No taskbar** (Luke, 2026-11-14): the OS window has no strip along its foot, so the page runs to the
  window's bottom edge. `[ START ]`, its menu and the sprite slot beside it are gone from the screen
  (`Taskbar.tsx` and `StartMenu.tsx` are kept, not drawn). What only the menu led to on a computer, the
  projects map and FILES, is listed under ALSO in the MODULOS window. The top bar has no `MODULES:` title,
  and the side panel's shelf has no ARCADE key (`ARCADE_KEY_SHOWN` in `SiteNav.tsx`; the arcade still opens
  from an invitation or a challenge). Docked and pop-up windows have no foot unless they carry their own
  keys there.
- **FILL WINDOW** (Luke, 2026-11-07; reworked 2026-11-14): one worded key at the far end of the top bar,
  `[ FILL WINDOW ]`, makes the OS window run edge to edge (its title line stands aside) and then reads
  `[ SHRINK WINDOW ]`. It changes the window's size and nothing else: the side panel stays as the reader has it.
  The choice is kept in the browser and written on `<html>` before the first paint (`data-site-fill`), and the
  stylesheet lays the window out from that mark, so a reload never draws the normal window first. From `md` up
  only; a page that fills by itself (the beat box, ANIMATE, the reader) has no key.
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
  - **One key, two halves** (`SplitKey`, Luke 2026-11-14): `[ ▶ PLAY │ + QUEUE ]`, `[ + LETTER │ PLAYLIST ]`.
    One pair of brackets round two presses, a `│` seam between them. Under the pointer each half fills its
    own dye at once - the first Emerald (Lime on SHERBET), the second Brilliant Pink (Mint) - with Black
    words. A key that has no second half is an ordinary key.
  - **Filled pills, the three exceptions:** the one main action on a screen (post, send, save, log in,
    + new post) is `PLATE_MAIN` - filled Daffodil, Black words, Emerald under the pointer, one per
    screen; a tab or switch that is on is a filled pill in the field ink (`PLATE_PRESSED`, `key-fill`);
    `PLATE_ACCENT` (`[ INJECT ]`) is the one Brilliant Pink pill.
- **Words are kept to a minimum** (Luke, 2026-10-25). A label names the thing and stops; a button says
  the action; an empty state is one short line (`NOTHING YET.`) with no instructions after it. Nothing
  restates what a title, badge, button or switch already shows. A sentence a reader really needs (how
  following a queue works, what a privacy switch does) goes behind a `[ ? ]` key (`InfoFold`), which
  folds it open and works on phones. A hover tip is a few words naming an unlabelled control, never an
  explanation; page intros (`SiteWindow`'s `tip`) are a short phrase or nothing. Errors and refusals
  stay on screen, as short as they can be while still saying what to do.
- **Say it once.** No badge that repeats a window's title, no count of what is plainly on screen, no
  readback of a setting. A guest gets one sign-in call per screen (the banner's `[ LOG IN ]`); a locked
  action elsewhere is one line, `[ LOG IN ] TO <DO THE THING>`.
- Colour is for accents. Big fills are the window colour; colour marks what matters.
- **Names keep their colour and stay readable** (Luke, 2026-11-06): on a bright theme, a name in a colour that would
  fade into the window (Emerald, Rose, Brilliant Pink, Flavine, Daffodil) has each letter outlined in Black: a hard
  one-pixel edge all the way round, no blur, as lettering in a pixel game has (`.name-edge`; Luke, 2026-11-14: "a
  border instead of a bar"; it was a Black strip behind the name until then). The letter inside takes its dark
  reading. Readable means two things here, both 4.5:1 or better: the edge against the window, and the letter against
  its edge (`Temp/check-name-colour.cjs`). No outline on a dark theme, where every name colour reads on its own.
- **Faults are Rose chips** (errors, refusals, warnings, the unread count): White words on a Rose strip,
  `bg-bubble-pale px-1 text-ink-bar` (`w-fit` on a block), 4.70:1 in both themes. Never Rose *words* on
  the window: that is 3.79:1 on Nigrosine and 4.14:1 on Flavine. `Temp/check-themes.cjs` holds it.

## Type
- One face: **IBM Plex Mono**, for everything (titles too), **weight 400** (SPEC-efficiency.md,
  2026-10-23; it replaced DotGothic16, whose dotted capitals smeared at 13-15px). `font-synthesis: none`
  and the site's family has no bold, so the `font-bold`s in class lists do nothing - emphasis comes from
  colour (the accent ink) or size. Fallbacks: `'Courier New', monospace`.
- **One heavier weight, on purpose** (Luke, 2026-11-14: "more separation between title, description, etc
  in the media tabs results ... done subtly with font/ boldness"): Plex Mono 600, a family of its own,
  worn only through `font-strong`. MEDIA's result titles wear it. Use it for the one thing the eye should
  find first in a block, never for a whole line of labels; `font-bold` stays inert.
- Sizes: the smallest label is **13px** (`text-label`); labels and buttons 13-14px (`text-key`); title
  lines **16px** (`text-title`); writing (posts, comments, comms, lore pages, bios, notes, and the fields
  they are typed in) **15px at line-height 1.5** (`text-prose`). Phone inputs stay 16px (stops the zoom).
  Nothing below 13px.
- Plex Mono is **about 20% wider** than DotGothic16 (each letter 0.6em, not 0.5em). Tight strips - the
  player bar, the side panel, title lines with extras, the taskbar - were cut down before the swap; keep
  them short.
- **DOCS is bigger on purpose** (Luke, 2026-11-13: "usable by a grandad"). Its screens and windows sit in
  `.docs-ui` (`DocsScale`), whose TEXT SIZE step (1-6, the reader's `[ A− ] [ A+ ]` keys, kept in that browser)
  picks which of the tokens above the writing, keys, small lines and title use: a computer starts on step 2
  (writing 18px, keys 16px), a phone on step 5 (writing 36px), because a phone shows the 1280px desktop at a
  third of its size. Its keys are `DOC_KEY`, `DOC_KEY_ON` and `DOC_KEY_MAIN` (`app/lib/docs/ui.ts`): the same
  bracket key, a thumb tall at every width, with a text character beside the word on the toolbar. Its words
  are plain ones: `ALL CHANGES SAVED`, `ONLY YOU HERE`, `CHANGED YESTERDAY AT 09:10`, `ONLY ME / EVERYONE`.
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
- **The one glow: the module you are on** (Luke, 2026-11-14: "make sure a modules selected colour displays
  glowing while it is selected"). On the top bar, the key of the page you are on is filled with the colour its
  person picked for it in MODULOS (the field ink when none is picked, or when the pick would not read on this
  theme's bar) and wears a halo of that colour: two hard rings that step outward and fade, no blur. It breathes
  in two frames with no easing, and holds still under reduced motion (`.module-on`, globals.css). Its word is the
  bar's own colour, 4.5:1 or better on every pick (`moduleInk`; `Temp/check-modules.cjs` walks every pick).
  Nothing else on the site glows.

## Readability floors
- Text contrast 4.5:1 or better in both themes (`check-themes` holds the token pairs; `npm run contrast`
  measures a real page in both themes).
- Phone tap targets 44px or more. Every screen works at 390px with no sideways scroll.

## Checking visual work
- Take screenshots at desktop (1440) and phone (390) width and compare them against what was asked for,
  in the dark theme first. List the differences and fix them.
- Run `npm run capture` then `npm run audit`, and `npm run contrast` for colour changes.
