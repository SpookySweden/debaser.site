# SPEC: the media catalogue (`/media`)

Interviewed 2026-10-24. Luke's answers are the decisions below; everything else is the smallest shape
that honours them. Build from this in a fresh session, one step at a time, each step live before the next.

## What it is for

One place that lists every file the site holds - pictures, music, and video - says where each one is used
on the site, and makes it so easy to point at an existing file that nobody needs to upload it twice.

## Decisions (Luke, 2026-10-24)

1. **Access.** Everyone can see the catalogue. Uploading takes an account (as music and profile pictures do now).
2. **Placement.** A page of its own at `/media`, with a key in the top bar beside HOME / FORUM / USERS / COMMS /
   ACCOUNT. It **replaces the music window's ARCHIVE screen**. This reverses the frontend rule "don't add
   `/music` routes back" for the archive; the rule stays for everything else (the arcade and MY MUSIC remain
   windows). Write the reversal into `.claude/rules/frontend.md` when the page lands.
3. **MY MUSIC stays a window.** The SHELF's MUSIC key opens the window straight onto MY MUSIC (likes,
   playlists, queues). Its ARCHIVE tab becomes a link to `/media?kind=audio`. The player bar is untouched.
4. **Duplicates.** An upload whose bytes already exist is accepted and the *original* is used: the person
   sees `ALREADY IN THE CATALOGUE - USING THE ORIGINAL`, and no second copy is stored.
5. **Images on posts.** Posts and replies can upload a picture, under the profile-picture rules (2MB,
   PNG/JPG/WebP/GIF). Every new upload is catalogued and tagged first, then placed on the post. New images
   are also compared **by look**, not only by bytes: if one looks the same as a catalogued image, the composer
   recommends citing the original (one key: `[ USE THE ORIGINAL ]`), but the person may keep theirs.
6. **Video.** Playable from day one, small files only: MP4/WebM, hard limit 25MB, a plain player on the page
   and in posts.
7. **Hand-drawn art.** Concept sheets are catalogue items (read from `app/lib/concepts/sheets.ts`, never
   re-uploaded). Flags, cursors, sprites and icons are furniture and stay out.
8. **Uses.** Each item lists where it appears, and each use is a link that opens the post, reply, profile or
   page. A one-off migration brings in everything that already exists.

## What exists today (so nothing is built twice)

- Pictures: concept sheets (files in `assets/concepts/`, listed in code); profile pictures (`avatars` bucket,
  `profile_avatar_versions`). Posts cannot upload images; they pick a sheet.
- Music: `mp3` bucket + `music_tracks` (one row per file address, `src` unique) + `music_folders`;
  profile songs (`profile_song_versions`). A track on a post is a *copy* of its details in
  `forum_threads.track` / `forum_comments.track` (jsonb), not a pointer.
- Video: nothing. Lore pages carry no images.
- Nothing fingerprints file contents, so the same song under a new name is a second row.

## The shape

### The record: `media_items`
One table for every kind. Columns: `id`, `kind` (`image` | `audio` | `video`), `bucket`, `path`, `src` (public
URL), `sha256` (unique: the duplicate rule), `phash` (the looks-alike fingerprint, images only; 64-bit, computed in
the browser from a 9x8 greyscale downscale before upload - no AI, no server work), `bytes`, `mime`, `width`,
`height`, `length` (audio/video running time as text, as `music_tracks.length` is), `title`, `credit`, `tags`
(jsonb, the audio tag rules reused for every kind, max 4), `folder_path` (audio keeps its archive folders),
`source` (`upload` | `sheet` | `migrated`), `uploaded_by`, `uploaded_by_label`, `created_at`. RLS: readable by
all; insert by the uploader (not banned); update/delete by uploader or admin, as `music_tracks` has.

Buckets: `avatars` and `mp3` stay; add `images` (2MB, the four image types) and `video` (25MB, `video/mp4`,
`video/webm`). Policies copied from `mp3` (owner's folder, public read).

### Where it is used: `media_uses`
`(media_id, use_kind, use_id, href, label, used_at)`, use_kind one of `post`, `reply`, `profile_picture`,
`profile_song`, `sheet`, `lore_page` (reserved). Written in the same call that places the file (the
composer, the customiser), and rebuilt by the migration. The page reads it; nothing else needs to.

### The page: `/media`
Laid out like the concept archive and the user directory, in the Gnorp window look. One window, tabs across
the top: `ALL / IMAGES / AUDIO / VIDEO`, a search box, a sort (`NEWEST / TITLE / MOST USED`), and the audio
tab keeps the folder tree the music archive has today (`music_folders`). Each row: thumbnail (or `♪` / `▶`
for sound and video), title, credit, tags, uploader, date, size, and `IN 3 POSTS, 1 PROFILE` - pressing a
row opens it: the full picture / player, the tags, and the uses as a list of links. A `[ + UPLOAD ]` main
key for a signed-in reader; a guest sees why there is none. Phone width: one column, no sideways scroll.
Every row's keys keep the 44px tap height.

### Picking instead of uploading
One `MediaPickerWindow` (the `TrackPickerWindow` pattern) that any composer opens: search the catalogue,
press a row, done. The new-post form, the reply box, the comment box and the profile customiser all offer
`[ FROM THE CATALOGUE ]` beside `[ UPLOAD ]`. Picking writes a `media_uses` row and stores the item's id
(plus the same display copy the post stores today, so old readers of the row keep working).

### Upload flow (every surface, one module `app/lib/media/upload.ts`)
1. Validate (kind, type, size) with the same sentences the avatar and track uploads use.
2. Fingerprint in the browser: sha256 of the bytes; for an image, the looks-alike hash too.
3. Ask the catalogue: exact match -> use the original, say so, skip the upload. Looks-alike match (hash
   distance <= 10) -> show the original beside the new one with `[ USE THE ORIGINAL ]` / `[ KEEP MINE ]`.
4. Otherwise upload to the kind's bucket under the uploader's folder, insert `media_items`, then the use.
5. Tags: the person picks up to 4 from the starter list or types their own, as audio does now.

### What changes elsewhere
- Top bar: a sixth key, `MEDIA`, glyph to be chosen from the text-character set (no drawn icon until Luke
  draws one; `SiteNav.tsx` carries glyph + spoken label).
- Music window: ARCHIVE screen removed; its tab links to `/media?kind=audio`; `?music=1` opens MY MUSIC.
  `[ INJECT ]` moves to the catalogue's audio rows and keeps filing under the track (today's behaviour).
- `music_tracks` stays as the source for the player's queue until the migration is proven; then the queue
  reads `media_items where kind = 'audio'` and `music_tracks` is retired in a later, separate step.
- `forum_threads.track` / `forum_comments.track` and `media` columns gain a `media_id`; display copies stay.

### Migration (one-off, reviewed first, Luke's OK before it runs)
Read-only pass first that lists what it would create: every `music_tracks` row, every
`profile_avatar_versions` / `profile_song_versions` file, every track or picture copied onto a post or
reply, every concept sheet. Fingerprints are computed by a script that downloads each file once. Then the
write: `media_items` + `media_uses`, idempotent (`on conflict (sha256) do nothing`), so it can be re-run.

## Out of scope
- Editing a file after upload (crop, rename) beyond title, credit and tags.
- Albums / collections on the page (the audio folder tree is the only grouping).
- Lore page images (reserved use kind only).
- Streaming or transcoding video; what is uploaded is what plays.
- Retiring `music_tracks` (its own step after the catalogue is live).

## Risks to say out loud
- **Storage.** Supabase's free tier is 1GB. 25MB videos fill it in 40 files. The page should show
  `CATALOGUE: 312MB OF 1GB` so the ceiling is visible; past 80% uploads say so and refuse video first.
- **Looks-alike matching** finds crops and recolours poorly and rotations not at all; it is a nudge, not a
  gate (hence `[ KEEP MINE ]`).
- **The route rule.** `/media` is a page; the arcade and MY MUSIC remain windows. If the page later wants
  windows-only behaviour (open over the board), that is a second decision.
- **Two sources of truth** for audio until `music_tracks` is retired. The migration must leave the queue
  reading exactly what it read before; `npm run styles --compare` and the account-music check prove it.

## Build order (each step: verify -> checks -> capture + audit -> commit -> push -> live)
1. Schema: buckets, `media_items`, `media_uses`, RLS (migration via `npm run db:new`). Mock repository too.
2. The read-only page at `/media` listing concept sheets and `music_tracks` through the new repository
   (no uploads yet), top-bar key, music window's ARCHIVE tab turned into the link.
3. Upload module with fingerprints; the page's `[ + UPLOAD ]` for images, audio, video.
4. The picker window and `[ FROM THE CATALOGUE ]` on the composers and the customiser; images on posts.
5. Uses: written on placement, shown on the page as links.
6. Migration (review pass, then the write with Luke's OK).
7. Queue reads the catalogue; `music_tracks` retired (separate session).

## Proof
Checks for: the duplicate rule (same bytes -> same row), the looks-alike nudge (a resized copy is flagged, an
unrelated picture is not), the uses list (a post that picks an item appears under it), RLS (TEST ACCOUNT B
cannot delete A's upload), and the page at phone width. Live: upload one small image as TEST ACCOUNT A, pick
it from a post as TEST ACCOUNT B, see both uses on the page, read it back with a real browser (the plain
`npm run read` cannot see client-loaded lists).
