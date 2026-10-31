# Latest: VANITY build (SPEC-vanity.md) - steps 1-2 LIVE, step 3 waiting for Luke's OK (2026-10-31)
- STEP 1 LIVE (5a6c115): `[ ⋯ ]` song panel (app/components/SongMenu.tsx) on /media audio rows, MY MUSIC
  rows, post MP3s, the player bar: ADD TO PLAYLIST (+ inline new list), LIKE, BARR, ADD TO QUEUE / PLAY
  NEXT, COPY LINK, ATTACH TO POST, GO TO <top folder>. Player: hand-made `upNext` (NEXT / track end /
  headset take it first), one-click heart, `shelfSize` (songs appended after the archive read - post MP3s,
  profile songs - get no likes/lists; app/lib/audio/up-next.ts). Check: Temp/check-song-menu.cjs.
- STEP 2 LIVE (d64af6d table, pushed with Luke's OK; 56c185a code): `music_barrs` (owner-only RLS, keyed by
  file address). Library provider publishes the set to app/lib/audio/barrs.ts (the player sits outside it).
  The player derives a gate: `held` = barred and not allowed -> element paused, bar shows paused, prompt
  `BARRED :: <title> - PLAY ANYWAY? [ PLAY ] [ SKIP ]` (the bar's own play key = PLAY ANYWAY); following a
  broadcast -> `audio.muted` + `[ LISTEN ANYWAY ]`. Allowance cleared by play/assign/playAt/next/previous/
  track end. SKIP: upNext, else next file, else stop. Red titles: token `barred` (Rose, White words 4.70:1)
  via `BarredTitle`. The player's panel and prompt render through app/components/AboveAnchor.tsx (portal,
  z-popout): inside the bar (z-50) they opened UNDER docked windows. Check: Temp/check-barr.cjs (proven).
  Mock library fixed: reads loaded storage only after a first write; barrs dropped on load.
- Driven signed in on the MOCK data source (dev server :3212 with NEXT_PUBLIC_*=mock, mock house account,
  shelf seeded in localStorage with two real MP3 URLs): bar, prompt, SKIP, SKIP at end stops, ask again
  after leaving, PLAY ANYWAY, new list + add, like, red row, phone 375px. NOT driven: the follow/mute case
  (needs a second account broadcasting), post-MP3 red title (mock board empty), anything on the real
  database signed in (`.env.test` missing on this machine). Stream rooms hold only videos: BARR n/a there.
- STEP 3 drafted, NOT pushed: supabase/migrations/20261031130000_music_listens.sql (uncommitted):
  music_listens (own insert/read/delete, 20s repeat guard), profiles.hide_listening, music_play_counts()
  (capped 3/person/song/day, excludes hidden + opted-out). Waits for Luke's typed OK.
- Gotchas: port 3210 held by an older `next start`; `npm run shot` reads `[+]` as CSS (use the built-in
  browser). Luke still to name which top folders DEBASER owns (step 5).

# Latest: archive (/media) opens on categories, everything folded (2026-10-31)
- STATUS: LIVE (fd274af categories, bf42b5a phone tap height + search on its own line). Verify passed,
  checks 7/7, shot at desktop + phone width on https://debaser-site.vercel.app/media, every key >= 44px
  on a phone, no sideways scroll. No database changes; mock and Supabase repos untouched (it only
  rearranges data already loaded).
- How it works: `app/lib/media/categories.ts` (pure, no React) puts each file in categories by what it
  is and where it is used (profile picture / concept sheet / post picture / other; one per top music
  folder, profile music, unfiled; videos). Nobody files by hand. A file can sit in two; search and tag
  results list it once, under its first. `app/components/MediaCatalogue.tsx`: front page of tiles +
  TAGS row; `?cat=<id>` one category; `?kind=` a section's categories as folds; search/`?tag=` grouped
  by category. Check: `Temp/check-media-categories.cjs` (proven to fail with a rule removed).
- Decisions: a tag pill shows every kind of file wearing it (not just music) - Luke may want it
  music-only; an empty music folder link shows an empty folder, never NOT FOUND.
- Gotchas: the audit (`capture`/`audit`) does not cover /media, so tap sizes were measured by hand;
  `npm run read` only sees the served shell (the page renders client-side), screenshots are the proof.
  Only 1 file has a tag, so the TAGS row is near empty. The VANITY note below calls
  MediaCatalogue/categories.ts "uncommitted stream-room work" - that was this archive work, now committed.
  My first push also published the forum session's local "Forum sorts... step 1" commit (built fine).
  core.md says "about 75" scratch checks; only 7 exist on this machine.
- Next (nothing half-done): none required. Possible: tag pill music-only if Luke prefers; add /media to
  the audit capture list.

# Latest: VANITY spec written, nothing built (SPEC-vanity.md) (2026-10-31)
- Interview only (two rounds + ideas). No code, no database changes. Build in a fresh session from
  SPEC-vanity.md, step 1 first (song settings panel with ADD TO PLAYLIST: no DB change, uses the
  existing `togglePlaylistTrack`; the archive at /media?kind=audio has no add-to-playlist today).
- Gotchas found: no listen history, profile visits or listen-along are recorded anywhere yet (new
  tables, each needs Luke's typed OK); no MP3 is filed under a project (DEBASER), so projects need a
  folder mapping in code - Luke still has to name which top folders DEBASER owns before step 5.

# Latest: watch together (SPEC-watch-together.md) - stream rooms, [ TV ] key, forum record, archive folds (2026-10-27)
- STATUS: LIVE (5df486d data, 43fba4b screens), driven on https://debaser-site.vercel.app twice: dark theme
  (clean leave) and bright theme (A's tab killed) - every step passed. Review fixes in the commit after.
- supabase/migrations/20261027130000_watch_queue_plays_by_host.sql PUSHED with Luke's OK (review finding:
  any account could insert a queue row already marked played, which the record would show and the host
  could not remove; now only the host files a played row). Proven live by `node Temp/probe-watch-policy.cjs`
  (B's forged play refused 42501, B's plain add and A's first play allowed; it writes, so it is named
  outside the check-* pattern and the suite never runs it).
- The two risks, fixed 2026-10-27 at Luke's request (his OK for the function):
  - A host paused in a background tab: Chrome throttles a hidden, silent tab's timers to one a minute after
    5 min, so the 3s heartbeat went quiet and anybody in the room could take over (8s rule). The heartbeat
    now runs on a worker's clock (app/lib/watch/steady-timer.ts), which that throttling does not slow. NOT
    driven in the throttled state: under Playwright, Chrome reports every tab visible (headless, headed
    off-screen, a second tab in front, minimized - all tried), so the drive checks the heartbeat runs on a
    worker. "Must be in the room" was not added: anybody may join a room, so a members table guards
    nothing; a host who really vanished being taken over is the design.
  - Handover order by each machine's clock: a tab now stamps its join with the database's clock,
    `watch_now()` (supabase/migrations/20261027140000_watch_now.sql, reads nothing, PUSHED with Luke's
    OK; falls back to this clock minus the room's measured skew). The drive's TEST ACCOUNT C joins after B
    with Date.now() a minute slow: before the fix A's prompt named C as next host (seen live); after, B -
    and C still follows within 0.12-0.33s (the skew calibration holds).
- Found by the live drive while proving those (fixed, same day): the room drew a different tree on a phone
  than on a desktop, so a width change rebuilt the <video> and the host's listeners stayed on the old one -
  the host's file stopped at its end without looping, the room was written as paused, and a handover then
  inherited a stalled stream. One tree at every width now (only the side column changes), the listeners
  follow the element (`attachVideo`), and a host who takes over a player already at its end moves on at
  once. Drive step "after the window changed width, the host still loops" fails on the old code (seen
  live, twice) and passes on the new. Also: the room no longer flashes NOT ON THE BOARD right after GO LIVE.
- What Luke sees: `[ ▶ STREAM ]` on every video in /media (accounts) opens the room window large over the board
  (`/forum?watch=new&media=<id>`), `[ GO LIVE ]` is the second press. Room: video left (host: play/pause, seek,
  `[ SKIP ▶▶ ]`, `[ END STREAM ]` twice-pressed; everyone: title, `n OF m`, time, mute, volume), QUEUE + CHAT
  right (phone: video, chat, queue folded), `WATCHING (n)` names + guests. Guests watch and read, `[ LOG IN ]
  TO TALK`. Joining pauses the music player and ends a follow. `[ TV ]` beside anyone in a live room in the
  directory rows (UserDirectoryRow, both versions), tip `WATCHING <file> WITH <host>` / `STREAMING <file>`.
  Board: one thread per stream `STREAM :: <HOST> :: <yyyy-mm-dd>` (board anchor `watch:<roomId>`), LIVE
  marker, open = the record drawn from the room (files in play order, a fold of timed chat each), replies
  below; `STREAMS` source filter. /media video rows: `[+] STREAM CHAT (n)`, one fold per stream, newest first.
- Code: app/lib/watch/* (types, rules [pure: sync, queue, handover, words], watch-window, repository switch
  `NEXT_PUBLIC_WATCH_DATA_SOURCE` (supabase in .env.production), mock + supabase stores, use-watch-room
  [one cached read + feed per room, changes applied from realtime rows so the 3s heartbeat never re-reads],
  use-watching, use-stream-folds); components WatchWindow (address, pre-live, GO LIVE), WatchRoom (host /
  follower logic, queue, chat, leave prompt), WatchKey, StreamRecord (+StreamMarker), StreamChatFolds.
  `isItemOwnedThread` excludes stream threads (empty body but they keep their title).
- DB: supabase/migrations/20261027120000_watch_rooms.sql PUSHED with Luke's OK: watch_rooms / watch_queue /
  watch_messages, RLS (read all; insert as yourself while live; only the current host writes the room and
  reorders/trims unplayed; authors delete own lines), guard trigger (original host, start, thread id fixed;
  ended stays ended), `watch_take_over(room, gone_host)` (only after 8s host silence, one winner),
  `watch_close_stale(room)` (3 min silence). All three on supabase_realtime.
- Presence: each room has its own channel `watch:<id>` (per-tab key, join order = handover order); every
  signed-in tab in a live room also tracks on `site-watching`, which the [ TV ] key reads. That channel is
  separate from `site-presence` on purpose: joining/leaving is ~1-2s, a state change on Supabase is ~6s.
- Timings on the deployed site: GO LIVE -> playing 1.0s; A on site-watching 2.8-3.6s; B joins (page load
  included) 6.4s; B follows within 0.36-0.76s; chat 0.4s; host pause -> B 0.2s, play 0.9s; clean leave -> B
  hosts 0.6s; A's tab killed -> B hosts 0.7s (the pagehide hand-over landed; locally, where it did not, the
  8s take-over did it in 7.7-8.8s); last leaver off site-watching 0.4-1.6s.
- Decided while building (tell Luke): the last file looping is ONE play in the record (otherwise a 10s clip
  fills the thread); the add-a-video picker is a text list (videos have no thumbnails for MediaPicker); a
  host who closes the tab with others present hands over on the way out (best effort; the 8s take-over
  catches a lost write); a host alone who closes the tab does NOT end it (a reload resumes hosting) - the
  room reads as over after 90s quiet and is closed by whoever looks after 3 min.
- Test video: TEST SIGNAL // LOOP, 10s 640x360 VP8 WebM, 472KB, recorded by `node Temp/test-signal.cjs`
  (canvas -> MediaRecorder, Duration patched into the WebM header so it seeks), uploaded as TEST ACCOUNT A
  by `node Temp/watch-upload.cjs` (Luke's OK). It stays.
- Proof: `node Temp/check-watch.cjs` (22; proven to fail with the stream-title fix undone and with every
  viewer made host; header has the tsc lines). `node Temp/watch-drive.cjs [url] [--crash] [--bright] [--no-shots]`: A + B + a guest, 14 numbered
  steps, pictures in Temp/browse/watch/<local|live>-<theme>[-crash]/. The drive caught a real bug (a queued
  copy of the same file never restarted, so the loop stalled).
- Gotchas: the [ TV ] key cannot be pressed by a drive - TEST ACCOUNT A-D are hidden from every directory -
  so the drive listens on `site-watching` from Node and opens the address the key links to. The music
  player's Audio element is made in script (not in the DOM): read its state from the bar's clock. The test
  accounts' saved layouts open QUEUES/PREFERENCES over the board; the drive hides other docked windows.
- Test data: every drive run leaves a room, chat lines and a board thread `STREAM :: TEST ACCOUNT A :: ...`
  on the live board. As of the last drive: 8 rooms (all ended, all TEST ACCOUNT A), 8 threads (0 replies),
  16 queue rows, 16 chat lines; 0 rooms by a real account. supabase/cleanup/watch-test-streams.sql lists
  and (with OK) removes them, optionally keeping one as an example. RUN 2026-10-27 with Luke's OK, keeping
  the newest as an example: removed 8 rooms (7 drive streams + the policy probe's room) and 7 threads;
  survivors 1 room (3d894b07..., 07:31, bright/killed-tab run) with 2 plays, 2 lines and its thread; the
  board has 7 threads (6 before this work + that one). Live as a guest: 1 stream thread, STREAM CHAT (1).
- Checks: verify passes; check-watch 22 (rules, mock store, and the screens drawn); check-structure needed
  WatchWindow rendered by a check (it is now). 75/76 checks; check-comms-render still fails as before (not this work).
  Audit unchanged (12 LOW).

---

# Latest: lamps react in seconds; yellow means AWAY (2ad6fa1) - live, timed on the deployed site (2026-10-27)
- Luke asked for "far more reactive" online/away/offline lamps and chose: yellow = away only (site open, not in
  use); somebody who left is red, the tooltip says how long ago.
- How: every tab joins one Supabase Realtime Presence channel `site-presence` (supabase-profile-repository.ts,
  `subscribeLive` / `trackLive` / `untrackLive`; mock room = this tab only). Signed-in tabs track
  `{ user_id, state: active|away }`; away = 30s in the background or 5 min untouched (PresenceProvider.tsx).
  `presenceStatus(record, now, live, userId)`: the room decides when connected; otherwise the old clock rule on
  `last_seen_at` (never yellow). The 60s heartbeat stays (dates LAST ONLINE). No DB change.
- Decided while building (tell Luke): away people can still be challenged and appear in WHO IS AROUND (header now
  says `n AROUND`); directory rows read AWAY for yellow; lamp tip `Green: in use. Yellow: away. Red: not on the site.`
- Timed on the deployed site (`node Temp/presence-drive.cjs <url> [--idle] [--shots]`, A watches B's profile):
  open -> green 3.0s (1.4s was page load), background -> AWAY 32s, back -> green 1.3s, network drop -> red 63s
  (server timeout), network back -> green 10s, tab close -> red 0.1s. Idle step (local prod): AWAY at 309s.
  Pictures: Temp/browse/presence/. Was: a closed tab stayed green up to ~2.5 min (9 of 13 rows had is_online stuck true).
- Gotcha: Supabase relays presence *state changes* to other clients on a ~6s cycle (`Temp/presence-probe.cjs`
  shows B's track lands in 0.02s, A gets the diff on a fixed tick), so away<->green takes 0-6s; join/leave is fast.
  A broadcast message on the same channel could shave that, not built.
- Known risk (Luke told): the channel is public, so a visitor could fake another person's lamp; closing it needs a
  private channel + realtime.messages policy (a DB change).
- Checks updated on purpose: presence, user-directory, flows, shell. check-presence proven to fail with the room
  ignored. check-comms-render was already failing before this change (the side panel's COMMS folds by default).
- Review fixes in the same commit: effect keyed on the account id (auth's fresh `user` objects made the tab leave
  and rejoin), bfcache `pageshow` re-announce, stale-channel guard.

---

# Latest: the audio tab rebuilt in the catalogue's shape; the title bar one shape on every page (2026-10-24)
- Title bar: USERS and MEDIA carried a `[ × ]` close key that pushed their title left of every other page's.
  The key and SiteWindow's `closeHref` prop are gone; every page draws the identical bar.
- AUDIO tab (MediaCatalogue.tsx): the catalogue's own rows grouped under a title line per folder (A-Z, empty
  folders too), UNFILED last; each track row carries the shelf's keys (♡ via useMusicLibrary, [ ▶ PLAY ] via
  the one player, [ INJECT ] -> NewPostForm filed under the track). `+ NEW FILE` / `[ + NEW FOLDER ]` for an
  account (NewArchiveFileWindow / NewArchiveFolderWindow, folders from useArchiveFolders); `[ + FILE ]` on each
  folder's line; `?tag=` from a tag pill filters flat with `[ CLEAR ]`. Search and sort are the page's own.
  The AUDIO count is the catalogue's audio rows (the shelf's duplicate copies collapse: the point).
- app/components/MusicDirectory.tsx DELETED (Luke's OK). Checks updated: check-account-music (its directory
  section cut), check-flows / check-music-library / check-projects read MediaCatalogue; check-media-catalogue
  proves the shelves, keys, guest/account cases and the tag filter.
- scripts/media-migrate.cjs now also reads the `mp3` and `avatars` buckets (a hand-dropped file has no row
  anywhere else). Review: 12 items / 16 uses, i.e. one new audio row (a bucket file no table described);
  the `images` / `video` buckets are not read (a row-less file there was deleted on purpose). `--write` RUN
  2026-10-24 with Luke's OK: one row, `FRANCIS SAMPLE REMINSCING` (mp3 bucket root, 561KB); survivors 12 items
  / 6 audio / 16 uses. Its src was then corrected to the `%20` form the shelf's `getPublicUrl` spells
  (`encodeURI`), so the row and the shelf name the same file; the script now writes that form.
- Phone layout of the audio tab checked live after 2456bb7: a track's keys sit under its words, titles
  read in full (Temp/browse/titlebar/final-audio-390-b.png). Desktop: final-audio-1440.png.

---

# Latest: the media catalogue (SPEC-media-catalogue.md) - LIVE (f558bac), schema pushed, 11 files imported, verified on the deployed site
- Code: app/lib/media/* (types, rules, fingerprint, repository switch `NEXT_PUBLIC_MEDIA_DATA_SOURCE`, mock +
  Supabase stores, upload.ts, catalogue.ts shared store, uses.ts), app/media/page.tsx + MediaCatalogue.tsx +
  MediaUploadWindow.tsx, app/api/media/upload (mock store's route), MEDIA key in the top bar (ICON_MEDIA ▦),
  music window = MY MUSIC only (ARCHIVE is a link; MUSIC_HREF = /media?kind=audio), composers pick pictures from
  the catalogue and can upload one, the customiser's picture/song uploads go through findOriginal/recordMedia,
  uses recorded on filing (signed-in only; guests' uses come from the migration).
- Schema: supabase/migrations/20261024021600_media_catalogue.sql (buckets images/video, media_items, media_uses,
  RLS, realtime publication). PUSHED 2026-10-24 with Luke's OK (2 buckets, 7 policies, both tables published).
- Migration of existing files: `node scripts/media-migrate.cjs --review` writes Temp/media-migration.sql
  (14 addresses -> 11 items, 16 uses; 3 duplicate uploads found on the shelf). `--write` RUN 2026-10-24 with
  Luke's OK: media_items 5 audio + 5 pictures (migrated) + 1 sheet; media_uses 9 profile_picture, 3 profile_song,
  2 reply, 1 post. Live /media: ALL 11 / IMAGES 6 / AUDIO 9 / VIDEO 0, 33.6MB of 1GB, the sheet IN 7 PLACES.
  Pictures: Temp/browse/item-threads/live-media-1280.png + live-media-390.png.
- Live upload PROVEN (Temp/media-upload-drive.cjs, as TEST ACCOUNT A, 2026-10-24): a half-size copy of the
  sheet was flagged `THIS LOOKS LIKE "SHEET 01 // FIGURE STUDY"`, KEEP MINE uploaded it (`TEST UPLOAD // SHEET 01
  AT HALF SIZE`, 30KB), the post filed with it, /media lists it IN 2 PLACES (two test posts `TEST: CATALOGUE
  UPLOAD`, from two drive runs) and a second upload of the same bytes answers `ALREADY IN THE CATALOGUE`.
  The drive's last step (waiting for THREAD FILED) times out because the composer closes on success; the
  data was checked in the database and the browser instead. The two test posts, the test picture and its
  uses were DELETED 2026-10-24 with Luke's OK (listed first; survivors 11 items / 16 uses / 6 threads, as
  before the drive). The 30KB file itself is still in the `images` bucket under TEST ACCOUNT A's folder
  (storage rows are not deleted through SQL here; remove it from the dashboard if wanted). The new-post window got its upload key in ecfabe9 (it had
  been in the reply boxes only; PicturePicker.tsx now serves all three composers).
- Checks updated on purpose: check-flows (MUSIC_HREF), check-music-library (archive href), check-projects
  (shelf href), check-shell (six tabs). Known gaps: a profile song re-uploaded to the shelf is refused (the
  original is in the catalogue, not on the shelf); browser and sharp looks-alike hashes differ a little.

---

# Latest: item threads say what they are on; tracks are filing targets (2026-10-24, Luke's screenshot)
- Item-owned threads (empty body) are titled `COMMENTS ON <item>` whatever the row stores, and their strip
  is a *subject* (`ON` + the page owner's picture and name / the sheet's thumbnail and label / `♪ title`),
  which is the link to the item - the `[ ↳ GO TO ... ]` key is gone from the card. Rules in
  app/lib/forum/thread-subject.ts + post-layout.ts (`subject`, `lastActivityAt`), drawn by
  app/components/ThreadSubjectRow.tsx (PostAuthorRow got a `lead` prop). `postCredit` names the page
  owner for a profile anchor (site-author.ts `profileOwner`), still the site for a sheet's thread.
- New anchor kind `track`: app/lib/audio/forum-tracks.ts `trackAnchor` / `trackTargetKey` (`track:<src>`) /
  `trackTargets`; NewPostForm's FILE UNDER tree gains a MUSIC ARCHIVE folder from `useMusicPlayer().queue`
  and takes `initialTarget`; the music window's `[ INJECT ]` files under the track; board filter TRACK THREADS.
- GOTCHA (live DB): `forum_threads_anchor_key` allows ONE thread per non-board anchor. So the composer, for
  any item target, now files a *comment* on the item's one thread (opening it with autoThreadTitle + empty
  body, the track on the thread) - a titled post under a sheet used to hit a duplicate-key error. Title
  field hidden for item targets; `[ FILE COMMENT ]`.
- Checks updated on purpose: check-post-layout (section 6), check-profile-threads (owner credit, COMMENTS ON);
  both proven to fail with the fix undone.
- Review fixes (same commit): `displayTitle(thread)` (site-author.ts) is what the card, tile, newswire, search,
  pin panel and account/profile activity print; a thread with no comment yet says NO COMMENTS YET; the
  composer remembers threads it opened (`openedHere`), falls back to `addComment({ anchor })` if somebody
  else opened the item's thread meanwhile, and takes an opened thread down if its first comment fails.
- Live: 49247e9, checked in a real browser on debaser-site.vercel.app (`npm run read` cannot see board
  threads - they load client-side). NOT exercised live: actually filing a comment under a track (a DB write).
  Known change to tell Luke: a track filed under rides on the thread, so the music directory's
  "how much is this one around" count no longer grows per INJECT to the same track.

---

# Latest: the window keeps clear of the guest strip and the player bar (016975f) - live, verified on the deployed site
- Luke asked (2026-10-24): the guest banner covered the board window's title on shorter screens. Measured: on the old
  live site the title was under the strip at 7 of 8 sizes (every phone; only 1440x900 was clear), and on short desktops
  (1366x600) the player bar covered the taskbar.
- How: `app/lib/ui/use-edge-reserve.ts` publishes how much of the screen a fixed strip covers as `--top-bar`
  (GuestPrompt) / `--bottom-bar` (MusicPlayer's DockedBar) on <html>; SiteWindow's main is now `h-dvh flex-col` with
  a spacer at each end and the window `my-auto` (shrinks to fit, floor 16rem). No strip: top 0, foot 4rem as before.
- Proof: verify; checks 73/73; audit unchanged (12 LOW + 1 heuristic). Scratch measurement (scratchpad
  banner-resize.cjs: real resizes in headless Chrome, 8 sizes 360-1440 wide) fails 7/8 on the old live site and passes
  8/8 locally and on the deployed site. Live pictures: Temp/browse/eff-check/live-*.png (guest 1100x700 + 390x844,
  signed in 1366x600).
- Gotcha: the Browser pane, while hidden, never runs a rendering step, so a ResizeObserver there never fires - test
  resizes in headless Chrome (playwright), not in the hidden pane.
- `npm run read`'s default expectation was `[ ♪ MUSIC ]`, which the efficiency pass cut from the docked bar, so the
  bare command failed. Defaults now: `♪ PLAYER`, `+ NEW POST` present; `[ SHELF (60) ]`, `POINT AT IT TO STOP` gone.
- Done 2026-10-24 (Luke: "finish up anything that needs to be done"): the six merged, clean agent worktrees under
  `.claude/worktrees` were removed (`git worktree remove` + prune; each had 0 commits off main and no changes).
  Two detached app-made ones (determined-bartik, sharp-cartwright) were left: not this session's to remove.
- Known before QA, not fixed (artwork slots, Luke's to fill): every page 404s on 4 slot files - /assets/sprites/
  walk-cycle.gif, /assets/profiles/avatar-default.png, /assets/icons/google-retro.png, /assets/sprites/profile.gif.
  The slots fall back (hatched NO PICTURE, the [ ? ] Google key); no page error, just console noise.

---

# Latest: efficiency pass (SPEC-efficiency.md) - all five steps LIVE, reviewed, verified on the deployed site
- Commits: c42208c bracket keys; f4cd5c9 flatten; b9bf0b9..b835598 the cut list; 42161bc IBM Plex Mono + docs;
  00c126f font sweep; cdfe91a fixes from the fresh-context code review.
- Proof, every step: verify, 73/73 checks, audit 12 LOW + 1 heuristic line (the word "crawl" in the newswire's
  tip; the crawl behaves as before), contrast: dark clean, bright flags only moldavius figtree's own pink name.
  Deployed: `npm run read` on /forum (11 removed sentences gone, new controls present) and /notes ("IBM Plex
  Mono" served); in a browser the live site loads IBM Plex Mono 400 only and keys have no outline.
  Pictures: before Temp/browse/eff, after Temp/browse/eff-after (64 guest + 28 signed in, 1440/390, both
  themes), live Temp/browse/eff-live (+ player-1280.png: the bar fits on one line at 1280).
- The phone board shows the first post on the first screen (it was below the fold).
- Font sweep found and fixed: [+]/[-] fold slots (16px -> 24px), the Google key's icon slot, long unbroken
  strings in posts/replies/messages/bios (now `wrap-anywhere`). Scan: `node Temp/eff-shots.cjs --no-shots
  --overflow` (page sideways scroll, spilling keys and text) - clean at 390 and 1440, guest and signed in.
- Review fixes (cdfe91a): keys on Rose rows were 3.97:1 / 1.99:1 - a Rose surface now sets White for its keys
  via the inherited dials `--key-ink`, `--key-hover-ink`, `--key-quiet-ink` (measured 4.70:1 both themes,
  Temp/eff-rose.cjs); QUEUES had no control from 640-767px (now in the Start and profile menus); AROUND THE
  ARCHIVE cut; a board that cannot be read shows a Rose chip (ForumProvider `loadError`); close keys `[ × ]`.
- The review fixes were checked live: /projects/debaser no longer serves AROUND THE ARCHIVE; the deployed
  overflow scan is clean. check-shell now counts three windows in the Start menu (proven to fail with QUEUES
  taken out).
- Review leftovers, done 2026-10-24 with Luke's yes (d0a2469, live; verify, 73/73 checks, audit 13 as before,
  contrast unchanged, the drive below passes against the deployed site): a disabled bracket key carries a dotted rule under its
  words (same quiet ink: 15.71:1 dark, 17.83:1 bright, 4.70:1 on Rose); the board's TAGS and SORT / SEARCH
  panels sit in the tab order straight after their keys (before + NEW POST) and ESC closes them and hands
  focus back to the key; the reply form inside an open post has no box (the field keeps its frame).
  Proof: `node Temp/eff-keys-drive.cjs [base]` (14 steps in a real browser, Tab/ESC and the disabled keys,
  both themes, a Rose row signed in); check-surreal and check-board-comments hold all three, each proven to
  fail with its fix undone (`node Temp/prove-leftovers.cjs`, 4/4 caught). ConceptSheetFrame keeps its frame
  (artwork windows, on purpose).
- Decisions to tell Luke: hover ink on a filled key is `paper`, not Black (Black on Royal Blue is 2.2:1);
  disabled keys use the quiet ink, which on the dark theme (Flavine) is close to Daffodil; the taskbar is
  gone on a phone; GuestOffer.tsx deleted (spec cut); arcade's second game-plate row cut (cards cover every
  path); MIXTAPES tab cut; customiser success messages replaced by a 2s SAVED; board sync errors are not
  shown (ForumProvider swallows them - needs its own change).
- Fixed in passing: a garbled `Ã—` on the board's included-tag keys (live bug).
- ~22 checks updated on purpose, each with a dated comment. Scratch tools: Temp/eff-shots.cjs (`--keys`,
  `--overflow`), Temp/run-one.cjs. Leftover worktrees under .claude/worktrees (builder-shell + agents) can go.

---

# Before that: theming framework (docs/theming.md) - live (e1087a0..dba4496), verified on the deployed site
- Proof: verify passes; checks 73/73; audit 12 LOW (unchanged); 116/120 style recordings identical, the other
  4 differ only by account state (QUEUES window open, a presence lamp); 87/87 class pairs identical; the guard
  caught 20/20 + 9/9 planted violations. `npm run read`: /specimen and the new /notes wording are served.
  Screenshots: Temp/browse/theming-before, -after, -live.
- Temp/check-mobile.cjs had no `npx tsc` header line, so it had rendered a 2026-09-24 compile of the shell for
  a month (a stale pass). Header added; proven to fail with the nav glyphs' tap size removed.
- Review fixes done (dba4496): guard reads bracketed variants and `!`, refuses switched-off sizes
  (text-xs...) and hand-written look properties; `npm run styles --compare` fails on a changed tree;
  RadioLoops face key h-tap; /notes names app/theme/fonts.ts; docs wording.
- Known, not done: scripts/qa-audit.cjs's contrast table is a hard-coded Win95 palette (says nothing about
  today's colours); TagBadge's compact chip still carries px/py/tracking pairs that resolve as before.
- Every look value lives in `app/theme/tokens.css` (dials, generated colour block, faces by job, type,
  spacing, lines, layers, motion), `app/theme/fonts.ts` (the loaded face, `--face-pixel`) and
  `app/lib/ui/themes.ts` (`DYES` + the two themes). `npm run tokens` (inside verify) refuses raw values
  elsewhere; `-- --write` regenerates the colour block after a themes.ts change. `/specimen` (unlisted)
  shows every token in both themes with measured values.
- Sweep: 979 class renames in 119 files (`text-[13px]`->`text-label`, `py-[2px]`->`py-0.5`,
  `border-black`->`border-ink-plate`, `border-2`->`border-line`, `max-sm:min-h-11`->`max-sm:min-h-tap`,
  `z-[90]`->`z-dock`...), plus globals.css onto var()/--spacing(). Scripts that did it were scratch only.
- Proof: `npm run styles` (new, scripts/style-snapshot.cjs) recorded 15 pages x desktop/phone x both
  themes x guest/signed-in before and after. Also a pairwise proof (each old/new class pair in a browser)
  and a Tailwind sort-order proof (scratch).
- Gotchas found: an `@theme` `--color-*: initial` placed after the colours wiped them all (guard now
  refuses a second reset); renamed named steps sort *before* their siblings where brackets sorted after,
  so two elements changed (compact tag chip gap, side panel log-in key) until the losing class was removed.
- Not done / follow-ups: `ACCENT_COLOUR` is still Royal Blue on 4 sliders/checkboxes (1.91:1 on the dark
  theme) - the `--color-accent` token exists; CountryFlag's 9px letters; ~450 inert `font-bold`s (a face
  with a bold would turn them on); dead CSS in globals.css (`.plate*`, `.glyph-button`, `.shelf-chip`,
  `.bevel-*`, `.field-tight`, `.window-title-bar*`: components use controls.ts strings) - kept, tokenised.
- Checks updated on purpose (each with a dated comment): themes, surreal, palette-and-fault, post-reel
  (read tokens.css too), board-comments, notifications, shell, mobile, ux, stamps-and-colours,
  window-layout (renamed classes), structure (ACCENT_COLOUR = DYES.royalBlue). New: Temp/check-specimen.cjs.

---

# Before that: errors are Rose chips (d6bef89) - live, verified on the deployed site, desktop + phone, both themes
- Luke picked option A of three (2026-10-23): every Rose *word* line (errors, refusals, warnings, the comms
  unread count, game notes) is now `bg-bubble-pale px-1 text-ink-bar` (+ `w-fit` on blocks), 4.70:1 in both
  themes. Was Rose words: 3.79:1 on Nigrosine, 4.14:1 on Flavine. 25 components; TicTacToe's O left Rose.
  TagWindow's failing rows keep the panel + field ink and chip only `[ FAIL ]` (a Rose row would put Black
  detail text on Rose, 4.47:1). Boxed messages (GameMatch, GamesHub, LorePageView) became Rose boxes.
- Held by `Temp/check-themes.cjs` section 6 (no `text-bubble-pale` in any class literal outside TicTacToe),
  proven to fail with one line reverted. docs/design.md says "Faults are Rose chips". 71/71 checks.
- `npm run contrast` /forum + /account: dark passes; bright flags only moldavius figtree's pink name (pre-existing).
  Error chips don't render on those pages by default, so they were measured by pressing LOG IN empty on
  /account (validation stops before anything is sent): 4.70:1, fits at 390px, local and deployed.

---

# Before that: readability pass (SPEC-readability.md) - all six steps live (0674210 .. a17c3b9) + review fixes (f8d9323)
- Review fixes (fresh-context code-reviewer): player screen lines fit (TrackDetails 46px box, 14px lines); title-line
  extras may wrap on a phone; PLATE_MAIN / PLATE_ACCENT carry a Black outline (Daffodil on Flavine was invisible in
  the bright theme); Rose danger keys are `key-fill` pills; `key-on` (PLATE_PRESSED) keeps a picked+disabled pill
  solid. 71/71 checks after; live confirmed with `npm run read`.
- Settled 2026-10-23 (2cbece3): on /account LOG IN is the one filled main action; CREATE ACCOUNT is outlined. Still open:
  Drop shadows were removed though the spec never asked (Gnorp has none) - say if he wants them back.
  /notes copy (app/lib/projects/notes.ts:104) still says the face is Silkscreen - a wording change, not made.
  (Done in d6bef89, see top) Rose error text (`text-bubble-pale`, ~30 places) is under 4.5:1 on both themes' fields - older than this pass,
  needs a colour decision (proposed as its own task).
- Done: DotGothic16 (font-synthesis none; 13px floor, writing 15px/1.5, titles 16px); dark is the fallback theme
  (`FALLBACK_THEME`, ids unchanged); `.frame` notched outline (background stripes, NOT clip-path - so never put a
  `border-*` colour utility on a framed element); `.title-line` (rules are ::before/::after; extras get their own
  row on a phone via :has, except `.title-window`); `.key` / `.key-fill` / `PLATE_MAIN` (new) in controls.ts;
  no wobble/bump on labels; flat scrollbar grip. docs/design.md rewritten.
- How it was done: exact-string codemods (scripts kept only in that session's scratchpad). Sizes 9-10px->13,
  11-12px and text-xs->14, prose hand-set to 15px. Hand-written bevels -> frame/key; navy section bars -> title-line.
- Checks updated on purpose: profile-layout (status line = the STATUS_BAR constant), themes (stylesheet == fallback),
  palette-and-fault + surreal (read the *bright* theme from themes.ts, not globals.css), surreal (new key vocabulary,
  no hover animation), shell (open tab = filled pill), structure (PLATE_MAIN). Each proven to fail on a break.
  npm run checks 71/71. Audit: no text under 13px; 12 LOW tap-target notes (pre-existing kinds). Contrast tool:
  dark theme passes on 8 pages incl. music/arcade windows; bright fails only moldavius figtree's pink name (account's
  own colour, pre-existing).
- Decided while building (tell Luke): bright-theme active titles are Royal Blue, not Daffodil (Daffodil on Flavine is
  ~1:1). Dark theme: read posts and disabled plates are Black (were Royal Blue). Main action hovers Emerald.
  PLATE_LARGE stayed outlined (it is used for sign-out/delete too); PLATE_MAIN is the filled one.
- Not checked: a lore page and its editor (no lore pages filed; making one is a DB write). Signed-in phone windows
  were only spot-checked (customiser). TEST ACCOUNT A's saved layout now has its windows closed (screenshots closed them).
- Leftovers: 1px black hairlines on coloured badges (fine); `font-bold` is still in ~500 class lists (inert).
  Fixed 2026-10-23 (c0bb2cc, live): the phone player's blue header strip (now the card fill + accent-ink name +
  rule), the side panel's ACCOUNT DIRECTORY wrap (`.title-stack`: count on its own row), /notes naming Silkscreen.

---

# Latest: command center (SPEC-command-center.md) - pushed (901f6cc, 7c41331, 763e121); no site code changed
- CLAUDE.md is gone: `.claude/rules/core.md` (every session), `frontend.md` (tsx/css/app/lib/ui/design.md),
  `backend.md` (api, route.ts, supabase-*/mock-*, supabase/**). Seen loading by area in the build session.
- Seven agents in `.claude/agents/`; cap of 10 a session (`.claude/hooks/agent-limit.cjs`, one slot file per launch
  in %TEMP%\claude-agent-limit, made with 'wx' - a single counter let 17-20 of 20 simultaneous launches through).
  A launch refused for a bad agent type still uses a slot (the hook runs first).
- `~/.claude/settings.json`: cleanupPeriodDays 365, env BASH_MAX_OUTPUT_LENGTH 150000 (merged; the app also keeps
  skipWorkflowUsageWarning and autoUpdatesChannel there).
- Temp/check-post-reel.cjs and check-reveals.cjs now read `.claude/rules/frontend.md` (rule moved, not changed;
  both proven to fail with the reveal rule removed). npm run checks 71/71 before and after.
- Needs a fresh session to confirm: core.md is in the instructions from the start (ask "what are the database
  rules?" before any file is opened). Auto mode refuses edits to `.claude/` as self-modification - switch modes.

---

# Before that: hidden test accounts (SPEC-test-accounts.md) - live (99bc406, f88f47d, 0357516, cf022d8), verified on the deployed site
- DB (Luke's OK): C and D made; migration 20261021000032 pushed - profiles.is_hidden, a guard trigger that refuses any
  change to it from a visitor's request, A-D marked (4 hidden).
- Lists: everything that lists people reads `accounts` from CommsProvider = `listedAccounts()` (app/lib/auth/hidden.ts).
  Lookups by id use `allAccounts` / `nameById` (names, join date, ?challenge=<id>). Presence is NOT filtered (that
  broke a test account's lamp and ?challenge=<id>; caught by the fresh-context review, fixed in 0357516).
- Mock: seeded hidden person `mock-test-account` (TEST ACCOUNT (MOCK)), flagged hidden, left out by listedAccounts.
- Scripts: 12 Temp scripts sign in as A-D (`testAccountClient` in scripts/browser.cjs, signOut scope local), clean up
  only their own rows; signup-mail-probe deleted; browser.cjs has no throwaway fallback. Checks never make accounts.
- Tests: Temp/check-hidden-accounts.cjs (in npm run checks; 4/4 breaks via Temp/prove-hidden-breaks.cjs);
  Temp/hidden-drive.cjs [url] [--mobile] (browser: /users, side panel, tag pickers, comms pickers, WHO IS AROUND with B
  online, ?challenge=<B>; caught every list with listedAccounts broken in a prod build, and the challenge step with the
  old presence filter). npm run checks 71/71, accounts 19 -> 19. `npm run read --absent "TEST ACCOUNT"` on /users passes
  even without the change (the list is client-drawn) - the drive is the real proof.
- Done 2026-10-22 with Luke's yes: the sweep removed the 6 cline-library-* leftovers (13 accounts remain: 9 people +
  A-D); migration 20261022000033 (cf022d8) makes the guard refuse a visitor deleting a hidden profile row too (the
  heartbeat would have re-created it unmarked). The check tries that delete; HIDDEN_BREAK=delete proves it (5/5 breaks).
- Still Luke's call, not built: the music QUEUES tab and a lore page's IN THE ROOM line can name a test account while it
  broadcasts / edits; typing "@TEST ACCOUNT B" does not tag.
- Gotchas: on the dev server presence flickers (double effects), so test presence on a prod build. Signed in as A, A's
  saved window layout opens music + preferences over the board - press controls directly. check-realtime-events' last
  assertion (event '*' never delivered) fails for a Supabase reason, unrelated. TEST ACCOUNT A's bio was blanked once.

---

# Latest: 50 PX is now 12 PX (8d716f7) - live, verified on the deployed site, desktop + phone
- Luke asked for it (2026-10-21). `PANEL_PIXELS` = 12; label `12 PX`, hint BIGGER PIXELS. The id stays `fine`.
- Now coarser than the default on every pane: 11 x 13 pixels a view (was 31 x 38), PIXELS on BASE 167 -> 16.
- Checks updated on purpose (pixel, frame, layers, char-drive, pixel-shots): bigger blocks, PIXELS goes down, "about" within 1.

# Before that: 50 PX layer - finished, live (784f178), verified on the deployed site, desktop + phone
- New LAYERS switch `50 PX` (id `fine`, off by default, beside PIXELATE): the block size comes from the pane, each view's
  longer side about 50 blocks (`PANEL_PIXELS`, `Math.round`). Rests while PIXELATE is off (`layerRests`, which now
  also holds NORMAL LIGHT's rest). PIXELS counts at whichever size shows. Touching / sag / validity are unchanged.
- Measured in Chrome (1x, desktop pane): 31 x 38 -> 42 x 50 pixels a view; PIXELS on BASE 167 -> 296.
- On a very wide pane (620px+) 50 across the long side can be *coarser* than the default; the rule as asked, noted
  in check-character-pixel's output.
- Checks updated on purpose: pixel (new 50 PX section, defaults), frame (50 PX frames), stages + layers (the call /
  `layerRests`); char-drive has a 50 PX step; pixel-shots has a `2b-fifty-px` picture. 4/4 deliberate breaks caught.

# Also live: phone tap targets and 9px text from the QA audit (4a96106)
- The 8 real items from the audit's 24 LOW findings (row-shaped controls now 44px on a phone, 9px text raised to 10px).
- Throwaway sweep done 2026-10-20 with Luke's yes: 32 removed; 11 accounts remain (TEST ACCOUNT A and B among them).

# Before that: simple figures (SPEC-simple-figures.md) - finished, live (773be7d), verified on the deployed site, desktop + phone
- Presets are BASE / GOBLIN / ROBOT / GUY, 5 shapes each; caps 7 shapes / 7 nodes; shelf key v3 (old shelves ignored).
- Placing: ADD -> shape -> click a node -> drag anywhere -> ✓ / ✗ (ESC = ✗); +NODE the same. One undo step each.
- Touching (GJK on real outlines), levels, validity (blocks saving with a named reason), sag (drawn only), PIXELS (read
  back from the front render) and SAG %. How it all works and its traps: `docs/character-figures.md`.
- UI: SKELETON moved into LAYERS; shapes list folds (`SHAPES 5/7`), rows select; stats bar under the views; broken
  things marked rose; DELETE NODE (POSE, a node picked) asks first when shapes would lose their node.
- Decisions with Luke's OK: unpinned shape = broken; a new node's ✓ is never greyed; per-shape sag weight is the
  outline estimate; every sagger drags its support; click-to-place ADD is gone; drag from anywhere while placing.
- Decided while building (tell Luke): SAG % is measured against a quarter turn, not each shape's own angle to hanging
  (that reading made the number fall as an arm swung out). GUY's shirt is flavine, not rose (rose marks broken things).
- Tests: `Temp/check-character-simple.cjs` (20 tests, proven by `node Temp/prove-simple-breaks.cjs`: 20/20 breaks caught);
  10 older character checks updated on purpose (each says why); `Temp/char-drive.cjs [url] [--mobile]` (30 steps).
- Fresh-context review fixed: "NODE NODE 4" wording (`nodeName`); sag chains could swing past hanging and SAG % missed
  the carried turn; LOAD mid-placement left ADD pressed; the save refusal could reappear unasked; one ESC closed the
  pad AND cancelled the placement. Not changed (nothing is lost): closing during "click a node" does not ask first.
- Deployed proof: char-drive.cjs against https://debaser-site.vercel.app passed every step, desktop and phone (80 phone
  controls all 44px+). Sweep review: 11 accounts remain, nothing to remove.
- (Fixed in 350c4b1) The overlays (skeleton, outlines, marks) were tone-mapped by R3F and drew off their palette
  values. The canvas is now `flat`: they are exact, the figure is pixel-for-pixel unchanged, and char-drive counts
  the exact values (the ✗ button's box is left out of the rose count).

# Before that: ADD shape menu (5123ee1) - finished, live, verified desktop / tablet / phone
- ADD in the tool strip is now `AddToolButton` (`app/components/CharacterViewport.tsx`): a pop-up menu of the
  7 shapes (beside the button on desktop, under it below `lg`, two columns on a phone). It closes on a pick, ADD
  again, a press elsewhere, ESC (caught before the customiser) or Tab-out. The options bar only names the shape in hand.
- Tests: `Temp/check-character-render.cjs` (ADD shut on arrival, no shape buttons in the bar; its section-heads
  filter now skips ADD, which also has aria-expanded), and `Temp/char-drive.cjs` (the menu opens, a pick shuts it).
  Pictures: `node Temp/addmenu-shot.cjs [url] [--mobile|--tablet]`.
- SPEC-simple-figures.md builds its placement flow on this menu (now built, above).
- No throwaway accounts to sweep (review: 11 remain, nothing to remove).

---

# HANDOFF - live pixel render in the character workbench (SPEC-pixel-render.md)

## Done and live (main 4630025, 04879ce, 403f386 - verified on the deployed site, desktop + phone)
- Both views draw the Dead Cells render every frame:
  - a tiny colour pass and normal pass (the tallest preset is 27-29 blocks)
  - a 3-band cel light pass
  - hard square blocks
  - no outline, no composer
  The SHAPES / FINAL switch is gone. The aids (grid, transform box, skeleton) draw crisp over the pixels, and
  picking hits the real shapes.
- LAYERS: PIXELATE (off = full size, multisampled, smooth), NORMAL LIGHT, NORMAL MAP. One ☀ opens a d-pad:
  45°/30° steps, clamped at ±60°, reset, LIGHT ON/OFF. It closes on ESC (not the customiser), a press elsewhere,
  ☀ again, or Tab-out. A sun mark sits at each view's edge.
- UI pass:
  - the strip is EDIT / POSE / HISTORY
  - the sentences moved to tooltips
  - properties fold into SHAPE / COLOUR / PIN / NUMBERS (NUMBERS folded and last)
  - the figure panel is NEW FIGURE + skeleton
  - the long intro sentence above the workbench is gone
- Default light moved onto the step grid (-45° round, 30° up), with Luke's OK.
- `@react-three/postprocessing` and `postprocessing` are uninstalled (only the old pass used them).
- How it works and its traps: `docs/character-render.md` (linked from CLAUDE.md).

## Tests
- `npm run checks` (67):
  - `Temp/check-character-pixel.cjs`: size, steps, bands, block alignment with real cameras
  - `Temp/check-character-frame.cjs` (new): a real frame against a recording renderer
  - stages / layers / render: rewritten for the layers
  - both new checks proven by deliberate breaks (5 + 4, all caught)
- Browser: `node Temp/char-drive.cjs [url] [--mobile]`, which measures each switch's pixels, the d-pad, and
  ESC/Tab. It now actually reports console errors (it never did before).
- `node Temp/pixel-shots.cjs [url] [--mobile]` takes one picture per state. `npm run stages` measures the 4
  layer states.

## Waiting on the owner
- Nothing. (Done 2026-10-18, Luke's yes) Throwaway sweep: 22 removed (20 from these checks, plus 2 `cline-library`
  from the windows session's last check run, which had finished). 11 accounts remain, TEST ACCOUNT A and B among them.

## Gotchas
- (Resolved) The SHAKE_WINDOW 500 -> 700ms edit in `app/lib/ui/window-layout.ts` was the windows session's;
  it is committed and pushed as e24dee0.
- Files here are CRLF on disk (autocrlf). A script that string-matches source must allow for `\r\n`.
- `npm run read` cannot see the workbench: it is `ssr: false`, behind CUSTOMISE -> CHAR. Use char-drive.
- SPEC.md (character creator) and SPEC-windows.md belong to other sessions; leave them alone.

---

# Separate task: snapping, resizable docked windows (SPEC-windows.md) - finished

- Live: 42d6bad, 39aca2d, e24dee0. `window_layouts` table pushed with Luke's OK (RLS, own row only).
- Store `app/lib/ui/window-layout.ts`, host `app/components/WindowLayoutHost.tsx`, saving `app/lib/windows/*`.
- Tests: `Temp/check-window-layout.cjs` (in `npm run checks`); real mouse `node Temp/windows-e2e.cjs [url]
  [--width W --height H] [--phone] [--account A|B]`; isolation `node Temp/windows-b.cjs`.
- Shake = 4 turns of 14px+ within 700ms. Waiting on Luke's feel test only.
