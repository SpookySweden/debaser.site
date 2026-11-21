scripts/host: tools for hosting the site from Luke's PC (SPEC-self-hosting.md). They expect the PC's layout:
G:\DEBASER-HOST\supabase (self-hosted Supabase, its .env holds the secrets) and G:\DEBASER-HOST\site (the copy the PC serves).
None of them prints a key or password. Reads of the cloud go through scripts/db.cjs --read-only.

cloud-managed-extras.cjs  <out.sql>  the parts `supabase db dump` leaves out: auth.users triggers, policies on storage and
                                     realtime, bucket definitions, the migration history. Run from the site checkout.
cloud-grants.cjs          <out.sql>  revokes every grant to the API roles in public/game/ink, then re-applies the cloud's exact
                                     ACLs (tables, columns, sequences, functions, schemas). A restore otherwise adds the PC's
                                     default privileges on top of the dump's grants.
compare-structure.cjs     <parts>    cloud vs PC, item by item: cols pols trigs grants colgrants fgrants; --pols-nobrackets
                                     also compares policies ignoring brackets, and default privileges.
run-local-site.cjs        [port]     the PC's copy of the site in dev mode against the PC's Supabase (127.0.0.1:8000).
probe-local.cjs   <base> <path...>   headless Chrome/Edge: every call a page makes to the PC's Supabase, the live-update
                                     socket, failed requests, console errors. Run with MSYS_NO_PATHCONV=1 from Git Bash, from a
                                     folder where playwright-core resolves.
count-rows.cjs            [--pc]     exact row counts per table: the cloud (read-only), the export files in
                                     G:\DEBASER-HOST\supabase\from-cloud, and with --pc the PC's database.
keep-running.cjs                     (copied to G:\DEBASER-HOST) starts and restarts what services.json lists, and watches
                                     Docker: 3 missed minutes at 127.0.0.1:8000 -> `docker compose up -d`, or, if the
                                     engine is gone, Docker Desktop restarted after `wsl --shutdown`. A file named
                                     G:\DEBASER-HOST\docker.paused stops that watch (quit Docker on purpose? make it first).
                                     Its decision is held by Temp/check-host-docker-watch.cjs.
merge-pasted-keys.cjs  supabase|site moves keys Luke pasted into a paste-keys-here.txt into the file that uses them.
self-update.cjs          [--force]  (copied to G:\DEBASER-HOST, run every 5 min by the task DebaserUpdate) builds a new main in
                                     the copy of the site that isn't serving (site / site-b), then switches services.json to it.
backup.cjs                           (copied to G:\DEBASER-HOST, run at 04:00 by the task DebaserBackup) the daily copy into
                                     I:\DEBASER\backups\<date>: database.dump, roles.sql, files\, settings\, report.json; 30 kept.
find-missing-files.cjs   <folders>  reads drives for exact copies (size + MD5) of files still locked in the cloud project.
find-in-browser-caches.cjs          the same, inside Chrome/Edge/Firefox/Electron caches; saves matches to G:\DEBASER-HOST\recovered.
restore-found-files.cjs             uploads the matches through the PC's file service, restores each record's owner, re-checks.
copy-cloud-files.cjs                Stage 6: copies files the PC lacks from the old cloud (read only) to their records' paths,
                                    checked by size and MD5, no database change. --dry-run, --only <bucket>/<name>.
set-file-notes.js                   run inside the storage container by copy-cloud-files.cjs: gives hand-placed files their
                                    type and cache time (extended attributes), or they're served as octet-stream.
screens.cjs  status | on --owner <id> [--lan] | off
                                     SCREENS (SPEC-screens.md) on the PC: ON names the owner in site.env and in the build being
                                     served, copies the screen engine to G:\DEBASER-HOST\engine, lists it in services.json, starts
                                     it and restarts the site; OFF undoes all of it. Without --lan only a browser on this PC gets
                                     the picture. Luke runs it. --host <folder> --no-start --no-restart prove it on a pretend host.
