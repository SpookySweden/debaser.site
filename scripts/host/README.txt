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
keep-running.cjs                     (copied to G:\DEBASER-HOST) starts and restarts what services.json lists.
merge-pasted-keys.cjs  supabase|site moves keys Luke pasted into a paste-keys-here.txt into the file that uses them.
self-update.cjs          [--force]  (copied to G:\DEBASER-HOST, run every 5 min by the task DebaserUpdate) builds a new main in
                                     the copy of the site that isn't serving (site / site-b), then switches services.json to it.
