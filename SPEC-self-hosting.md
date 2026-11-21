# SPEC: hosting DEBASER_OS from Luke's PC (self-hosting)

Luke, 2026-11-17: "okay lets start hosting it from my pc". Interviewed the same night; his answers are quoted below.
Status: **waiting for Luke's OK.** Nothing has been installed or changed yet.

## Why now
Since 2026-11-17 22:11 UTC the free Supabase project answers every data, sign-in and file request with
"402 restricted: exceed_cached_egress_quota". About 13 songs (75 MB) streamed over and over used up the month's 5 GB
file-serving allowance. The whole site's data and sign-in are down. Supabase lifts the block by itself when the month
resets (probably around 20 Nov; the Supabase Billing page shows the date), or at once on an upgrade to Pro.

What still works under the block (checked 2026-11-17, read-only):
- The database can still be read through Supabase's management route: a full `npm run db:backup` finished at 23:20
  with nothing failed (every table, 9 accounts with their password hashes, the list of 38 stored files).
- The stored FILES cannot be read: the file service sits behind the same block.
- The 04:00 backup that morning failed (empty folder). The 15:45 and 23:17 copies are complete.

## Luke's decisions
| Question | Answer |
| --- | --- |
| What moves | **Everything at once**: pages, database, sign-in, files, all on the PC. |
| Until it's ready | **Stay down**: no Pro upgrade, no payment to Supabase. |
| Address | **debaser.site**, bought by Luke on Cloudflare (checked: Cloudflare's name servers answer for it, no records yet). |
| PC off | **Down is OK** while the PC is off, asleep, updating or restarting. |
| League | **No limits** on the server during a match. |
| Backups | **Google Drive and a backup folder on the large external drive**; "most heavy site stuff should be clearly stored on there". |
| Locked files | **Move now, copy the files later**, when the block lifts. |
| After a restart | **Sign in automatically**, so the site comes back by itself. |
| Where the database lives | **Database on G:, heavy things on I:**. |
| Updates | **The PC rebuilds itself** from `main`. |
| Vercel | **Keep it as the way back**: left in place for a month, unused. |
| Upload speed | Measured: **about 54 Mbit/s up**, 240 down, 31 ms to Cloudflare. That's ample: one song stream takes about 0.3 Mbit/s. |

## The setup
```
 visitor ──https──> Cloudflare (debaser.site) ══ tunnel (outgoing from the PC; no router ports open) ══╗
                                                                                                       ║
 Luke's PC  ╔══════════════════════════════════════════════════════════════════════════════════════════╝
            ║  cloudflared (Windows service)
            ╠══ debaser.site      -> the site (Next.js `next start`, port 3000, Windows, node 24)
            ╚══ api.debaser.site  -> Supabase (Docker Desktop: database, sign-in, files, live updates)
                                     Supabase's own dashboard (Studio) on this PC only, never public
```
- **The site** runs as it does on Vercel, with `next build` then `next start`: Next's own self-hosting guide says
  everything the site uses works there (all 30 server routes already run on Node, none on Vercel's edge; picture resizing
  works; no Vercel-only packages). A small tracked script keeps it running and restarts it if it crashes, and starts
  with Windows sign-in (a scheduled task).
- **Supabase** is the official self-hosted version (Docker), so the site's code stays as it is: the same database with
  all 123 migrations and 59 functions, the same Row Level Security, Google and email sign-in, file buckets, and live
  updates (presence, broadcasts, row changes). It runs in Docker Desktop (free for personal use), which runs Linux in
  the background on Windows 10 Home. Its logging add-on (the heaviest part) is left out to save memory.
- **The tunnel** (Cloudflare Tunnel, free) is a program on the PC that dials out to Cloudflare; visitors reach the PC
  through it. No ports opened on the router, the home address stays hidden, Cloudflare supplies the https padlock and
  soaks up junk traffic. Live updates (websockets) pass through it.
- **Where things live** (Luke's "clearly stored"):
  - `G:\DEBASER-HOST\` (fast internal SSD, 72 GB free): the database, Docker's disk (about 15-25 GB), a clean copy of the
    site that the PC builds from (separate from the working copy the sessions edit), the settings files with secrets.
  - `I:\DEBASER\` (the large external drive, 3.5 TB free): `files\` (songs, avatars, pictures, character files, stream
    art), `backups\` (daily), `caches\` (anything big MEDIA keeps later). A database on a USB disk would slow every page
    and can be damaged if the cable slips, so it stays on G:.
  - C: has only 16 GB free, so Docker is told to keep its disk on G:, not C:.
- **New keys**: the self-hosted Supabase gets its own secret signing key, its own public "anon" key and its own
  database password. A script generates them straight into a gitignored settings file on G:; they are never printed,
  logged or committed. The public anon key and `https://api.debaser.site` go into a `.env.production.local` file on the
  PC only, so the committed `.env.production` keeps pointing Vercel at the old project (that's what keeps Vercel as the
  way back).
- **Updates** (Luke: the PC rebuilds itself): every 5 minutes a scheduled task checks `main`. When there's a new commit it
  builds it in a second folder while the old one keeps serving, then swaps (a few seconds' blip). A failed build changes
  nothing and is written to a log. `npm run deploy-status` and `npm run read` are changed to ask debaser.site which commit
  it is running, so sessions keep the same loop.
- **Schedules**: the hourly MEDIA fetch, sweeps and tagging are database timers (pg_cron) that call the site; they are
  re-pointed from `debaser-site.vercel.app` to the site on the same PC.
- **Emails** (sign-up and password mails): the self-hosted sign-in uses the same Resend mail account as now. "Confirm
  email" stays off, as today.

## Step by step
Each step is proved before the next. **L** = Luke does it (installers, admin prompts, passwords, keys, payments,
Windows and Cloudflare settings). **C** = Claude does it. Every Windows, Cloudflare, Google, Vercel or Supabase change
is asked for in chat first, even with this spec OK'd.

**Stage 1: the PC ready** (about an hour, mostly downloads)
1. L: Install Docker Desktop (it turns on Windows' Linux layer and needs one restart). Settings: start at sign-in; disk
   image on `G:\DEBASER-HOST\docker`. C gives the exact clicks. Proof: C runs `docker run hello-world`.
2. L: Install cloudflared (Cloudflare's tunnel program). Proof: `cloudflared --version`.
3. C: Create `G:\DEBASER-HOST\` and `I:\DEBASER\` and the clean copy of the site.

**Stage 2: Supabase on the PC, empty, private** (an evening)
4. C: Set up the official self-hosted Supabase (pinned version, Postgres 17 like the cloud project if that release offers
   it, otherwise 15 with every migration tested), logging add-on off, files saved to `I:\DEBASER\files`, the database and
   dashboard reachable from this PC only. Generate its secrets into the settings file. Proof: every container healthy;
   the dashboard opens on this PC.
5. C: Copy the cloud's structure into the new, empty database. (Done differently from first planned, 2026-11-18: the
   migration chain alone can't rebuild it, because the first sections came from `schema.sql` and the `game`/`ink` schemas
   from the game's own repository. So the structure is `supabase db dump`'s copy of the cloud, read-only, plus the parts
   that dump leaves out: the two triggers on `auth.users`, 46 policies on files and live channels, the 8 buckets, the
   migration history, and an exact copy of every permission.) Then compare columns, functions, policies, triggers,
   indexes, permissions, row security, live-update tables and extensions with the cloud (`scripts/host/compare-structure.cjs`).
   Proof: the comparison comes back empty.
6. C: Run the site locally against it (dev mode on this PC, no tunnel yet) with an empty database. Proof: pages load,
   every call to the PC's Supabase answers, the live-update connection opens, a test sign-up makes its profile.

**Stage 2 result (2026-11-18, ~02:30):** Supabase self-hosted v0.8.4 (Postgres 17.6) on the PC, 11 parts healthy, ~1.5 GB
of memory. Structure identical to the cloud: 839 columns, 209 functions, 390 policies (5 differ only in brackets), 66
triggers, 244 indexes, 1,317 table / 3,636 column / 388 function permissions, 23 live-update tables. The PC's copy of the
site loaded /forum and /media against it with every call answered, the live-update socket open, nothing sent to the cloud.
A probe account signed up and in, got its profile from the trigger, and was removed. Also found: the direct database
connection to the cloud still works under the block, so Stage 4 can take a proper full copy, not only the JSON backup.

**Stage 3: the address** (half an hour)
7. L: In Cloudflare: Zero Trust -> Networks -> Tunnels -> create a tunnel "debaser-home"; Cloudflare shows one install
   command with a long token: Luke pastes it into an admin Command Prompt himself (the token is a key; Claude never
   sees or types it). Then add two public hostnames: `debaser.site` -> `http://localhost:3000`, `api.debaser.site` ->
   `http://localhost:8000`. (Zero Trust's free plan may ask Luke to pick the free plan, and sometimes for a card; it
   costs nothing.) Proof: C reads `https://api.debaser.site/auth/v1/health` from outside.
8. L: Google Cloud console -> the existing OAuth client -> add `https://api.debaser.site/auth/v1/callback` to the
   redirect addresses, and `https://debaser.site` to the allowed origins. Then type the same Google client id and secret
   into the self-hosted settings file (C shows which line; Luke types it). Same for the Resend key and the outside API
   keys the site's server uses (TMDB, YouTube, Twitch, Anthropic, Giphy, the shadow proxy, WEB_FETCH_CONTACT). Found in
   Stage 2: only the shadow proxy's two are in `.env.local`; the rest live only in Vercel's project settings, so Luke
   copies each from Vercel (Settings -> Environment Variables) into `G:\DEBASER-HOST\site\.env.production.local` himself.

**Stage 3 result (2026-11-18, ~03:15):** done differently from step 7 above, to save Luke clicks and keep the rules in a
file: Luke clicked Authorize once (`cloudflared tunnel login`), then the tunnel `debaser-home` was made from the command
line, with DNS for `debaser.site` and `api.debaser.site`, and its rules in `G:\DEBASER-HOST\cloudflared\config.yml`:
`api.debaser.site` passes only `/auth|rest|realtime|storage|graphql/v1/`, so Supabase's dashboard answers 404 from outside.
It runs from a logon task (`DebaserHost` -> `start-hidden.vbs` -> `keep-running.cjs`, which restarts it and logs to
`G:\DEBASER-HOST\logs`), not a Windows service: Docker also starts at sign-in, so a service would gain nothing. Proved from
outside: auth health 200, a table read 200, the live-update socket upgrades (101), the dashboard 404. Google console (via
Chrome, saved and re-read): origin `https://debaser.site`, redirect `https://api.debaser.site/auth/v1/callback`, old ones kept.
Google sign-in starts and reaches Google's own sign-in page with no redirect mismatch. Sign-in settings copied from the cloud
(guests, manual linking, 6-character passwords, Resend sender). Luke pasted the new Google secret and Resend key into a paste
file that `scripts/host/merge-pasted-keys.cjs` moved without printing. Vercel's server keys are marked sensitive and can't be
pulled (they came out as a placeholder), so only the shadow proxy's two came across (from `.env.local`); TMDB, YouTube,
Anthropic and Giphy keys come from each provider's page into `G:\DEBASER-HOST\site\paste-keys-here.txt` (`merge-pasted-keys.cjs site`).
Twitch's keys and WEB_FETCH_CONTACT were never set in Vercel (Twitch uses its keyless fallback). Done after Stage 4 (2026-11-18): Luke pasted the TMDB, YouTube, Anthropic (a new key) and GIPHY keys; each answered 200 to one harmless request.

**Stage 4: moving the data** (an evening; the moment of no return for new posts on the old project)
9. C: Fresh read-only export of every table and every account from the cloud (the same route as the daily backup).
10. C, with Luke's typed OK for this one write into the NEW database: import it in the right order, keeping every id,
    every account's id and password hash (email accounts keep their passwords; Google accounts match by Google's id),
    then the test accounts' hidden flags, sequences, the MEDIA fetch lock (a new one) and the timers pointed at the PC.
    Proof: row counts match the export table by table; TEST ACCOUNT A signs in by email on `debaser.site`; Luke signs
    in with Google once himself.
11. C: The 38 file records arrive as "missing" until stage 6. The music bar and avatars show their normal empty state.

**Stage 4 result (2026-11-18, ~03:45, Luke: "Yes, import it"):** exported read-only with `supabase db dump --data-only`
over the cloud's direct connection (it still works under the block): the site's tables (public, game, ink), and
`auth.users`, `auth.identities`, `storage.objects` only (old sessions left behind: they can't work on a new address).
Imported in one transaction with the database's triggers off, then a new fetch lock made in the vault (never shown) and
the three schedules re-made, pointed at `https://debaser.site` (hourly fetch on, sweep and tagging off, as on the cloud).
Proof (`scripts/host/count-rows.cjs --pc`): 110 tables, 382,664 rows, every table equal on the cloud, in the export and
on the PC. TEST ACCOUNT A signed in by email through `api.debaser.site` with its imported password and read its profile.
The export files (with email addresses and password hashes) stay in `G:DEBASER-HOSTsupabaserom-cloud`, outside the repo.
Note for later: the hourly sweep's 235-second timeout is longer than Cloudflare's 100 seconds, so if the sweep is switched
on again it should call the site on this PC directly rather than through the tunnel.

**Stage 5: switch on** (an hour)
12. C: Turn on the self-rebuild task and the site's keep-running task; push a commit that (a) sends visitors of
    `debaser-site.vercel.app` on to `debaser.site` (a host-matched redirect in `next.config.ts`, so no Vercel setting
    changes), (b) changes `npm run read` / `deploy-status` and core.md to the new address, (c) adds
    `debaser.site` to the picture-host list. Proof: `npm run read -- --url https://debaser.site/forum`, the commit the
    PC reports equals `main`, a second test account sees a live update from the first (one short live check).
13. L: Windows: automatic sign-in (Luke's choice; Sysinternals Autologon, which stores the password encrypted), Windows
    Update active hours set so restarts happen at about 05:00, and sleep stays off (it already is). Proof: one test
    restart; the site comes back by itself; C checks.

**Stage 5 result (2026-11-18, ~04:00-05:00):** the site is built on the PC and served at https://debaser.site by
`keep-running.cjs` (`next start` on 127.0.0.1:3000, behind the tunnel). Proved from outside: /forum, /media, /users answer
200; a headless visit to debaser.site loads every table from api.debaser.site and holds the live-update socket open. Found
on the way and fixed with Luke's two OKs: about 1,260 saved links still carried the cloud's address ("Yes, rewrite them"),
and the media catalogue's rule only accepted supabase.co links ("Yes, widen it": migration
`20261118024044_media_src_self_hosted.sql`, applied to the PC with `supabase db push --db-url`). Self-update: two copies
(`G:DEBASER-HOSTsite` and `site-b`); `self-update.cjs` builds a new main in the idle copy, points services.json at it
and stops the old server, and keep-running starts the new one (one full cycle tested: a 5-second blip). Task
`DebaserUpdate` runs it every 5 minutes. The site's settings live in `G:DEBASER-HOSTsite.env`, copied into each build.
Pushed as 280c6db (verify and verify:clean passed; checks 219/237 with my two updated on purpose, the rest
the blocked cloud refusing sign-in, plus check-modules, which fails on main without this work). The PC picked it up by
itself (03:36 noticed, 03:40 switched); `npm run deploy-status` waited until debaser.site reported 280c6db. Proved after:
/api/version answers {commit: 280c6db, host: pc}; debaser-site.vercel.app answers 307 to debaser.site with path and query;
`npm run read` reads debaser.site; TEST ACCOUNTS A and B signed in through api.debaser.site, saw each other on one live
channel and A's broadcast reached B (nothing written). A full interim copy of the PC's database (pg_dump, 22 MB) is in
`I:DEBASERackups` until Stage 7. Still Luke's (step 13): automatic sign-in, Windows Update's active hours, a test restart.
Tools switched (2026-11-18, Luke: "Tools first"): `npm run db` and the `db:*` commands act on the PC's database
(`--db-url` to 127.0.0.1:5432; `--cloud` reaches the old project); `.env.local` (main checkout and this worktree, old values
kept as `.env.local.cloud-2026-11-18`) points at https://api.debaser.site. Proved: `db:list` matches the code, `db:push:dry`
is up to date, `web:fetch` ran end to end from the PC (saved 66 items), and the 18 checks that failed against the blocked
cloud now pass against the PC except check-hidden-accounts (a known red) and one line of check-media-visitors (a pool
file, which arrives in Stage 6). The old 04:00 DebaserBackup task runs in the main checkout, 30 commits behind, so it fails
until Stage 7 replaces it; the interim copy in `I:DEBASERackups` covers the gap.

**Stage 6: the files** (when the Supabase block lifts, ~20 Nov)
14. C: Copy the 38 files from the cloud project's buckets into the PC's buckets (read-only on the cloud side), check each
    file's size matches its record. Proof: a song plays and an avatar shows on debaser.site.

**Stage 7: backups** (an evening)
15. C: Rewrite the daily backup (`DebaserBackup`, 04:00) for the PC: a full database dump (structure and data, which the
    old JSON copy never had) plus the files folder, packed and encrypted with a passphrase Luke types once into
    `.env.local` (and keeps in his password manager: without it the copies can't be opened). Written to
    `I:\DEBASER\backups` (kept 30 days) and copied to `C:\Users\luke keating\Google Drive\DEBASER-backups` (kept 14).
    The task also writes a line Luke can see if a copy fails. Proof: C restores the newest copy into a throwaway
    database and the row counts match.

**Stage 6, early part (2026-11-18, Luke: "i believe we have the ability to recover the missing profile pictures as well as
music", then "yes and attribute them accordingly"):** the cloud still answers 402 for files, so this PC was searched
instead, read-only, by exact size and MD5 fingerprint (storage.objects' eTag): `scripts/host/find-missing-files.cjs` over
every drive (781,278 files) found 11 of the 38 as exact copies (Luke's avatar and the house account's, 6 of Luke's song
uploads, a letter stamp, the test picture and video); `find-in-browser-caches.cjs` over 5.7 GB of browser caches found only
one more, a profile-character strip its owner had already re-made on the PC. `restore-found-files.cjs` uploaded the 11
through the PC's file service, put each record's original owner back, and downloaded each through api.debaser.site with
the same fingerprint; all 26 owners in those buckets now equal the cloud's. Still missing until the block lifts (~20 Nov):
26 files (6 avatars, 3 pictures, 7 songs, 3 profile-character strips, 8 stream-art drawings; 2 of them are test probes).

**Stage 6 result (2026-11-20, the cloud answering again):** `scripts/host/copy-cloud-files.cjs` copied the 934 files whose
bytes the PC lacked (911 MEDIA pool pieces, 7 songs, 4 avatars, 1 picture, 3 profile-character strips, 8 stream-art
drawings; 101.7 MB) with NO database change: every record (and its owner) came across in Stage 4, so each file was read
from the cloud (public folders by their public address, private ones with the cloud's service key, asked of the
Management API and held in memory only; GET only, nothing written there), checked by size and MD5 against its record, and
written to the exact path the PC's file service expects for that record. Files re-made on the PC since (Good morning's
avatar and stamp, the re-uploaded strips) were already there and left alone. One trap: the file service serves a file
with the type it keeps as a note on the file itself (an extended attribute), so a hand-placed file went out as
`application/octet-stream`; `set-file-notes.js`, run inside the storage container, now gives each file its record's type
and cache time before it is moved into place (songs serve as audio/mpeg). The first file copied (Moldavius figtree's
avatar) was fetched once before that, so Cloudflare keeps an octet-stream copy of its bare address for up to 4 hours;
the site's resized copy was right throughout. Proved: all 957 records whole on disk (956 by MD5, one multipart eTag by
size), 166.8 MB; songs, a .wav and avatars answer through api.debaser.site with their real types; Moldavius's Punpun
avatar (his current version) answers through the site's image resizer; no row on the PC points at the cloud any more;
check-media-visitors passes in full again (its pool file was one of the 911).

**Stage 7 result (2026-11-18, Luke: "start stage seven but dont do back ups to google drive for now"):** `backup.cjs`
(task `DebaserBackup`, 04:00, now running `G:\DEBASER-HOST\backup.cjs` instead of the old JSON copy) writes
`I:\DEBASER\backups\<date>\`: the whole database (pg_dump), its roles, the uploaded files, the server's settings and keys,
and a report; 30 kept; `LAST-BACKUP.txt` names the newest; a failure leaves "DEBASER BACKUP FAILED.txt" on the desktop.
Not encrypted while nothing leaves the house (add it with the Google Drive copy, deferred by Luke). First run: 6 seconds,
23 MB, 163 tables. Proved by restoring it into a throwaway database: 382,760 rows in 110 tables, equal to the live one
(only pg_cron can't be re-made outside the main database, as expected). The copies sit on the same external drive as the
uploaded files, so a failure of that drive loses both: the off-site copy is still owed.
**Step 13 (2026-11-19):** automatic sign-in is on (Luke chose `netplwiz` over Autologon; `AutoAdminLogon=1`, the password in
Windows' protected store, none in plain text). No screen lock after it (Luke: "dont lock the screen after"). Update restarts
(Luke: "i want windows to never restart for an update"): `NoAutoRebootWithLoggedOnUsers=1` was already set but without the
`AUOptions=4` Microsoft says it needs, and a Windows Update restart happened on 14 Nov at 21:33. Now set by policy
(Luke approved the admin prompt): `AUOptions=4`, `NoAutoRebootWithLoggedOnUsers=1`, and as the fallback active hours
11:00-05:00 (`SetActiveHours=1`, the 18-hour maximum). Updates still download and install; the restart waits for Luke,
since auto sign-in keeps a user signed in. Not guaranteed on Windows 10 Home (the policy is documented for managed
editions): proved only when the next update needing a restart arrives. Luke restarts by hand about once a month. Still
owed: the test restart.

**Outage and Docker watch (2026-11-18, evening; Luke: "step 3 too"):** Docker Desktop stopped at 18:58 UTC with nothing
in its own log while the PC stayed on; the pages kept serving, but api.debaser.site answered 502 (no data, no sign-in)
until 22:06. Started alone, Docker could not attach its disk (`docker_data.vhdx`: WSL `ERROR_NO_SYSTEM_RESOURCES`); it
came up once Docker was stopped, `wsl --shutdown` run and WSL given ~20 s to let go. All 11 containers came back healthy,
9 accounts read. `keep-running.cjs` now watches the API once a minute and, after 3 misses in a row, runs
`docker compose up -d` or that restart recipe (10 min grace at sign-in, back-off 5/10/20/30 min, `docker.paused` to stop
it). The cause of the stop itself is not known (Docker quit, or crashed without a log line).



**After the move (2026-11-20):** the asleep page and the down alert are in `cloudflare/asleep/README.txt` (a Cloudflare
Worker in front of debaser.site, fail open; Cloudflare's tunnel-health email for debaser-home, filed to Luke's main
inbox by a Gmail filter). Storage's global cap on one file is 500 MB, not 50 MB, set in our override
`G:\DEBASER-HOST\supabase\docker-compose.debaser.yml` (Luke, for COMIC: "Yes, both"); each bucket keeps its own limit.

## The way back (rollback)
- Nothing on the cloud is deleted or changed: the Supabase project and the Vercel project stay exactly as they are for
  at least a month. Once the block lifts, the Vercel site works again with the data as it was on the night of the export.
- Before stage 4: going back costs nothing; just stop.
- After stage 4: posts made on the PC exist only there. Going back means exporting them into the cloud project (a
  database write there, with Luke's OK) and removing the forwarding commit. Practical for a few days after the switch.
- If the PC dies: install the same setup on any machine and restore the newest backup from Google Drive.

## Costs
- debaser.site: about 10 USD a year (Luke already bought it). Cloudflare Tunnel, Docker Desktop (personal use),
  self-hosted Supabase: free.
- Electricity: a gaming PC on 24/7 idles at roughly 60-100 W, about 45-75 kWh a month, at Luke's own price per kWh. For
  comparison, Supabase Pro is 25 USD a month.

## Risks, said once
- **The site is down whenever the PC is off**, restarting or offline, and during an internet outage at home (Luke's OK).
- **Memory**: 16 GB total. League (~3-4 GB) + Supabase (~3-4 GB) + the site (~1 GB) + Chrome and Claude sessions fit,
  but a heavy evening of sessions plus a match can get tight. No limits was Luke's choice; Docker's own default ceiling
  (half the memory) still applies. If League stutters, the fix is one setting.
- **Auto sign-in** means anyone at the PC is in Luke's Windows account after a restart.
- **Cloudflare's free-plan terms** let it act on sites serving "video or a disproportionate amount of large files". 13
  songs to a few dozen people is small; video or a big music library would be the line. If it ever matters, songs can move
  to Cloudflare R2 (free up to 10 GB, no streaming charges).
- **The home connection becomes the address** that fetches YouTube audio, books from LibGen and any scraping. Platforms
  may block it; rights holders' notices would go to Luke's internet provider instead of Vercel.
- **Updates and security**: Windows and Docker updates are Luke's to accept; nothing is opened on the router or firewall;
  the database and the Supabase dashboard answer only on this PC; the tunnel is the only way in.
- **Sessions on this PC**: builds and the site share the machine. Every session's heavy steps already take turns
  (heavy-step.cjs); the self-rebuild joins that queue.

## Out of scope
- Phone-specific anything. Moving to a different machine. A paid plan anywhere. Cloudflare's caching of the site's
  pages (left off at first; can be added later for speed).

## How each stage is proved
Stage 1 `docker run hello-world`, `cloudflared --version`. Stage 2 containers healthy, migration comparison empty, local
sign-up. Stage 3 health check from outside. Stage 4 row counts per table, TEST ACCOUNT A by email, Luke by Google. Stage 5
`npm run read` on debaser.site, the running commit equals `main`, one live-update check between two test accounts, a
restart that comes back by itself. Stage 6 file sizes match, a song plays. Stage 7 a backup restored into a throwaway
database with matching counts.
