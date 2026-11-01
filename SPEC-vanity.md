# SPEC: VANITY, song settings panel, BARR (2026-10-31)

Interview answers from Luke, 2026-10-31. Build from this in a fresh session.

## What Luke asked for
1. Any site audio from the archive can go into a playlist in MY MUSIC.
2. A third tab in the music window, **VANITY**: the site's MP3s laid out like Spotify (by artist, by
   album, by song), with recommendations based on (a) the people you interact with most and (b) which
   people listened most to each song, artist, album or folder. Next to each recommended item, small
   profile pictures of the people who are the reason it's there.
3. A **settings panel on every song** holding ADD TO PLAYLIST, BARR, and the other per-song actions,
   so the rows get quieter.

## Decisions
| Question | Answer |
|---|---|
| Listen log | **Yes, new table.** A play counts after ~30s, or half the file if it's shorter than a minute. Starts empty, so picks are thin at launch. |
| Privacy of faces | **Opt-out.** Your listening shows by default; a profile setting hides it (you're left out of counts and faces). Hidden test accounts (`profiles.is_hidden`) never count or show. |
| "Interact with most" | **All four:** forum replies to each other, comms messages, listening along / watching together, **profile visits** (needs new tracking, see Data). |
| Placement | `[ ARCHIVE ] [ MY MUSIC ] [ VANITY ]` in the music window. VANITY opens inside the window like MY MUSIC. |
| Artist / album tiles | **The uploader's profile picture** (no new artwork, no drawn covers). An artist or album with several uploaders uses whoever filed the most of its files. Catalogue files with no uploader use the default avatar. |
| Artist / album | **The folder path decides:** `ARTIST/ALBUM/file`. A file loose in a top folder is a single by that artist. Board attachments are filed under the poster's name. |
| Time window | **All time** totals, not weighted. |
| Where ADD TO PLAYLIST lives | In the **per-song settings panel**, wherever a song row appears. |
| BARR scope | **Only me.** A personal mark nobody else sees. |
| BARR on decline | **Skip to the next song**; if there is none, stop. |
| Panel contents | ADD TO PLAYLIST, BARR / UNBARR, LIKE / UNLIKE, ADD TO QUEUE / PLAY NEXT, COPY LINK / ATTACH TO POST, GO TO ARTIST / ALBUM / FOLDER. **Liking stays one click on the player at the bottom too.** |
| Board MP3s | **Yes**, forum post attachments get the panel too; barred ones show red in posts. |
| BARR in shared listening | **Mute just me, with a notice.** In a followed broadcast or stream room, a barred song mutes only your speaker, with `BARRED SONG PLAYING :: [ LISTEN ANYWAY ]`. You stay in sync; nobody is told. |
| "Project folders" | **The site's Projects section.** Today there is one project (DEBASER) and no MP3 is filed under it, so: a project **owns top-level archive folders**, written in the code by request (e.g. "DEBASER owns HEXHAM"), no admin screen. Projects are then recommendable items like artists. |
| Listening along | **Log it** (who followed whom, how long). Stream rooms are already on record. |
| Repeats in FOR YOU | **Mostly new**, plus a separate **ON REPEAT** row of your own most played. |
| Loop spam | **Cap: at most 3 plays a day per person per song** count towards totals, picks, play counts and MIRROR. Your own ON REPEAT sees every play. |
| Ideas taken | MIRROR, PLAY FOR YOU radio, rows per person, live faces, public play counts, save a row as a playlist, "why this?" line (details below). Not taken: a soft "not for me" hide. |
| MIRROR | Sub-tab inside Vanity, **only you see it**, only shown once you've filed at least one song. |

## How it should look and feel
- **Song settings panel:** one small key on each song row (e.g. `[ ⋯ ]`, a text glyph, no icon art)
  opens a short menu under the row. Rows that currently carry several keys lose them into the panel,
  so they get quieter (except the player's own like key). Applies to: archive rows (`/media?kind=audio`),
  MY MUSIC rows, VANITY rows, and the now-playing line in the player. Board attachments: open question.
- **BARR:** a barred song's row reads in the theme's red token (no raw colour; see `docs/theming.md`)
  everywhere it's listed, for that reader only. When a barred song is about to play from *any* route
  (playlist, queue, archive, someone's profile song, a broadcast being followed, a stream room?),
  the player pauses before it starts and asks `BARRED :: <title> - PLAY ANYWAY?` `[ PLAY ] [ SKIP ]`.
  Skip moves on; at the end of a queue it stops.
- **VANITY** (inside the window, ~576px wide, and phone width):
  - Top: **FOR YOU**, rows of recommended SONGS, ARTISTS, ALBUMS, FOLDERS. Each item carries up to
    three small round faces (the people it's recommended through) and `+n` if more; hovering or tapping a
    face names them (`PLAYED 14× BY <NAME>`). Tapping a face opens their profile.
  - Sub-tabs: `[ FOR YOU ] [ BY ARTIST ] [ BY ALBUM ] [ BY SONG ] [ MIRROR ]` (MIRROR only for uploaders).
    Artist and album tiles show the uploader's picture and the name; a tile opens the artist (their
    albums and songs) or album (track list). Projects appear as items in FOR YOU.
  - Songs play from here like anywhere else, and carry the settings panel.
  - **FOR YOU rows:** SONGS, ARTISTS, ALBUMS, PROJECTS (mostly things you haven't played much),
    **ON REPEAT** (your own most played), and **rows per person**: `FROM <NAME>'S ORBIT`, what each of
    your closest contacts plays most, their face as the row heading (opted-out people get no row).
  - **"Why this?" line** under the faces: e.g. `PLAYED BY 3 PEOPLE YOU REPLY TO`, naming the kind of
    interaction that weighed most (replies, messages, listening along / watching, profile visits).
  - **Live faces:** a face gets a marker when that person is playing that item right now (from the
    existing presence); tapping the marker follows along.
  - **`[ PLAY FOR YOU ]`:** one key that plays an endless queue drawn from your recommendations,
    skipping barred songs, topping itself up as it goes.
  - **`[ SAVE AS PLAYLIST ]`** on any FOR YOU row or album: copies it into MY MUSIC in one press.
  - **Public play counts:** `214 PLAYS` on songs, albums, artists, projects, in Vanity and the archive.
    Numbers only, no names. Capped counting (see Loop spam).
- **MIRROR** (only you see it): your filed songs with plays each, and the faces of your top listeners
  per song and overall. Opted-out listeners count in the numbers but show no face.
- **Barred songs in Vanity:** never recommended and never in PLAY FOR YOU; in the browse views they
  still list, in red.
- **Empty state at launch:** with no listens logged yet, FOR YOU says so plainly (e.g. `NOTHING YET ::
  PICKS APPEAR AS PEOPLE LISTEN`) and the browse views work regardless.

## How recommendations work (plain version)
1. **Closeness:** for the reader, score every other visible account by forum replies between them,
   comms messages between them, time listening along / in the same stream room, and profile visits
   either way. Higher = closer.
2. **Item score:** for each song, artist, album, folder: the sum over people of
   `closeness to you × how many times they played it`, plus a small all-site popularity term so a new
   reader with no contacts still gets something.
3. Leave out things you've barred, and optionally things you've played a lot already (open question).
4. The faces shown are the people contributing the most to that item's score.

## Data (each table is a migration, needs Luke's typed OK before pushing; RLS on all)
- `music_listens`: who, which file, when. Insert as yourself only. Readable as totals only, so nobody
  can read another person's raw timeline. Totals exclude hidden and opted-out accounts.
- `music_barrs`: who, which file. Readable and writable only by yourself.
- `profile_visits`: visitor, profile, count / last visit (one row per pair, not one per visit, to keep
  it small). Own visits not counted. Only used inside the score, never shown as a list.
- `profiles.hide_listening` (boolean, default false) + a toggle on the profile settings.
- Probably a database function that computes "recommendations for me" so the totals never leave the
  server in raw form.
- `music_follows_log`: listener, host, start, end (for listening along). Insert/update as yourself.
- Forum replies, comms messages and stream rooms already exist.
- Project ownership of folders: a list in code beside `app/lib/projects/debaser.ts`, not a table.
- Mock and Supabase repositories both get every part (the switch is `NEXT_PUBLIC_MUSIC_DATA_SOURCE`).

## Risks Luke should know
- **Picks start empty** and stay thin while the site is small; the all-site popularity term and the
  browse views carry it at first.
- **Faces reveal listening habits.** The opt-out covers it; still worth a line in the profile setting
  explaining what it hides.
- **Profile visit tracking** is the most "watched" feeling of the four; it only feeds the score and is
  never shown, but it is personal data stored per pair.
- **BARR touches every playback route** (player, queues, follow, profile songs). That's the biggest
  correctness job; each route needs its own check.
- All-time totals mean early heavy listeners dominate for a long time. Easy to switch to weighted later.
- **Scope is now large** (7 steps, 4-5 new tables). Each step should go live on its own; a later step
  can be dropped without breaking an earlier one.
- Live faces and PLAY FOR YOU both lean on the player and presence code, the most fragile area
  (follow, broadcasts, stream rooms pausing the player). They're last for that reason.

## Suggested build order (commit + verify live after each)
1. Song settings panel on archive and MY MUSIC rows, with ADD TO PLAYLIST (uses the existing
   `togglePlaylistTrack`; no database change). Delivers ask #1 alone.
2. BARR: table + red rows + the play-anyway prompt on every route.
3. Listen log + `hide_listening` setting.
4. VANITY tab with BY ARTIST / BY ALBUM / BY SONG, public play counts, SAVE AS PLAYLIST on albums.
5. Profile visits + listen-along log + closeness + FOR YOU with faces, "why this?", ON REPEAT,
   rows per person, project mapping.
6. MIRROR.
7. PLAY FOR YOU radio and live faces.

## Out of scope
- Drawn cover art, generated covers, any code-drawn pictures.
- Site-wide (moderator) barring.
- Showing anyone a list of who visited their profile or a timeline of someone's listens.
- Recommendations outside the music window.

## Open questions
All answered (second interview, 2026-10-31). Still to hear from Luke before step 5: which top
folders DEBASER owns.

## Proof it's done
`npm run verify`, `npm run checks` (new checks for: path -> artist/album, score maths, BARR gate on
each route including the mute-just-me case, the 3-a-day cap, hidden/opted-out accounts never
showing a face, MIRROR readable only by its owner), capture + audit, screenshots of the window at
desktop and phone width with test accounts A-D having listened, then push and `npm run read` live.
Two-person test: A and B listen; C (who replies to A on the forum) sees A's face on A's songs.
