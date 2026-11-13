# SPEC: FOR YOU, one recommender for the whole site (Luke, 2026-11-13)

## What Luke asked for
"incorporate the feed of whats shown into the tagging station feature and create a sort of algo that reccomends based on
anything available on the site based on the users interaction history etc as stated prior". "As stated prior" is
SPEC-discover.md ("uses tag algorithm to figure what you might like and also user interaction, shows users pfp and status
next to each recommendation") and SPEC-vanity.md (music from "the people you interact with most", with "small profile
pictures of the people who are the reason it's there").

## Luke's answers (2026-11-13)
| Question | Answer |
|---|---|
| What gets recommended | **Everything, people included:** MEDIA items (every source, KINO and books too), the site's own songs, board threads, open stream rooms, people, letters and lore pages. |
| New tracking | **Yes, a private history:** what you open, play and read, owner only, kept 90 days then deleted by itself, with `[ ERASE MY HISTORY ]` and `[ PAUSE HISTORY ]`. Database change: its exact description needs his typed OK first. |
| Other people's activity | **Only what's shared openly.** Never anyone's private history. A face (picture and status) only beside something that person openly shared. |
| Where | **FOR YOU on DISCOVER:** lanes at the top of the DISCOVER page (the Tag Station); your YouTube topics as starting words on the map; MEDIA's RECOMMENDED and PICKED FOR YOU on the same engine; the board unchanged; your YouTube list never sent to the tagger. |
| Feel | A why-line on every pick, steady through a day, about 7 familiar to 3 new, `[ NOT FOR ME ]`, no numbers. |
| Limits | No per-person Claude calls, never DM text, no emails or notifications, no new counts. People picks only show people you've interacted with or who openly share your tastes. |

## What Luke will see
**DISCOVER (`/discover`), signed in:** a FOR YOU section above the map, one lane per kind, each a row of up to 6 picks with
`[ MORE ]`. A lane with nothing honest to offer is left out, not filled.
1. **MEDIA:** `BECAUSE YOU WATCHED NOSFERATU`, `MORE FROM PRELINGER`.
2. **FROM YOUR YOUTUBE:** your channels' newest videos (empty, and hidden, until Luke says "Google is done").
3. **SONGS:** the site's own music (VANITY's FOR YOU people, plus your words).
4. **BOOKS:** books near what you read, highlighted or finished.
5. **ON THE BOARD:** threads about things you opened, in tags you read, or by people you talk to.
6. **OPEN ROOMS:** stream rooms open now, if their queue fits your words or someone you know is in.
7. **LETTERS:** public letters holding things you like, or from your people.
8. **LORE:** lore pages linked from threads you read, or whose title shares your words.
9. **PEOPLE:** picture, name and status, with why: `YOU REPLY TO EACH OTHER`, `YOU BOTH READ DRACULA`,
   `RECOMMENDED YOU A FILM`. Only people you've interacted with, or who openly share your tastes.

Every pick shows its why-line in plain words and plays, opens or reads with the keys it has elsewhere (PLAY, READ,
JOIN ROOM, OPEN). `[ NOT FOR ME ]` hides that pick and makes its words and maker count less. No scores, counts or
percentages anywhere.

**The map:** with YouTube linked, your YouTube topics are chips under the search box (`FROM YOUR YOUTUBE: FILM, JAZZ`);
pressing one goes to that word, as pressing any word does.

**MEDIA:** PICKED FOR YOU and RECOMMENDED order with the same engine, so what you read, play or open anywhere on the site
counts there too. They look the same as now (order only, no why-lines on MEDIA, as SPEC-discover.md keeps it).

**Visitors** (signed out): DISCOVER's FOR YOU says `[ LOG IN ] TO GET PICKS` once. Nothing is recorded for them.

**History controls**, in a HISTORY part of the account's PRIVACY tab and as a `[ HISTORY ]` key on FOR YOU:
- `[ PAUSE HISTORY ]` / `[ RESUME HISTORY ]`: while paused nothing new is written; picks keep using what's there.
- `[ ERASE MY HISTORY ]`: two presses (the second reads `[ YES, ERASE IT ]`). Deletes every row of yours at once.
- One plain line: `WHAT YOU OPEN, PLAY AND READ HERE, KEPT 90 DAYS. ONLY YOU CAN SEE IT.`
- The list itself, newest first, so a person can see exactly what is kept about them (no counts).

## The data
**Already there, used as it is (no change):** your plays (`music_listens`, your own rows), likes, playlists and barred
songs (a barred song is never picked); your reading places, highlights and finished books; letters you made; recommendations
sent to you and by you, and what you played in them; board threads and replies (who replies to whom); rooms you joined; your
DISCOVER presets; YOUR YOUTUBE's channels and topics; Claude's batch words for items (`web_item_tags`, `web_seen_items`);
VANITY's closeness (`music_for_you`, which already reads reply pairs, DM counts but never text, listening along, shared rooms
and profile visits).

**New (needs Luke's typed OK on this exact description):**
- `user_history`: one row per thing a person opened, played or read. Columns: the person; the kind (media, song, book,
  thread, room, letter, lore, person); which one (the address it already has on the site, up to 300 characters); its title
  and maker as shown (plain text, up to 200 and 100 characters); up to 12 words describing it (the item's own and Claude's
  batch words, for the taste); what was done (opened, played, read, finished, or NOT FOR ME); first and last time. One row
  per person per thing: doing it again only moves "last time". Owner only: only they can read, add or delete their rows;
  nobody else, signed in or not; visitors and stream-room guests are shut out. At most 3,000 rows a person (the oldest go).
  Deleted with the account. Rows untouched for 90 days are deleted by the hourly MEDIA fetch (lock-checked, as
  `user_youtube_taste`'s 30-day clean-up). ERASE deletes all of a person's rows.
- `user_history_settings`: one row per person: history paused or not, and when it changed. Owner only, guests out.
  While paused, the database itself refuses new history rows (so a forgotten browser tab can't keep writing).
- No counts are stored or shown, no DM text, nothing from Google's token, nothing about visitors.

## How it ranks (plain version; `app/lib/recommender/`, pure, held by checks)
1. **Your taste** is built from your history (weighted by what you did: finished > read/played > opened, newer counts
   more, halving every 30 days), your plays and highlights, YOUR YOUTUBE's topics and channels, and your active DISCOVER
   preset. NOT FOR ME marks words and makers down.
2. **Candidates** per lane come from that lane's own source (MEDIA's saved pool and catalogue files, Open Library, the
   music archive, the board, open rooms, public letters, lore pages, people).
3. **Score:** how well a candidate's words and maker fit your taste (DISCOVER's word closeness counts near-matches), plus
   openly shared signals (someone recommended it, a person you're close to posted it), a little freshness, and the same
   daily jitter MEDIA uses, so a lane holds still all day and changes tomorrow.
4. **7 familiar to 3 new:** of each 10 picks, about 7 fit your strongest words and 3 come from words one step out on the
   DISCOVER map (near your words but not yet in your history).
5. **Variety:** one maker or one site can't fill a lane (the repeat markdown MEDIA uses).
6. **The why-line** names the strongest single reason.
7. **People:** closeness from what's already shared (replies to each other, shared rooms, recommendations either way,
   VANITY's closeness) or open taste overlap (public highlights in the same books, public recommendations of things you
   like). Hidden accounts and the test accounts never show. A person who has hidden listening never appears for music.

Computed for the person asking, in their browser, from what they may already read; nothing new is shared with anyone.

## Out of scope
Per-person Claude calls; DM text; emails or notifications about picks; new counts; sending the YouTube list to the tagger;
changing the board; recommending to visitors; profile-visit lists.

## Build order (each step goes live on its own)
1. The engine and history: the two tables (after the OK), writing history from MEDIA, books, the board, rooms, letters and
   lore; the HISTORY controls; FOR YOU with MEDIA, SONGS and BOOKS lanes.
2. ON THE BOARD, OPEN ROOMS, LETTERS, LORE and PEOPLE lanes.
3. MEDIA's PICKED FOR YOU and RECOMMENDED on the same engine; YouTube topics on the map; FROM YOUR YOUTUBE lane (off until
   "Google is done").

## Proof
- Pure checks on the ranking: 7:3 mix, steady within a day, NOT FOR ME, barred songs never picked, no numbers in why-lines.
- Live, with test accounts A and B and a visitor: history owner only, guests and visitors out, paused refuses writes, ERASE
  empties, the 90-day clean-up refuses anyone without the lock, and a run leaves nothing.
- A check that people picks only come from shared signals (another account's private history can't steer A's picks).
- Screenshots at desktop and phone width of FOR YOU's lanes and the HISTORY controls, live.
- The house loop: verify, checks:changed, capture + audit, verify:clean, push, deploy-status.
