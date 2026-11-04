# SPEC: Efficiency pass ("say it once, say it short")

Interviewed 2026-10-23. Build this in a fresh session. Read `HANDOFF.md`, `docs/design.md`, `docs/theming.md`
and `.claude/rules/frontend.md` first.

## Goal
A much more readable font, buttons that sit in the text instead of standing out as boxes, and every
window cut down to what helps someone read, decide or act. Keep the fun: coloured names and text, the
news crawl, the scrolling reply reel, profile pictures, the presence lamps, RADI-OH's faces, title lines
(`——— NEWSWIRE ———`), the press flash.

## Why (what the live site shows today, `Temp/browse/eff/*.png`)
- DotGothic16 at 13-15px is soft and dotted; capitals smear (`forum-desktop.png`).
- On a phone the first post is not on the first screen: the window title, the page heading, the
  newswire and its how-to line, the board title, a stats line, the tag filter and its how-to line, the
  board controls and a SHOWING line all come first (`forum-in-phone.png`).
- A guest sees three different "create an account or log in" calls at once (top banner, board heading,
  side panel), plus a Google key.
- Every key is a box *and* has `[ ]` brackets inside it: two frames for one button.
- Sections are boxes inside boxes inside the window (four outlines deep on a phone).
- Paragraphs that explain the UI sit permanently on screen (Preferences, the people list's THE LAMP,
  the lore page, the music window's foot line).

## Decisions (Luke, 2026-10-23)
1. **Font: IBM Plex Mono, for everything** (titles too), from `next/font/google`, replacing DotGothic16
   in `app/theme/fonts.ts` (the one import line; `--face-pixel` keeps its name or is renamed, builder's
   call). Load **weight 400 only**: `font-synthesis: none` stays, so the ~450 inert `font-bold`s stay
   inert (docs/theming.md "font-bold trap"). Emphasis stays colour or size. The fallbacks in
   `tokens.css` change to monospace faces a machine has (`'Courier New', monospace`).
   - Picked from `Temp/browse/eff/font-options.png` (option C) over Atkinson Hyperlegible Mono and Space Mono.
2. **Bracket keys, no box.** A key is its label in brackets, `[ LOG IN ]`, in the accent ink, with no
   outline. Under the pointer it fills (accent fill, plate ink), instantly. The press keeps its 1px drop
   and Brilliant Pink flash. Disabled keys go quiet (field ink at reduced contrast is NOT allowed below
   4.5:1: use the quiet ink and no hover). The `[ ]` already written into ~312 labels stay as they are.
   - Stays filled (a pill, no brackets needed): the one main action (`PLATE_MAIN`, Daffodil), a key that
     is on (`PLATE_PRESSED`, tabs and switches), the one pink `PLATE_ACCENT` (inject to post).
   - Keys whose label has no brackets today get them in the text (a list per window below), except glyph
     keys in a row of glyphs (the nav glyphs ⌂ ≡ ☻ ✉ ⚿, transport ◀ ↻ ▶), which stay bare glyphs with the
     fill on hover.
   - Phones keep the 44px tap height (`min-h-tap`): invisible padding, not a visible box.
   - Fields (`FIELD`, `FIELD_TIGHT`) keep their frame: a box is what says "type here".
   - After this, accent-ink brackets mean "press me". A bracketed readout that is not a key (`[ 3 ]`,
     `[ A ]`, `[ LIVE ]`) is either cut (most are, below) or loses its brackets and stays in the field ink.
   - Check the accent ink on every fill a key sits on, both themes (`npm run contrast`, `/specimen`).
3. **Explanations move into hover tips.** Every always-on sentence that explains how to use something
   becomes the `title` of the thing it explains (or of the section's title line), and leaves the screen.
   Errors, refusals and empty states stay on screen. Phones will not see the tips; that is accepted.
4. **Flatten.** Only windows (and fields) keep an outline. A section inside a window loses its frame and
   is separated by its title line alone. Dotted row separators inside lists stay.

## Defaults set while planning (tell Luke if any change)
- Labels stay in capitals: the site's voice. Prose stays as typed.
- Shortened labels keep the brackets and the meaning: `[ CREATE AN ACCOUNT OR LOG IN ]` -> `[ LOG IN ]`
  (the account page offers both), `[ X CLOSE ]` -> `[ × ]`, `+ NEW POST...` -> `+ NEW POST`.
- One sign-in call per screen for a guest: the top banner's key. The side panel keeps the Google key.
- Out of scope: the character workbench canvas, game boards' play areas, RADI-OH faces (`--font-emote`),
  colours, artwork, database changes, the lore editor's toolbar.
- Contrast stays 4.5:1 or better in both themes; motion still stops under `prefers-reduced-motion`.

## Watch out: IBM Plex Mono is about 20% wider than DotGothic16
At the same size each letter is 0.6em wide against 0.5em (measured in the mock: a 780px line holds 83
characters instead of 103). Keep the type sizes (13/14/15/16), but land the space savings (boxless keys,
flattening, the cuts) **before** the font, or the tight spots wrap: the player bar, the side panel, title
lines with extras, the taskbar, the music window's toolbar, the account directory rows.

## The cut list, window by window
From a read-only inventory of every component (2026-10-23). **tip** = leaves the screen, becomes the
hover tip of what it explains. **cut** = removed. **short** = shorter label, same job. Files are under
`app/components/` unless a path is given; find each string with a search, line numbers drift.

### Kept on purpose (do not cut)
Coloured names and text, the news crawl (`NewsCrawl`), the reply reel (`PostReplyReel`), profile pictures
everywhere, presence lamps and their "3w / 2d" ages, the guest banner's scrolling `ERROR: UNREGISTERED
ENTITY` joke (`GuestPrompt`), the window title `DEBASER_OS - v1.0 [ ... ]` (the OS joke), title lines,
RADI-OH's faces, `[ INJECT ]`'s pink, the press flash, errors and empty states, `IN THE ROOM` on lore pages.

### Everywhere (the shell)
- The page's big heading `DEBASER.SITE // X`: cut from view, kept for screen readers (`sr-only`); the
  window title already names the page. Every page's intro paragraph under it: tip on the window title.
- Taskbar `Status: ... :: UTF-8` (`Taskbar`, `SiteWindow` status props on every page): cut. `[ START ]` stays.
- Docked and pop-up windows (`DockWindow`, `PopoutWindow`): the foot's how-to line (`DRAG THE TITLE BAR
  TO MOVE IT`, `ESC OR CLICK THE DESKTOP TO CLOSE`, `GROUPED :: SHAKE...`) becomes the title line's tip;
  the foot's `[ CLOSE ]` is cut (the `×` in the title stays); the foot row goes when nothing is left in
  it. The `⇲` detach key is drawn only while grouped, not always-disabled.
- Badges that repeat a window's title: cut (`[ MP3 ]`, `[ ARCADE ]`, `[ QUEUE ]`, `[ SETTINGS ]`,
  `[ ACCOUNT ]`, `[ FILE ]`, `[ THREAD ]`, `[ TAG INDEX ]`).
- Guests get **one** sign-in call per screen: the top banner, its key shortened to `[ LOG IN ]`. Cut the
  board's `Guests post as Anonymous...` line (`GuestOffer`), the side panel's sentence and its `[ LOG IN
  OR CREATE AN ACCOUNT ]` (the Google key stays). In other windows a locked action says one short line,
  `[ LOG IN ] TO <DO THE THING>`, instead of a paragraph (`MusicDirectory`, `PersonalLibrary`,
  `QueueBrowser`, `GamesHub`, `CommsConsole`, `UserDirectory`, `LoreDirectory`, `LorePageView`,
  `SidebarComms`, `ProfileControl`). `/account` says "an account just signs your posts" once, not twice.
- One filled main key per screen, as docs/design.md already says: `+ NEW POST` on the board. The reply
  boxes inside open posts (`CommentComposer`) and `[ FILE COMMENT ]` (`CommentNodeCard`) become bracket keys.
- Hand-written key class strings that skip `controls.ts` (`ForumBoard` paging keys, `SidebarProfile`
  SMALL, `DesktopSidebar` RAIL_BUTTON, `SidebarComms`, `NotificationBell`, `MusicDirectory` ROW_BUTTON,
  the `GuestPrompt` key) move onto the shared constants so the bracket-key look reaches them.

### Board (`/forum`: `ForumBoard`, `NewsTicker`, `PostRowDetails`, `ForumThreadCard`, `CommentComposer`, `NewPostForm`)
- `FORUM BOARD // ANONYMOUS POSTING ENABLED`: cut (the window is the board). `+ NEW POST...` -> short `+ NEW POST`.
- `[ SYNCED ]`: cut. Show `SYNCING...` only while it is, and the error if it fails.
- `POSTS: n :: REPLIES: n :: FILED HERE: n` and `POSTING AS: name`: cut.
- One controls row: `FEED | GALLERY` tabs, `[ TAGS ▾ ]` (replaces `TAG FILTER (n INCLUDED) :: MOST USED
  FIRST`, `[ ALL TAGS... ]` and `[ + TAGS ]`; picked tags show as chips after it), `[ SORT / SEARCH ▾ ]`
  (replaces `[ BOARD CONTROLS ] SORT :: SOURCE :: SEARCH :: PAGING`; posts-per-page moves in here), then
  `+ NEW POST` at the right. `PICK TAGS WITH [+ TAGS]...`: tip on `[ TAGS ▾ ]`.
- `SHOWING 1-5 OF 7 MATCHING (7 TOTAL)` and the paging bar's own SHOWING line, `PAGE:` select and
  numbered keys: one readout at the foot, `[ < ] 1-5 OF 7 [ > ]` (numbered keys only past 5 pages).
- Newswire: `[ n PINNED ]` cut; `POINT AT IT TO STOP THE CRAWL :: CLICK A ROW TO OPEN THE POST` tip on
  the crawl. With nothing pinned, the newswire is not drawn at all (no panel of "NOTHING PINNED YET").
- Each row: `[ EXPAND ]` cut (`[+]` does it); the `LATEST REPLIES` heading cut (the reel stays).
- An open post: `FILED UNDER ...`, `ORIGIN: USER/SEED`, `BOARD ID: ...`, `n REPLIES ON THIS POST`: cut.
- Composer: `[ + TAGS / PICTURE / MP3 / @NAME ]` short `[ + ATTACH ]`; `AUTHOR: name` cut; the character
  count shows only in the last 10% before the limit. Reply keys `[ COMMENT ]` short `[ REPLY ]`,
  `[ SHOW n REPLIES ]` short `[ n REPLIES ▾ ]`.
- New post (`NewPostForm`): title `COMPOSER :: NEW POST` + `[ FILE ]` short `NEW POST`; the `FILING INTO:`
  readback cut; `SHOWS UP UNDER THAT ITEM...` tip.

### Side panel (`DesktopSidebar`, `SidebarProfile`, `SidebarComms`, `UserDirectory`)
- `SIDE PANEL` title: cut (the collapse key stays). PROFILE's `[ SIGNED IN ]` / `[ GUEST ]` and `NO
  STATUS SET`: cut. SHELF's `[ 3 ]` and each launcher's `[ ▸ ]` / `[ ON ]`: cut (the filled pill says on).
- The shelf is the one launcher for ARCADE, MUSIC and QUEUES on desktop (see the player bar).
- COMMS: `[ n OPEN ]` cut, `n NEW` kept. `[ OPEN THE CONSOLE ]` short `[ OPEN ]`.
- ACCOUNT DIRECTORY: `[ 9 :: ALL ]` short `[ ALL ]`; the `[ A ]` / `[ X ]` badges get tips saying what they mean.

### Player bar (`MusicPlayer`, `TrackDetails`)
- `♪ DEBASER PLAYER` short `♪ PLAYER`. Caption `UPLOADED :: UPLOADED TO THE SHELF :: sweden :: LOOPING
  THIS ONE` short to the uploader's name (`↻` already shows looping). The `VOL` number: cut (the slider shows it).
- `[ ♪ MUSIC ]` and `[ ⟳ QUEUES ]` on the desktop bar: cut (the side panel's shelf has them; this is the
  tightest strip on the site and the new font is wider). The phone card keeps its links, as bracket keys.
- Phone card: the elapsed/total time under the slider (already in the readout): cut. `[ LOOP ON ]` /
  `[ LOOP OFF ]` short `[ ↻ ]` drawn on or off.

### Music (`MusicWindow`, `MusicDirectory`, `PersonalLibrary`)
- Title `MUSIC :: THE ARCHIVE` + `[ MP3 ]` + tab `THE ARCHIVE` + `DEBASER NETLABEL :: FILE DIRECTORY`:
  title `MUSIC`, tabs `ARCHIVE | MY MUSIC`, the inner title cut. `[ n FOLDERS :: n FILES ]`: cut.
- The foot's `[ INJECT TO POST ] FILES A TRACK...` line: tip on the inject keys.
- `[ INJECT TO POST ]` on every row short `[ INJECT ]` (stays the pink pill).
- `[ NEW FILE ]` / `[ NEW FOLDER ]` hidden for guests (not shown disabled). `[ CLEAR ]` only while
  filtering. `[ REFRESH ]` short `[ ↻ ]`. The column header row stays (it is a table).
- My music: the list count shown twice (row and next panel title): once.

### Queues (`QueueWindow`, `QueueBrowser`, `RadioLoops`)
- Title `PLAYLISTS` + `[ QUEUE ]` + tab `QUEUES` + `QUEUES // WHO IS LISTENING`: title `QUEUES`, the rest cut.
- The `MIXTAPES` tab (`NOT BUILT YET` placeholder): cut until it is built.
- Foot `LISTEN ALONG :: FOLLOWING SOMEBODY...`: tip. RADI-OH's `EVERYTHING YOU HAD ON, NEWEST FIRST...`
  paragraph and `[ n ]`: tip / cut. The faces stay.
- `[ PUBLIC ]` / `[ GO PUBLIC ]` stays; the sentence restating it is cut.

### Arcade (`ArcadeWindow`, `GamesHub`, `GameMatch`)
- Title `ARCADE :: THE FLOOR` + `[ ARCADE ]` + panel `ARCADE n GAMES`: title `ARCADE`.
- Foot `THE BOARD IS STILL BEHIND THIS...`: tip. Each card's `{players} :: {controls}`: tip on the card
  (a match keeps its controls line while playing). The challenge panel's `ASK X FOR A GAME...`: tip.
- `{game} SELECTED` + `LIVE ARCADE` / `LOCAL ARCADE`: cut.
- The second set of game-picking plates (`PLAYING:` / `INVITE THEM TO:`): cut **only if** each card's
  own keys cover every path (solo, invite, challenge from /users); otherwise keep and say why.

### Comms (`/comms`: `CommsConsole`, `CommsThreadPanel`)
- Page intro: tip. `CONVERSATIONS [ n ]` short `CONVERSATIONS`. Thread `TO: name` + `n MESSAGES`: cut.
- `MESSAGE TO name:` label: cut (the field's placeholder says it). The `n / MAX` counter: last 10% only.
- `ENTER SENDS :: SHIFT+ENTER STARTS A NEW LINE`: tip on the field. The no-conversation prompt that
  mentions "the notification window": short, plain.
- Guest panel (three lines): one line, `[ LOG IN ] TO MESSAGE PEOPLE`.

### Profile (`PublicProfileWindow`, `ProfileTrackPanel`, `ProfileTagList`, `ProfileBoardActivity`, `ProfileCommentMenu`)
A profile shows a person, not a console (`.claude/rules/frontend.md`):
- `WHAT THIS ACCOUNT CHOSE TO SHOW.` and `PUBLIC PROFILE :: name` + `[ VISITOR VIEW ]` / `[ YOUR PROFILE ]`: the name only.
- Cut: `[ P2 ] (CURRENT)`, `M1`, `(current)`, `n of 3 open to comments`, `BIOGRAPHY [ n CHARS ]`, `TAGS
  :: n SHOWING`, `[ n THREADS ]`, `[ n VISIBLE ]`, the second `general` heading.
- Empty rows are not drawn: `COUNTRY: NOT GIVEN`, `NO BIO YET`, `NO PICTURE FILED`.
- `PLAYS THROUGH THE BAR AT THE FOOT OF THE PAGE`: tip. `COMMENTS ON THIS PROFILE`: short `COMMENTS`.

### Account (`/account`: `AccountConsole`, `AccountForms`, `AccountDetails`, `AccountProfilePanel`, `AccountSecurityPanel`, customiser)
- `ACCOUNT TERMINAL [ SIGNED IN ]` + `SIGNED IN AS: name`: one line, `SIGNED IN AS name`.
- `WHAT LIVES UNDER THIS TAB` (a contents list of the four sections right below it): cut.
- Badges that repeat titles or say nothing: cut (`[ SIGN UP ]`, `[ SESSION ]`, `[ READY ]`, `[ READ ONLY
  ]`, `[ EDIT ]`, `[ CAREFUL ]`, `[ n POSTS ]`). `OR SIGN IN WITH THE ACCOUNT'S OWN DETAILS:` short `OR`.
- The profile panel's readback (bio length, picture versions, tags, comments, `SHOW TO VISITORS: ...`):
  cut. `[ CUSTOMISE PUBLIC PROFILE ]` short `[ EDIT PROFILE ]`, `[ VIEW PUBLIC PROFILE ]` short `[ VIEW PROFILE ]`.
- `NEED TO CHANGE THE NAME, EMAIL OR PASSWORD? USE THE EDIT ACCOUNT SECTION BELOW.`: cut (it is also
  wrong: the section is above). `EDIT ACCOUNT`'s paragraph: tip.
- Customiser (`ProfileCustomiserWindow` and tabs): the paragraph with the raw account id: cut. Tabs
  `[ PICTURE, BIO & TAGS ]` short `[ PROFILE ]`. The always-on footer (`STATUS: NOTHING SAVED...` +
  visibility readback): cut; a save says `SAVED` for a moment. `PICK A TAB :: EVERY SAVE...`: tip.
  `[ VIEW PUBLIC PAGE ]` short `[ VIEW PROFILE ]`. `HOW IT WORKS` + paragraphs and the three Identity
  explainers: tips. `HISTORY (n VERSIONS) :: APPEND ONLY` short `HISTORY`. `[ SAVE NAME, COLOUR AND BIO ]`
  short `[ SAVE ]`. Tags tab: say the global switch once. Stale copy goes with the cuts ("IN THE TAGS
  TAB", "BIO: SHOWN AT THE TOP").

### Preferences (`PreferencesWindow`)
- `[ SETTINGS ]` badge and foot `CHANGES APPLY AT ONCE :: DRAG...`: cut / tip.
- THEME `[ 2 ]` and its paragraph: cut / tip. Each theme row: name + swatch, its note a tip. `[ ON ]` /
  `[ ]`: cut (the filled pill says it). `ON THE THEME NOW: ...` and `[ BACK TO THE DEFAULT ]`: cut.
- WINDOWS `[ THIS SCREEN SHAPE ]` + paragraph: tip on `[ RESET LAYOUT ]`.
- SESSION `[ SOON ]` placeholder section: cut.

### Lore (`/lore`, `LoreDirectory`, `LorePageView`, `LoreEditor`)
- Page intro and `A PAGE IS WRITTEN, NOT DRAWN...`: tip / cut. `LORE PAGES [ n FILED ]` short `PAGES`.
- `[ READ THE SHELF AGAIN ]` short `[ ↻ ]` with a tip. The sentence beside the keys: tip.
- `NO SUMMARY FILED.`: not drawn. A page: `A PAGE IS ITS OWN ADDRESS: ...`, `[ n WORDS ]`, `[ READING
  ONLY ]`: cut; the footer sentence: tip. Editor: `n EDITORS` cut (IN THE ROOM lists them).

### Users (`/users`, `UserDirectory`, `UserDirectoryRow`)
- Intro and the `THE LAMP [ LEGEND ]` panel (and its row of nav links): tip on the lamp.
- `n ONLINE :: n SEEN THIS HOUR :: n ELSEWHERE :: THE HOUSE ACCOUNT FIRST`: short `n ONLINE`.
- Each row: `OFFLINE :: 2026-09-21 10:47` short to the lamp + age (`3w`), as the side panel does;
  `JOINED <date>`: cut from the list (the profile has it).

### Projects, notes, links, concepts
- Intros: tip. Raw paths and ids on screen: cut (`OPEN /concepts`, `ARCHIVE FILE: ...`, `NOTE ID ...`,
  hrefs beside link labels). `n PROJECT FILED :: n SHELF...` and `THE PROJECTS [ 1 ]`: cut.
- `AROUND THE ARCHIVE` (repeats the nav) on /projects/debaser: cut. `ProjectSectionNav`'s `[ HOME ]`
  (goes to `/`, while the main nav's HOME goes to `/projects`): cut.
- /concepts: `CLICK THE [ COMMENT ] CONTROL...`: tip. `SHEET INDEX` stays as a jump list, without file
  paths or its second `[ COMMENT ]` per sheet. `CAPTION:` prefix: cut (the caption stays).

### Noticed, not in this task (tell Luke, do not remove)
- Dead code: `MusicPlayer`'s `ShelfWindow` (never opened) and `ProfileControl`'s `ProfileLogIn` (unused).
- `projects/debaser` has no LORE count (`SECTION_COUNTS`), so its tile reads `[ OPEN ]`.

## Build order (commit and push after each step, each one live and verified)
1. **Bracket keys.** `.key` and friends in `app/globals.css` (`@layer components`) and the constants in
   `app/lib/ui/controls.ts`. Add brackets to the labels that lack them. `/specimen` shows every key.
2. **Flatten.** `PANEL`, `PANEL_INSET`, `.panel*` and the hand-framed sections inside windows: sections
   lose their frame, windows and fields keep theirs.
3. **The cut list**, window by window, at 1440px and 390px.
4. **Font.** The import line in `app/theme/fonts.ts`, the fallbacks in `tokens.css`, `docs/theming.md`
   and `docs/design.md` (Type), `/notes` copy if it names the face (`app/lib/projects/notes.ts`).
   Then sweep for wraps and overflow at 1440 and 390 in both themes.
5. **Docs**: `docs/design.md` (Keys, Type, the flat sections, "explanations are tips").

## Proof
- Before pictures exist: `Temp/browse/eff/` (desktop + phone, guest + signed in, board, music, users, lore).
- `npm run verify`, `npm run checks` (85). Checks that test a removed or shortened string are updated on
  purpose, each with a dated comment saying why; never deleted to go green. Expect: shell, post-reel,
  board-comments, structure, surreal, themes, mobile, profile-layout, ux, notifications, queues, audio.
- `npm run capture` then `npm run audit`: no new small-text or contrast findings; tap targets still 44px
  on a phone.
- `npm run contrast` on /forum and /account, both themes (the bracket keys' accent ink on every fill).
- After pictures at 1440 and 390, both themes, guest and signed in. The board on a phone must show the
  first post on the first screen.
- Live: `npm run read` (with `--absent` for each removed sentence, e.g. `--absent "POINT AT IT TO STOP"`),
  plus screenshots of the deployed site.

## Gotchas
- Signing in with `--signin` and opening `?music=1` / `?arcade=1` saves those windows open in TEST ACCOUNT
  A's layout; Preferences is open in it now. Close them, or expect them in signed-in pictures.
- A `title` tip on a disabled button does not show in some browsers: put it on a wrapper.
- `npm run read` strips React's comments; use it, not grep, to prove a sentence is gone.
- Glyphs ♪ ▶ ◀ ↻ ⌂ ☻ ✉ ⚿ fall back to system fonts in Plex Mono too.
