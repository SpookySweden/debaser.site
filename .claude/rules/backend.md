---
paths:
  - "app/api/**"
  - "app/**/route.ts"
  - "app/lib/**/supabase-*"
  - "app/lib/**/mock-*"
  - "app/lib/supabase/**"
  - "supabase/**"
---
# Server and data

- On this Windows machine, Node can't spawn `npx.cmd`; the db scripts call `node node_modules/supabase/dist/supabase.js` directly.
- Migration timestamps are section numbers, so `db push` needs `--include-all` (already in the npm scripts).

## Rules
- The browser talks to Supabase directly with the public key (`app/lib/supabase/client.ts`), so Row Level Security is the real lock. Never rely on the browser to filter what someone may see or change.
- A route handler finds out who is asking from the session token (`auth.getUser`) before it reads the body, and never treats a user id sent by the browser as proof of who someone is. `app/api/profile/avatar/route.ts` is the pattern: token first, the sent id only while the accounts are the mock ones.
- Uploads: check the type against an allow-list and the size against a cap before storing, and rate-limit them (the avatar route does all three).
- Only `NEXT_PUBLIC_*` values may reach the browser. A server key never goes in a client file or a response.
- The asset route never serves a path outside `assets/`, and never `.svg` (see its comment).
- Queries select the columns they use, lists have a limit, nothing queries inside a loop, and realtime channels unsubscribe when their component goes away.
- Errors sent to the browser say what went wrong in plain words, with no stack traces or database messages.
