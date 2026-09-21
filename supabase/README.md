SUPABASE
========

Everything the site needs from a Supabase project, and the order to do it in.

1. Run the schema
-----------------
Supabase dashboard -> SQL Editor -> New query, paste the whole of `schema.sql`,
and Run. It is written to be re-run: tables, indexes, triggers and policies are
created with `if not exists`, and the policies are dropped and recreated by name,
so running it again after a change only adds what is new.

It creates:

  profiles                  name, name colour, bio, place line, visibility
                            switches, presence (last_seen_at / is_online)
  profile_avatar_versions   the append-only picture history
  profile_tags              tags other accounts gave somebody
  profile_comments          comments on a profile, and on one picture version
  forum_threads             the board's posts
  forum_comments            replies, including the auto-filed item threads
  comms_threads             one row per pair of accounts
  comms_messages            the messages themselves
  comms_reads               each account's read marker per conversation

plus the Row Level Security that makes each of those safe to read from a browser,
a trigger that gives every new account a profile row, the house account's dark
blue name, and the realtime publication the board and the message pop-up listen to.

The last section of the file has three queries to run afterwards (tables and their
RLS flag, the policies, and the profile rows) - each should answer without error.

2. Create the house account
---------------------------
Authentication -> Users -> Add user: email `admin1212@debaser.site`, the password
you want for it, "Auto Confirm User" on. The trigger gives it a profile named
`debaser.site` in `#000080` whether the account is created before or after the
script runs, and section 8 is the backfill for one made before this trigger
existed.

Signing in from the site uses the identifier `ADMIN1212` (see
app/lib/auth/builtin-account.ts): `resolveSignInAddress` maps it to that address
before Supabase ever sees it, so the documented credential keeps working.

3. Turn on Google sign-in (optional)
------------------------------------
Authentication -> Providers -> Google: enable it with the client id and secret from
Google Cloud (APIs & Services -> Credentials -> OAuth client id -> Web application),
and add both redirect URLs Supabase gives you plus your site's `/account` to the
allowed list. The button on the account page and in the side panel then does the
real exchange; until this is done it says what is missing instead of pretending.

4. Point the site at it
-----------------------
Copy `.env.example` to `.env.local` (or set the same names in the Vercel project):

  NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
  NEXT_PUBLIC_AUTH_BACKEND=supabase
  NEXT_PUBLIC_FORUM_DATA_SOURCE=supabase
  NEXT_PUBLIC_PROFILE_DATA_SOURCE=supabase
  NEXT_PUBLIC_COMMS_DATA_SOURCE=supabase

Restart `npm run dev`. Each switch is independent and each falls back to the local
mock store when it is missing, so the site runs with no backend at all - and one
part can be moved over at a time if something needs checking.

What lives where
----------------
  accounts + sessions        app/lib/auth/supabase-auth.ts
  board (threads, comments)  app/lib/forum/supabase-repository.ts
  profiles + presence        app/lib/profile/supabase-profile-repository.ts
  direct messages            app/lib/comms/supabase-comms-repository.ts
  the switches themselves    app/lib/*/repository.ts (and auth-repository.ts)

Each repository is the only place that knows a table name: no component reads a
table, and nothing in the UI changes when a switch flips.

What the permissions actually allow
-----------------------------------
Read as an anonymous visitor (the public key, no session):

  profiles, profile_avatar_versions, forum_threads, forum_comments   all rows
  profile_tags, profile_comments                                     only rows that
      are not hidden, plus what the profile's own `show_*` switches open up
  comms_threads, comms_messages, comms_reads                         nothing

Write, signed in:

  profiles                       your own row only (insert, update, delete)
  profile_avatar_versions        your own versions, append only - no rewriting a
                                 filed drawing, which is the point of the history
  profile_tags                   any account may give a tag; the page's owner
                                 decides what shows, and either of them may remove it
  profile_comments               any account may comment; only the author may edit
                                 or delete (the page's owner may also delete)
  forum_threads / forum_comments your own rows, and only signed by you
  comms_*                        only the two accounts in the conversation; a
                                 message can only be signed by its writer

Write, with no session at all: the board and the tag/comment shelves still accept
a row whose author is null, which is what "posting stays open to guests" means once
this backend is live (the mock store behaved the same way). Those rows have no
owner, so nothing can delete them through the API - only SQL, or a moderation
policy added on purpose. If guest posting turns out to be more trouble than it is
worth, the fix is one line per policy (`with check (author_id = auth.uid())`) plus
hiding the composer for signed-out visitors.
