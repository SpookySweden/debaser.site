# SPEC: the CYTUBE page, a blank GO LIVE and broadcaster looks (2026-11-03)

(Interview with Luke, 2026-11-03. **Build after SPEC-music-queues.md and SPEC-stream-art.md**, in that order:
this page lists their rooms and canvases and uses the canvas switch from the stream-art spec.)

## What Luke asked for
A CYTUBE key in the top bar: a page explaining the streaming functions, listing the current streams, a tab of
the stream canvases, a GO LIVE key, and CUSTOMIZE LAYOUT to set your own look for your broadcaster screens,
with toggles to see a host's look when you join their room or keep your own. Going live opens a blank black
screen with three keys that open the add-to-queue window with different searches filled in.

## Name
- **CYTUBE**, Luke's choice. Risk, said once: CyTube is an existing watch-together site (cytu.be); the name
  could read as affiliation. Luke chose to keep it as a nod. The page is `/cytube`, nav key `cytube`, placed in
  `NAV_ITEMS` (app/components/SiteNav.tsx) after ARCHIVE. Its band icon is an art slot (`ICON_CYTUBE`) with a
  font stand-in until Luke draws it.
- Signed-in only, like /archive: signed out it shows a sign-in prompt.

## The page
Tabs along the top of the page (the site's usual tab look):
1. **ABOUT** - plain-English explanation of streaming: rooms, the queue and additions, crowns, the stream bar
   and TV key, music rooms, the canvas, STREAM ART. Short, written by the building session, Luke reviews.
2. **LIVE** - every live room (music rooms and video streams, the same list as the QUEUES tab: one source,
   not a copy), each row: host, title, what's playing, `[ JOIN ]` and `[ QUEUE ]`.
3. **CANVASES** - the saved STREAM ART pieces (the archive's STREAM ART filter, same data and credits), plus
   rooms whose canvas is live right now.
- Always on the page, above the tabs: **`[ GO LIVE ]`** and **`[ CUSTOMIZE LAYOUT ]`**.

## GO LIVE (only from this page)
- `[ GO LIVE ]` opens your room **empty**: no file needed. GO LIVE is **only on the CYTUBE page** (Luke): the
  old "load a file, then GO LIVE" entry points in the media catalogue (`MediaCatalogue.tsx`), the archive's own
  files (`WebSiteFiles.tsx`) and the archive bridge keys (`WebBridgeKeys.tsx`) stop starting rooms. They become
  **add to queue** keys when you are hosting (or crowned), and otherwise point you to CYTUBE to go live. Their
  "SIGN IN AND GO LIVE FROM THE BOARD" sentences are reworded to send people to CYTUBE.
- A room with nothing playing: the screen is **black**. In the middle, **three keys**, in Luke's order
  (BOOKS, VIDEO, MUSIC; reordered 2026-11-03):
  - **`[ BOOKS ]`** - search set to books: audiobooks, **including audiobooks uploaded as video** (YouTube).
    Text books cannot play in a room, so they are not listed.
  - **`[ VIDEO ]`** - opens the add-to-queue window (`StreamQueueWindow`) with the search set to videos.
  - **`[ MUSIC ]`** - search set to audio **and** music uploaded as video (e.g. a song or album on YouTube).
  - Each search is just pre-filled; the person can change it.
- The **switch-to-canvas key** stays on the screen while it is black (from SPEC-stream-art.md).
- **When the queue runs out mid-stream**, the screen goes back to black with the same three keys.
- Who sees the three keys: the host and anybody crowned get them adding straight to the queue; everyone else
  gets them adding to their own additions list (the crown rule from SPEC-stream-queue.md, unchanged).

## The three keys' look and feel
- Resting: **yellow**. Hover (and keyboard focus): **BOOKS lights green, VIDEO lights red, MUSIC lights pink**.
- Pressed: the key **flashes** (a few quick blinks of its lit colour) and **squishes** a little (squashes and
  springs back), then the window opens.
- Saturated, dark colours; black screen background. Colours and the flash/squish timings are new tokens in the
  token files (docs/theming.md), never raw values in the component. Reduced motion: no flash or squish, the
  colour change alone.
- The keys are text keys in the site font. Any icon on them is an art slot with a font stand-in (asset rules).

## CUSTOMIZE LAYOUT (broadcaster looks)
- A broadcaster picks **a look for their room's screen and keys** from **a few presets**, built on the same
  presets as the site preferences themes (`app/lib/ui/themes.ts`: default, dark, the sherbets). **A separate
  session designs those presets** (Luke): saturated and dark, within the token rules, each checked for contrast
  by `npm run audit`. No free colour picker, no moving parts around, no fonts in this version.
- The look covers the room: screen frame, the stream bar's screen and keys, the three keys' surroundings, the
  queue window's frame. It does not change the rest of the site.
- **Viewer toggle** (on the room and in CUSTOMIZE LAYOUT): **SHOW THE HOST'S LOOK** (default, on) or **KEEP MY
  OWN LOOK**. Remembered per person. Your own look is the preset you picked for broadcasting.

## Edge cases (defaults - Luke can overrule)
- GO LIVE while you already have a live room: takes you back to it instead of opening a second.
- A host with no chosen look: the site's current theme.
- The three keys while a canvas is shown: hidden; they come back when you switch back to the screen.
- Phone width: the three keys stack; the page's tabs scroll sideways inside their strip, never the page.

## Out of scope
- Free colour pickers, moving chat / queue / screen around, custom fonts, uploading backgrounds.
- Anything about the canvas itself or music rooms (their own specs).
- Downloading or re-hosting media: the archive rules in CLAUDE.md hold (embed, link, or the platform's own file).

## Data (needs Luke's typed OK before anything is run)
In plain English - the building session writes the exact migration and asks first:
- A room can exist **with an empty queue** (today GO LIVE writes the first file as play 0).
- Each person's **chosen broadcaster look** (a preset name) and their **show-host's-look** toggle, readable by
  signed-in people (so viewers can see a host's look), editable only by the person. Row Level Security; the
  mock repositories keep the same rules.

## Suggested build order (commit and verify each)
1. The `/cytube` page with ABOUT / LIVE / CANVASES and the nav key.
2. Blank GO LIVE, the black screen and the three keys (pre-filled searches, colours, flash and squish); back to
   black when the queue runs out; retire the other GO LIVE entry points.
3. Broadcaster looks (after the presets session) and the viewer toggle.

## Proof
- Pure rules checked (which search each key pre-fills, back-to-black when the queue empties), proven to fail first.
- Drive on dev-mock: GO LIVE from /cytube gives a black screen with three keys; each opens the queue window with
  its search; hover colours and reduced motion checked; a viewer sees the host's look and can keep their own;
  desktop and phone widths, capture + audit.

## Look presets
(Proposed 2026-11-03 by a side session; **Luke OK'd them as proposed, 2026-11-03**. Mock: `Temp/looks-mock.html`, screenshots
`Temp/browse/looks-desktop.png` and `looks-phone.png`. Contrast arithmetic: `Temp/looks-contrast.cjs`.)

### What every look shares (fixed, not part of a look)
- **The screen is Black** in every look when nothing plays (`hardware`).
- **The three add keys** look the same in every look: resting **Daffodil** words on Black (17.72:1). Under the
  pointer or keyboard focus each fills with its lit dye and its words turn Black: **VIDEO light red**
  (`lightRed`, 7.06:1), **MUSIC Brilliant Pink** (5.76:1), **BOOKS Emerald** (9.35:1). These are your colours,
  so no look overrides them.
- **The stream bar's screen** (the LED readout: LIVE, host, title, NEXT, time) stays Black; a look picks the
  colour of its words.
- **The queue window's body goes Black inside a room**, whatever the viewer's site theme. Reason: the
  window's frame and title change with the look, and a coloured frame can only be checked for contrast
  against a surface we know. On Black every queue colour reads (played light red 7.06:1, now Emerald
  9.35:1, next light blue 8.79:1). Outside a room the queue window is unchanged.
- No new colours: every look uses dyes already in `DYES`.

### What a look sets (six room tokens)
- **bar**: the stream bar's strip.  **words**: names and plain words on the bar and the Black panels.
- **keys**: the bracket keys on the bar (`[ TV ]`, `[ HIDE ]`, `[ QUEUE ]`, the canvas key); under the pointer
  the key fills with this colour and its words take the bar colour.
- **lines**: the screen's frame, the bar's top rule, the LED's frame and the queue window's frame.
- **readout**: the LED screen's words.  **title**: the queue window's title.

### The five looks
| Look | Built from | bar | words | keys | lines | readout | title |
|---|---|---|---|---|---|---|---|
| **NIGROSINE** | the dark default | Nigrosine | White | Daffodil | White | Daffodil | Daffodil |
| **ROYAL** | DEBASER's Royal Blue | Royal Blue | White | Daffodil | Daffodil | Flavine | Daffodil |
| **BLOOD** | the queue's deep red | deep red | White | Daffodil | light red | light red | Candy |
| **JUNGLE** | SHERBET MINT + the queue's green | deep green | White | Lime | Emerald | Emerald | Mint |
| **ORCHID** | SHERBET NIGHT | Black | Candy | Lime | Orchid | Candy | Lime |

In plain English:
- **NIGROSINE**: the site as it is now, white outlines round a black screen, yellow keys. The quiet one.
- **ROYAL**: a bright blue bar under the screen, yellow outlines and keys. Loud, like the bright theme's title bars.
- **BLOOD**: a dark red bar with a rosy-red outline round everything; the readout glows red, the queue title pink.
- **JUNGLE**: a dark green bar, green outlines, lime keys, mint queue title. A green-screen terminal.
- **ORCHID**: all black with purple outlines, pink words and lime keys. The night-club one.

### Contrast (4.5:1 floor for words, 3:1 for lines)
| Look | words on bar | keys on bar (and filled) | title on Black | readout on Black | lines vs bar / vs Black |
|---|---|---|---|---|---|
| NIGROSINE | 17.83 | 15.04 | 17.72 | 17.72 | 17.83 / 21.00 |
| ROYAL | 9.34 | 7.88 | 17.72 | 18.51 | 7.88 / 17.72 |
| BLOOD | 9.79 | 8.26 | 13.17 | 7.06 | 3.29 / 7.06 |
| JUNGLE | 9.39 | 7.93 | 12.39 | 9.35 | 4.18 / 9.35 |
| ORCHID | 13.17 | 17.75 | 17.75 | 13.17 | 4.40 / 4.40 |
- Tried and dropped: a Brilliant Pink outline on BLOOD (2.69:1 against its own bar, under the 3:1 line floor).
- ORCHID's outline (4.40:1) and BLOOD's (3.29:1) are the thinnest; both clear the floor for lines, and
  neither colour is ever used for words.
- The building session holds these pairs in a check, the same way `Temp/check-themes.cjs` holds the themes,
  and runs `npm run audit` on a room in each look.

### Settled (Luke, 2026-11-03: "Looks right")
1. All five looks.
2. The names stay: NIGROSINE, ROYAL, BLOOD, JUNGLE, ORCHID.
3. The queue window's body goes black inside a room.

Luke confirmed this spec on 2026-11-03.
