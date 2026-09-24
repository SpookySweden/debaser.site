# Project Overview: Comic Book Lore & Concept Art Portfolio

A responsive, single-page Next.js dashboard serving as an exploratory site for comic book lore and a concept art portfolio. Includes user authentication, dynamic message boards, and real-time collaborative lore editing.

## Tech Stack

- Frontend & Routing: Next.js (App Router), deployed to Vercel
- Styling: Tailwind CSS (strict Web 1.0 aesthetic — see constraints below)
- Backend & Auth: Supabase (PostgreSQL, Supabase Auth, Row Level Security)
- Real-Time: Supabase Realtime for message boards
- Collaborative Editing: Tiptap + Yjs (CRDT) for conflict-free, Google-Docs-style live editing

## Visual Aesthetic & UI Constraints

Strictly Web 1.0 / weirdcore / retro MS-DOS, inspired by Joel G's ENA universe.

- **Shapes & borders**: 0px border-radius on every element, no exceptions. Thick, bevelled borders -
  a light top-left edge and a dark bottom-right one - mimicking classic Windows 95 pop-up windows.
  Nothing fades, lifts or casts a soft shadow.
- **Colours**: nine, and not one grey. Black `#000000`, Nigrosine `#1A1525` (the field), Royal Blue
  `#1D3CA6`, Daffodil Yellow `#FFF000`, Flavine `#E1FF00`, Emerald `#28C745`, Brilliant Pink `#FF00A0`,
  Rose `#E6004C`, and Pure White `#FFFFFF` for the prose only. They live in the `@theme` block of
  `app/globals.css`; every fill and every ink resolves to one of them through `app/lib/ui/controls.ts`,
  and no component writes a hex of its own (`Temp/check-surreal.cjs` fails on one, on a grey, or on a
  pair that carries text below 4.5:1). The two tokens named `chrome`, `chrome-dark` are *not* greys any
  more - they are Flavine and Nigrosine - and they stay separate tokens because they do the opposite
  jobs an inactive title bar and a disabled plate need: one pale enough for Black ink, one dark enough
  for White. Collapsing them onto one value is the bug that put greys here to begin with.
- **Reactivity**: six animations (`wobble`, `bump`, `shake`, `flash`, `marquee`, `blip`), all of them
  `steps()` rather than eased so they move in whole pixel frames; plates invert on hover and flash
  magenta on press; prose links wear a 3px dotted pixel bar that changes colour on hover. All of it
  goes quiet under `prefers-reduced-motion`.
- **Themes**: `app/lib/ui/themes.ts` is the library - a theme is a name and a map of the tokens above to
  hexes, and nothing else. The default is recorded *as a theme* rather than as an absence, so it can
  be chosen again after trying another. Switching writes CSS custom properties onto `<html>`
  (`app/lib/ui/theme-slot.ts`), so no component knows themes exist. Every theme must define every token
  and every text pair must clear 4.5:1 *in every theme* - `Temp/check-themes.cjs` fails on a theme that
  is incomplete, that uses a grey, or that cannot be read. The `ink-plate` token exists for this: a
  theme may need the ink on a *plate* to differ from the ink on the *field* (the dark one does, because
  White on Daffodil is 1.19:1).
- **Reveals take their space in both states**: anything that appears on hover, focus or tap - a
  picture beside a name, the preview down the side of a post, a row's own detail - must occupy its box
  whether or not it is filled, so **the thing you are pointing at never moves and the surrounding
  content never reflows**. Two shapes are allowed: `position: absolute` (out of flow, so filling it
  cannot push anything - see `ProfileCommentWindow`'s thumbnail), or a box that is laid out in both
  states whose *contents* are what swaps (see `PostHoverPreview`, whose own comment is where this rule
  was first written down, and `ForumThreadCard`'s reserved right-hand column). What is never allowed is
  `hidden` becoming visible on hover inside a laid-out row: the reveal arrives and shoves its siblings
  sideways. `Temp/check-reveals.cjs` fails on one.
- **Artwork**: sprites, sheets, avatars and cursors are hand-drawn files, pointed at from a slot
  (`SpriteSlot`, `assets/sprites/README.txt`) - code never draws a character, an icon or an
  illustration, though repeating tile patterns, dithers and dotted rules are fine.
- **Typography**: heavily pixelated monospace fonts (e.g. Courier or MS Sans Serif equivalents).
- **Layout & backgrounds**: CSS repeating tile patterns. A sticky retro taskbar (footer) with a Start-menu layout holding looping avatar sprites.
- **Interactivity**: custom CSS cursors using retro pixel-art images on hover.

## Asset Rules (critical — do not violate)

- No AI-generated artwork of any kind.
- No CSS/SVG art — never draw characters, icons, or illustrations in code.
- All artwork is hand-drawn on a Kamvas tablet and added manually.
- When a component needs artwork, use a standard Next.js `<Image />` tag pointing at an empty placeholder path (e.g. `/public/assets/sprite-placeholder.png`) and stop — do not generate a substitute.

## Database Rules

Every table gets Row Level Security so users can only edit or delete their own comments and lore entries.

## Routing & Windows

The board (`/forum`) is the desktop. A few things follow from that, and they are rules rather than
preferences:

- **Neither the arcade nor the archive has a page.** `/games` and `/music` are not routes: `GamesHub`
  is the screen inside `app/components/ArcadeWindow.tsx` and `MusicDirectory` is the screen inside
  `app/components/MusicWindow.tsx`, both drawn once in `app/layout.tsx`. Do not add either route back.
- **A window opens from an address.** `app/lib/games/arcade-window.ts` and
  `app/lib/audio/music-window.ts` each build and read their own, so a link and the code that answers
  it cannot drift: `/forum?arcade=1` (the header key and Start menu row), `/forum?invite=<id>` (the
  bell), `/forum?challenge=<userId>&game=<gameId>` (a post's `[ CHALLENGE ]` plate), and
  `/forum?music=1` (`/forum?music=1&tag=…` for a filtered one - the MUSIC shelf, a post's plate, a
  track's tag badge). Closing a window spends its address, so the same link works twice.
- **Utility windows dock; dialogues take the screen.** `DockWindow` is for the two screens a reader
  consults while standing in a thread: no scrim, draggable by its title bar, docked to the side of the
  feed on a wide screen and a sheet above the player bar on a phone - **the feed must never be
  covered**. `PopoutWindow` stays for the things that are a decision (the composer, the pickers).
- **Windows are drawn after `{children}`, and none of them re-renders a page.** Each window's state is
  a module-level slot (`app/lib/ui/window-slot.ts`) read with `useSyncExternalStore` only by that
  window's own component, so opening, filtering or closing one cannot touch the board. A screen may
  import an `open*` function; it must never subscribe to a window's state.
- **Two presses from the board.** An action a reader starts on the board - asking somebody for a
  game, filing a track with a post - is two presses: one to open the thing, one to commit it. The
  composer's own entry and submit presses are separate and are the floor. `Temp/check-flows.cjs`
  holds both flows to this, so change the flows and that check is what tells you.
- **Verbs go where the account or the file is named.** `PostAuthorRow` and `UserDirectoryRow` both
  carry an `actions` slot for a screen's own verb (`[ CHALLENGE ]`, `[ MESSAGE ]`); a screen with a
  question to ask an account adds it there rather than writing the row again. A verb that reaches
  *out* of a window and onto the board wears `PLATE_ACCENT` (`[ INJECT TO POST ]`), so it is findable
  in a list of grey.

- **A page about a person shows a person.** No account ids, no counts of how much is filed, no row of
  switch states - those are the customiser's business and the store's, and reading them back at
  somebody turns a profile into a console. What a profile ends with is the last-online reading, in
  words that age on their own (`app/lib/ui/relative-time.ts`, `ProfileStatusBar`).

## Build Order

1. Static Web 1.0 UI frames + gallery placeholders
2. Supabase Auth protecting dynamic routes
3. Database schema: Users, Lore_Pages, Comments, Messages (with RLS)
4. Message board UGC forms wired to Supabase Realtime
5. Tiptap + Yjs collaborative lore editor (last — most complex)