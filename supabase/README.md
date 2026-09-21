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
  comms_threads             one row per conversation: a pair of accounts, or a group
  comms_members             who is in a group; a dm's pair answers for it too
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
you want for it, "Auto Confirm User" on. It arrives already dressed: a before-insert
trigger puts `debaser.site` in the account's own metadata (which is what a post is
signed with), and the after-insert trigger gives it a profile named `debaser.site`
in `#000080`. Section 8 is the backfill for an account made before those triggers
existed, and it is safe to re-run.

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

The deployed site reads the same names from `.env.production`, which is committed.
Next.js loads that file for `next build`, which is what Vercel runs, so a deploy
lands on Supabase with no dashboard step at all; names set in the Vercel project
take precedence over it, so it can also be deleted once they are set there. It holds
only `NEXT_PUBLIC_*` values, which reach the browser in the bundle anyway, and RLS in
`schema.sql` is what protects the data.

5. Let visitors make accounts
-----------------------------
Sign-ups are open (`disable_signup: false`) and email sign-in is on. The question is
whether a stranger can *finish* signing up, and out of the box they cannot: "Confirm
email" is ON, which means an account cannot sign in until it opens the link in the
confirmation mail, while Supabase's built-in mail service only delivers to members of
your own organisation and allows a couple of messages an hour. The visitor signs up,
is told to check their inbox, and waits for a mail that never comes - or, once a
custom SMTP is configured but rejected by the provider, the sign-up fails outright.

**The mail service (Resend).** Authentication -> Emails -> SMTP Settings:

  host      smtp.resend.com
  port      465
  username  resend
  password  the Resend API key (re_...) - not the SMTP password of any other account
  sender    an address at a domain verified in Resend, e.g. archive@yourdomain

Two things bite here, both worth checking before anything else:

  - **Resend will not send from an unverified domain.** Add the domain under Resend ->
    Domains and copy its SPF/DKIM records into that domain's DNS. Until that is done,
    sends are rejected, and Supabase answers a sign-up with HTTP 500
    `Error sending confirmation email`. The site now says that in plain words, and
    says nothing was created - which is true: Supabase rolls the account back.
  - **Resend's shared sender (`onboarding@resend.dev`) only delivers to the address
    the Resend account was created with.** Every other recipient is refused, so
    sign-ups work only for you and fail for everybody else. That is why a verified
    domain is not optional once real visitors arrive.

The error itself is easiest to read on the Supabase side: Dashboard -> Logs -> Auth
shows the SMTP failure with the provider's own words.

If you would rather not run SMTP at all, the other way is to turn "Confirm email" off
(Authentication -> Sign In / Providers -> Email): the account then works the moment it
is made, and no mail is involved. Fine for a small archive; a newsletter or a password
reset later would want the mail service anyway.

An address on the site's own domain can never sign itself up: Supabase refuses any
address whose domain has no mail records, and `debaser.site` has none (it does not
resolve at all). That address exists only because it was made by hand in the dashboard
- the same reason the house account is a dashboard step (step 2).

Four probes show the state of all of this rather than leaving it to be guessed at:

  node Temp/two-account-probe.cjs    # two accounts: directory, posts, messages, tampering, a ban
  node Temp/check-resend.cjs         # is the Resend key good, and is a domain verified?
  node Temp/signup-mail-probe.cjs    # a real signup through a throwaway mailbox, and whether its mail arrives
  node Temp/auth-live-probe.cjs      # sign-ups open? confirmation needed? does sign-in work?
  node Temp/live-ban-probe.cjs       # ban an account, and check every side of the rule

**With "Confirm email" off, none of the mail setup is needed for sign-ups to work** -
`two-account-probe` is the run that proves the whole multi-user path with that setting:
a brand new account appears in the directory for everybody, posts and replies that
visitors see, holds a conversation with the house account that nobody else can read,
is refused when it tries to rewrite the house account's post or ban it, and - once
banned - vanishes from everybody's board but the admin's while still being able to read
and sign in. The mail service only matters again if confirmation is switched back on,
or when password resets and newsletters arrive.

What lives where
----------------
  accounts + sessions        app/lib/auth/supabase-auth.ts
  board (threads, comments)  app/lib/forum/supabase-repository.ts
  profiles + presence        app/lib/profile/supabase-profile-repository.ts
  direct messages            app/lib/comms/supabase-comms-repository.ts
  uploaded pictures          app/lib/profile/avatar-upload.ts + the `avatars` bucket
  the switches themselves    app/lib/*/repository.ts (and auth-repository.ts)

Each repository is the only place that knows a table name: no component reads a
table, and nothing in the UI changes when a switch flips.

Moderation
----------
The board takes posts from guests, so somebody has to be able to take one back
down. That is the house account: `public.is_admin()` is the single test (it checks
the signed-in account's address), and section 10 of the script gives it update and
delete on `forum_threads` and `forum_comments` - anything, not just its own rows -
plus delete on `profile_tags` and `profile_comments`.

The site draws `[ ADMIN ] [ EDIT POST ] [ REMOVE POST ] [ BAN ]` on every post and
reply when that account is signed in (app/components/ForumModerationControls.tsx),
and nothing at all for anybody else. The controls are a convenience; the rule is the
database's, so a request forged by hand is refused there rather than in the UI.

Banning an account
------------------
The moderation above is about one post or one reply; a ban is about the account
behind it, and it is section 12 of the script. A ban stamps three columns on the
profile row - `banned_at`, `banned_reason`, `banned_by` - and only the house account
may write them (`profiles moderated by admin`); nothing else in the site can.

What a ban does, in the database rather than in the UI:

  - stops the account writing anywhere - posts and replies, profile edits, tags,
    comments, direct messages and picture uploads all carry `not public.is_banned()`
    in their policies - while still letting it read the site;
  - hides what the account already wrote: its posts and replies disappear from the
    board for everybody *except* the house account, which still sees them, marked
    `[ BANNED ]`. That is deliberate - without it a ban could not be lifted and the
    writing could not be tidied up afterwards.

Where you use it: with the house account signed in, every post and reply shows
`[ BAN ]` beside `[ EDIT POST ]` and `[ REMOVE POST ]`. It asks for the reason in the
archive's own words, then the row reads `[ BANNED ]` with an `[ UNBAN ]` button. The
account directory marks the row too, so a name that has gone quiet says why.

Two things worth knowing:

  - a page that is already open keeps the rows it has until it reloads, because a ban
    is an update to a profile row while the board is watching posts. Nothing new
    arrives from that account, and the next load is clean;
  - deleting an account outright is still a dashboard job (Authentication -> Users ->
    Delete user): removing an auth user needs the service role, which the site is
    never given. A ban is what the site itself can do.

Groups
------
A direct conversation is a pair, and its id is derived from the pair, so opening one is
a lookup. A group is everything else, and section 13 of the script is what makes one
work: `comms_threads` grew `kind` ('dm' or 'group'), `name` and `created_by`,
`participant_a` / `participant_b` became optional, and `comms_members` holds who is in
a group. A dm keeps its pair; a group stores no pair at all, so membership is the whole
answer for it.

The policies accept membership *or* the pair, so nothing already stored stops working -
and the section backfills a membership row for each side of the dms that were filed
before the table existed. Reading a conversation needs you to be in it either way;
adding somebody needs you to be in it already, which is why a group is created by
writing the row, then adding yourself, then adding the rest. Whoever opened a group can
close it (`comms threads deleted by the creator`), and messages cascade with it.

On the page it is one screen for both: `[ + NEW GROUP ]` next to `[ + NEW MESSAGE ]`,
a `[ GROUP ]` mark and a head count in the conversation list, a member count with
`[ + ADD MEMBER ]` on an open group, and the panel names members rather than a single
"TO:". Direct messages are unchanged - same derived id, same two readers.

Tags
----
A tag is not shown until the profile's owner approves it. `profile_tags.hidden` is that
flag - it has always meant "not shown", so approving is simply switching it off and no
schema change was needed. Two rules sit on top of it, both enforced in the profile
repositories (app/lib/profile/mock-profile-repository.ts and
supabase-profile-repository.ts) so that every surface agrees:

  - a tag the house account gives arrives approved: the admin does not wait on the
    approval of the person they are tagging, and may give as many as they like;
  - the owner may show exactly one tag they gave themselves - approving a second one
    retires the first, so a page cannot be stacked with its own badges.

The profile page lists the approved tags under the account's details, marks the ones
still waiting, and gives the owner `[ APPROVE ]` / `[ HIDE ]` / `[ REMOVE ]`. Past six
tags the list folds behind `[ SHOW ALL n TAGS ]`, and the box for giving one lives
behind its own `[ ADD TAG ]`.

Profile pictures
----------------
Uploaded drawings go to the public `avatars` bucket (section 11), from the browser,
under the visitor's own session - which is what the bucket policies check and what
makes uploads work on a host with a read-only filesystem (Vercel). The path is
`<account id>/avatar-v<version>-<stamp>.<ext>`, and the policies read that first
segment, so one account cannot file into another's folder.

The bucket's own limits mirror the site's: 2MB and PNG/JPG/WEBP/GIF, i.e.
`MAX_AVATAR_BYTES` and `AVATAR_ACCEPT` in app/lib/profile/avatar-catalogue.ts. The
form checks those first and says so in plain text ("UP TO 2MB"), so the bucket only
ever sees a drawing the site has already accepted; it is the backstop, not the rule.
The scratch check asserts the two agree, so changing the constant without changing
section 11 fails the check rather than silently drifting.

To change the size limit: change the constant, change section 11, and set the bucket's
limit (re-run the script, or Storage -> avatars -> Edit bucket in the dashboard).

Two things follow from the bucket being a different host:

  - `next.config.ts` has to allow it in `images.remotePatterns` (it does, narrowed
    to `/storage/v1/object/public/**`).
  - Pictures filed *before* this change are still files in the repo's
    `assets/profiles/uploads/` folder. Both kinds can live side by side: a version
    row stores whatever `src` it was filed with, and the upload route is still the
    path used when profiles are on the mock store.

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
