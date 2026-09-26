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
- **A window holding unsaved work does not close on a stray click, and asks before it closes at all.**
  `PopoutWindow`'s `dismissOnBackdrop` defaults to `true` so every other window is unchanged, and the
  customiser is the one that opts out: it is a workbench, and a mis-aimed press near the edge of it is
  not a decision to discard. Both exits - closing and switching tabs - go through one `guard()`, so they
  cannot disagree, and the question is `UnsavedPrompt`, its own window rather than a panel, because the
  customiser's body scrolls and the choice must not arrive below the fold. What counts as unsaved is
  `app/lib/profile/unsaved-changes.ts`: a draft that *differs* from what is stored, so typing a
  character and deleting it again is not work. The character figure has no store yet, so it is reported
  as its own entry that says so out loud rather than being offered a save button that would do nothing.
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

## Working Rules

Two standing instructions from the archive's owner. They are not preferences - they are how work here
is done, and both are written down because both were got wrong once.

### Read and write the database directly

**The agent may read and write SQL against the live project, freely, without asking first.** It is a
standing grant; it does not need renewing per task. The instrument is built and works:

    npm run db -- "select count(*) from public.profiles;"           read
    npm run db -- --file supabase/cleanup/verify-live-schema.sql    read a whole file
    npm run db -- --json "select ..."                               machine-readable
    npm run db -- --write "drop table if exists public.x;"          a write
    npm run db -- --dry-run "select ..."                            print the command, run nothing

Why this is worth writing down: for most of this project's life the publishable (anon) key was the
only credential, and it **cannot run SQL at all** - it reads the tables RLS allows and calls the
functions the schema defines, and that is the whole of it. There is no SQL-over-HTTP door a
publishable key opens. Every `Temp/check-*.cjs` was therefore written as a *reader*: it can prove
what a visitor would see and none of them can ask the database *why*. That ceiling is gone. The
Supabase CLI is a devDependency, `supabase/config.toml` is committed, the migration history is
reconciled, and the token lives in `.env.local` as `SUPABASE_ACCESS_TOKEN`. `supabase/README.md`
holds the whole setup, including how the history was adopted.

**What the grant does not change:**

- **Writes still need `--write`.** `Temp/sql.cjs` refuses a statement that is not a read and prints
  it in full first, so the review is of the SQL rather than of the flag that was typed. Leave that
  guard alone: it is the difference between a typo and an outage.
- **Destructive work is reviewed before it runs.** `supabase/cleanup/` is the pattern:
  `throwaway-accounts-review.sql` (read-only, lists exactly what would go) and then
  `throwaway-accounts-sweep.sql`. Run the review, read the list, and confirm the survivors are the
  accounts that should survive - that is how 30 throwaway accounts went without touching the 7 real
  ones. Never sweep on an assumption about what a `like` pattern matches.
- **Schema changes go through the migration chain, never ad-hoc DDL.** `npm run db:new -- name`,
  write the SQL with `if not exists` / `drop policy if exists`, `npm run db:push:dry`, then
  `npm run db:push`. This repository's timestamps carry *section numbers*, so `--include-all` is
  required and is already on both push scripts.
- **The token and the database password never leave `.env.local`** (gitignored).
  `.env.production` is committed and its values reach browsers, so it holds `NEXT_PUBLIC_*` only.
- **The house rules apply to SQL too**: every table gets Row Level Security, and a statement is
  written to be re-run (`if not exists`, policies dropped and recreated by name).

### Ship it, then say what was actually verified

**A change is not finished when it compiles. It is finished when it is live and the agent has said
plainly what it checked and what it could not.** The owner cannot see a local build, and neither can
the agent - so the loop is: change, verify, push, confirm it is deployed, report honestly.

1. `npm run verify` - lint, typecheck and build. **Never push a red build.**
2. `npm run checks` - the scratch checks. All must pass. A failing check is a *finding*,
   not an obstacle: update the check deliberately (never delete it) when the rule it holds genuinely
   changed, and say why. `Temp/check-music-library.cjs` and `Temp/check-surreal.cjs` are recent
   examples, and both were proven to fail before being trusted.
3. `node Temp/qa-audit.cjs` - reads the HTML a visitor's browser gets before any JavaScript runs
   (which is also what a screen reader and a crawler see) and reports unnamed fields, controls too
   small for a thumb, text too small to read, and colour pairs below the contrast floor.
   **Capture first: `npm run capture`.** The audit reads snapshots from `Temp/qa/`,
   not the current build, so without a fresh capture it happily reports on yesterday's HTML and the
   pass means nothing - which is exactly what happened on 2026-09-25, when the captures were two days
   older than the components. The two scripts share one route list (`ROUTES` in `qa-audit.cjs`), so
   they cannot disagree about what is being audited.
4. **Commit and push to `main`.** Vercel builds from `github.com/SpookySweden/debaser.site`, and that
   is what puts the change where the owner can look at it. Only ever after 1 and 2 are green.
5. **Read the site and confirm the change is in the served HTML.** `npm run read` does this
   against `https://debaser-site.vercel.app/forum`, and `npm run read:local` does it against a local
   `next start`; `npm run read -- --url <address>` reads any route, and `--absent` asserts something
   is gone. Use it rather than a hand-written grep, for a reason worth knowing: **React wraps dynamic
   text in HTML comments.** The player's music key is served as
   `[ <!-- -->♪<!-- --> <!-- -->MUSIC<!-- --> ]`, so a plain search for `[ ♪ MUSIC ]` finds nothing
   and reports a present change as missing - which happened twice here, and each time looked like a
   stale build rather than a wrong grep. The script strips the comments first.
   This is also the step that catches "uncommitted work is not deployed": on 2026-09-25 the player's
   `[ ♪ MUSIC ]` was reported done while the live site still served `[ SHELF (60) ]`.
   **The tool is tracked in `scripts/`, not `Temp/`** - a viewer a fresh clone does not have is not a
   guarantee, and these were scratch files for most of the project's life.
6. **Report the limits out loud.** Not as a disclaimer but as part of the answer.

**What the agent can and cannot do. State it every time; never imply more:**

| can | cannot |
| --- | --- |
| read the served HTML of any page, local or deployed | **see pixels** - no screenshots, no layout, no colour, no fonts, no cursor art |
| read and write SQL, and query the live database directly | **click, hover, press or drag anything** - no way to exercise an interaction |
| run the check suite, lint, typecheck and build | **judge the aesthetic** - whether it reads as Web 1.0, or feels like ENA |
| grep the deployed HTML for a control's text | **tell a placeholder from a result** - `READING...` / `[ SYNCING... ]` are pre-hydration states, so a prerendered `0` is not proof that a list is empty |

So the sentence is *"the served HTML contains X, and the checks pass"* - never *"it looks right"*.
When something genuinely needs eyes, ask a **specific** question ("is the picture beside the name
the right size?") rather than a general one ("does it look ok?"), because the second is not
answerable by anybody.

### Why these rules exist, in the order they were learned

`.clinerules` carries the short version of these as triggers. This is the reasoning, kept here so
the two files cannot drift: `.clinerules` says *what to do*, this says *what went wrong*.

**A check that reads source cannot tell a used value from a decorative one.** `SIDE_MUSIC.href` was
set to `LIBRARY_HREF` from the day the personal music screen existed, and `check-music-library.cjs`
asserted exactly that - so the check passed for weeks while the side panel's MUSIC key opened the
*archive*, because the key is a `<button>` calling `toggleMusic()` and never read its own href. The
declaration and the behaviour were two statements and only the declaration was tested. The fix was
to derive one from the other (`musicScreenForHref(SIDE_MUSIC.href)`); the lesson is to make the
check drive the real module and assert what it *does*.

**Prove a test fails before trusting it.** After adding the behavioural assertions above, the
implementation was reverted to its old shape and the check watched. It reported:

    the panel's MUSIC key opens "archive" - it must open MY MUSIC, the screen its own href names

and then the fix was restored and the file byte-compared. Both `check-music-library.cjs` and
`check-surreal.cjs` were treated this way. A check that has never failed is one whose failure mode
is unknown.

**A missing grep is not an absent feature.** `scripts/read-site.cjs` exists because searching the
served HTML for `[ ♪ MUSIC ]` finds nothing: React wraps the text in comments, so it is really
`[ <!-- -->♪<!-- --> <!-- -->MUSIC<!-- --> ]`. This misled twice - both times it looked like a stale
deploy rather than a wrong pattern. Strip comments before matching.

**Derived data goes stale silently, and a stale pass is worse than no pass.** `Temp/qa/*.html` was
written by hand and had gone two days older than the components, so `qa-audit` reported on a build
nobody was shipping. `npm run capture` now produces them from a `next start` it starts itself,
and both scripts share one `ROUTES` list so they cannot disagree about what is being audited. The
same class of trap: `/music` sat in that list long after the archive stopped being a route, so every
capture 404'd and the audit read a leftover file - **the music screen had never once been audited**.
The same shape again in SQL, where `db push` needed `--include-all` because the timestamps carry
section numbers, and the history needed `migration repair` because the schema had been built by
pasting into the editor.

**And the same shape once more, in the check runner itself - which is why it now reads a whole
header.** `run-checks.cjs` collected a check's `npx tsc ...` lines with `slice(0, 20)`. A check whose
header grew to 25 lines therefore had **its compiles silently skipped**, and was handed whatever the
*previous* check had left in a scratch output directory - so it passed against stale compiled code, and
when it failed it failed for a reason that had nothing to do with the source. That cost three separate
turns of misdiagnosis, each time written off as "a stale build" when it was the harness. A check that
fails for reasons unrelated to the code is worse than no check, because it teaches you to distrust the
suite. The fix is in `scripts/run-checks.cjs` (tracked, so a clone gets it), the runner reads to the
closing `*/`, and the check's own header keeps its steps in the first lines anyway as a belt.

**`--include-all`, and why the push scripts carry it.** The CLI refuses to apply a migration older
than the newest one on the remote, assuming a new migration is always the newest. This repository
breaks that assumption on purpose: the timestamps are *section numbers* so the order `db push`
applies matches the order of the sections in `supabase/schema.sql`. Every migration created from now
on is therefore older than `20260930000027` by the clock, and without the flag `db push` answers
*"Found local migration files to be inserted before the last migration on remote database"* and
applies nothing. The flag is on `db:push` **and** `db:push:dry`, so the preview and the act agree.

**A check's header is a contract with the runner, and spelling it differently runs nothing.** The
runner collects a check's compile steps by looking for the literal prefix `npx tsc ` inside its
header comment. A check that wrote the same command as `npm exec tsc ...` had **its compiles silently
skipped** - it was then handed whatever the previous check had left in a shared output directory, and
failed on a missing module, which reads as a broken check rather than a wrong header. That is the
`slice(0, 20)` defect wearing a new costume, so the guard went in the runner: a header line that names
a compiler and carries `--outDir` without starting with `npx tsc ` is now an error rather than a
silence. The step also has to be *inside* the `/** */` block - a `//` line below it is not read at all.

**Run a check through the runner, never directly, when its header compiles anything.** Reverting the
fix under test and re-running the check by hand reported a **pass against stale compiled code**, twice
- because the compiled output in `Temp/` was from before the revert. The revert only becomes visible
once the runner recompiles. `Temp/revert.cjs` exists for this: it edits, runs the whole suite through
the runner, prints whether the check caught it, and restores in a `finally`.

**A summary must print last.** `check-character.cjs` printed its "passed" line *between* two sections,
and `run-checks.cjs` reports only the first line of stdout - so a run that failed on a later assertion
was shown as `FAIL` beside the word "passed". Two turns went into reading that as a harness fault. The
summary now sits at the end of the file, and the reason is written above it.

**Assert a shape, not a remembered identifier.** A Phase 1 assertion matched
`aria-pressed={active === layer.id}`; Phase 2 renamed the local to `activeLayer` while moving the state
into the store, and the check failed on correct code. The rule had not changed, the variable had. The
match is now `aria-pressed={\w+ === layer\.id}`, and the rename is not a test failure any more.

**Review before a destructive pattern, and never on an assumption.** 35 accounts were listed before
any were removed, which is how the `cline-%` sweep was confirmed to leave exactly the 7 real ones.
"The pattern looks right" is not the same as "I read the list", and the second is the one that
counts.

**Node 24 on Windows will not spawn a `.cmd` shim.** `execFileSync('npx.cmd', ...)` fails with
`EINVAL`, and the `shell: true` workaround joins arguments unescaped (`DEP0190`, which Node itself
warns about). Both `Temp/sql.cjs` and `Temp/db-cli.cjs` therefore run the CLI as
`node node_modules/supabase/dist/supabase.js` - no shim, no shell, and the version pinned in
`package.json` rather than whatever `npx` resolves.

**Ask less; the repository already answers most of it.** `.clinerules` says to exhaust the codebase
and the docs before asking, to assume and continue on a non-fatal detail, and to halt only for a
destructive or irreversible choice or after two failed self-corrections. The distinction that needs
care is what counts as destructive, because this project deletes live rows on purpose:

    a destructive change whose blast radius is UNKNOWN   -> stop and ask
    a destructive change that has been READ and BOUNDED  -> proceed

The second is the `supabase/cleanup/` pattern: run `*-review.sql`, read the list, confirm the
survivors, then run `*-sweep.sql`. That is how 30 throwaway accounts were removed without touching
the 7 real ones, and it did not need a halt - the halt would have added nothing except a turn, since
the list had already been read. What *would* need one: dropping a table, deleting a tracked file,
force-pushing, or rewriting history - anything whose effect cannot be seen first or undone after.

## Build Order

1. Static Web 1.0 UI frames + gallery placeholders
2. Supabase Auth protecting dynamic routes
3. Database schema: Users, Lore_Pages, Comments, Messages (with RLS)
4. Message board UGC forms wired to Supabase Realtime
5. Tiptap + Yjs collaborative lore editor (last — most complex)

## There IS a browser, and the old claim was wrong

An earlier version of this file said "There is no browser here. `npm run read` is the eyes." The second half is
true; **the first half was false**, and believing it cost a whole session's worth of verification. The evidence
was Puppeteer's `launch_browser` failing with *"Could not find expected browser (chrome) locally"* - which says
**Puppeteer's download cache is empty**, not that the machine has no browser. Chrome 153 is installed at
`C:\Program Files\Google\Chrome\Application\chrome.exe`, and it needs no Puppeteer, no download and no dependency:

    chrome.exe --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --screenshot=out.png <url>
    chrome.exe --headless=new --remote-debugging-port=9334 about:blank      # then drive it over CDP

`--use-angle=swiftshader` is the load-bearing flag: without the software GL a headless build has **no WebGL**, and
a blank canvas would say nothing about the code under test.

### What that unlocked

`CharacterEditorPanel` is `ssr: false`, so every server-rendered check in this repository sees the literal string
`LOADING THE WORKBENCH...` and can say nothing about the canvas. The figure was unobservable **by construction**,
not merely unobserved - and three faults were hiding there, each behind the one before, with **every check green
for all three**:

1. `frameloop="demand"` never drew a frame, because nothing in the scene called `invalidate()`. Worse:
   `Temp/check-character-render.cjs` **asserted `demand`**, describing it as "not 60fps of a still life" - so a
   green check held the defect in place. A check on the wrong value is worse than no check, because it is
   evidence *for* the bug.
2. `EffectComposer` cleared the frame before `Outline`'s own pass, wiping the image it had just produced.
   Three.js warned about it at runtime - *"Outline requires `<EffectComposer autoClear={false}>` to render
   correctly"* - and a `console.warn` is invisible to anything that reads source.
3. `MODEL_INK` was `#FFFFFF`, which under a lambert light renders as `rgb(226,226,226)` - a grey, in a palette
   that forbids greys. The figure had no colour of its own; it was a white mass pretending to be one.

### The instruments, tracked in `Temp/`

    Temp/cdp-look.cjs         drive Chrome over CDP; read the drawing buffer and the DOM
    Temp/measure-panes.cjs    decode the screenshot's PNG by hand; count colours per pane
    Temp/check-deployed.cjs   load the deployed site; read response BODIES, never hashed filenames
    Temp/png-read.cjs         the PNG decoder, no dependency added for a diagnostic

**Read pixels inside a `requestAnimationFrame`.** A WebGL drawing buffer is cleared when it is presented unless
the context was made with `preserveDrawingBuffer`, so `readPixels` from outside a frame legitimately returns all
zeros on a perfectly drawn figure. The first run reported `0/72072` and that number alone did not distinguish
"nothing was drawn" from "the probe looked at the wrong moment". `--force-frames` and `--stages` are kept for the
same reason: one experiment per suspect, because two faults mask each other.

### Two limits to state plainly, both learned here

- **A `<canvas>` in the DOM is not a drawn figure, and pixels on the canvas are not a person.** The honest
  sentence is "72072/72072 pixels drawn in-frame, three colours, none of them grey" - never "it looks right".
  `Temp/measure-stages.cjs` is what produces a per-stage reading; the numbers it gave on 2026-09-26 were:

      MASS    2 colours    rgb(96,204,89) - the green wireframe alone, no surface at all
      BASE    3 colours    Violet trunk + darker Violet limbs, flat and unlit
      PIXEL   229 colours  the composer: outline, pixelation, shading - an order of magnitude more tones

  Those three lines are the evidence that the stages are genuinely different, and `Temp/check-character-stages.cjs`
  holds the source property they rest on: MASS is the only wireframe, BASE and PIXEL are not the same material,
  and PIXEL alone is lit. **The failure to watch for is not a deleted stage but two stages quietly becoming the
  same material** - and that is exactly what a first reading *looked* like, because the probe was clicking the
  edit row `MASS GEOMETRY` instead of the stage button `MASS`. Two different requests giving byte-identical
  readings is the tell; a real render differs at least slightly.
- **Absence from a bundle grep is not absence from the site.** The workbench is `next/dynamic`, so its chunk is
  fetched by the client only once the CHAR tab is pressed behind a session. The deployed HTML names 300 `.js`
  references but only **12 distinct** chunks, none of them the workbench - so three separate bundle greps reported
  three live fixes as missing. A false absence is worse than no check, because it is indistinguishable from a
  true one. What *does* prove the deploy is current: `npm run read -- --absent <old text>`.

### And a `Temp/*.tsx` used to be part of the project

`tsconfig.json` included `**/*.tsx`, which reaches into the gitignored scratch tree. `next build` therefore tried
to compile a probe page written into `Temp/`, and Turbopack panicked on a Chrome profile directory a headless run
had left behind - a build failure caused by a browser profile. `Temp` is now excluded.

---
