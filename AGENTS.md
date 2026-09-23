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

- **Shapes & borders**: 0px border-radius on every element, no exceptions. Thick, grey, bevelled borders mimicking classic Windows 95 pop-up windows.
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

- **The arcade has no page.** `/games` is not a route: `GamesHub` is the screen inside
  `app/components/ArcadeWindow.tsx`, drawn once in `app/layout.tsx`, and it opens over whatever the
  reader was on. Do not add a `/games` route back.
- **A window opens from an address.** `app/lib/games/arcade-window.ts` both builds and reads the
  arcade's three addresses, so a link and the code that answers it cannot drift:
  `/forum?arcade=1` (the header key and Start menu row), `/forum?invite=<id>` (the bell),
  `/forum?challenge=<userId>&game=<gameId>` (a post's `[ CHALLENGE ]` plate).
- **Two presses from the board.** An action a reader starts on the board - asking somebody for a
  game, filing a track with a post - is two presses: one to open the thing, one to commit it. The
  composer's own entry and submit presses are separate and are the floor. `Temp/check-flows.cjs`
  holds both flows to this, so change the flows and that check is what tells you.
- **Verbs go where the account or the file is named.** `PostAuthorRow` and `UserDirectoryRow` both
  carry an `actions` slot for a screen's own verb (`[ CHALLENGE ]`, `[ MESSAGE ]`); a screen with a
  question to ask an account adds it there rather than writing the row again.

## Build Order

1. Static Web 1.0 UI frames + gallery placeholders
2. Supabase Auth protecting dynamic routes
3. Database schema: Users, Lore_Pages, Comments, Messages (with RLS)
4. Message board UGC forms wired to Supabase Realtime
5. Tiptap + Yjs collaborative lore editor (last — most complex)