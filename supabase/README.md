SUPABASE
========

Everything the site needs from a Supabase project, and the order to do it in.

Running SQL from the checkout
-----------------------------
Every other way this repository talks to the project is the *site's* way: the
publishable (anon) key over PostgREST, which is what `app/lib/*/supabase-*.ts`
uses and what the `Temp/` checks ask their questions with. That key is
deliberately weak - it reads the tables RLS lets it read and calls the functions
the schema defines, and it **cannot run SQL at all**, so the checks can prove
what a reader would see and none of them can ask why. The steps below are the
SQL editor's job, and this is how to make them a command instead:

    npm run db -- "select count(*) from public.profiles;"
    npm run db -- "select tablename from pg_tables where schemaname = 'public';"
    npm run db -- --file supabase/cleanup/verify-live-schema.sql
    npm run db -- --json "select * from pg_policies where tablename = 'profiles';"

`npm run db` (`Temp/sql.cjs`) drives `supabase db query`, which is the same
instrument the SQL editor is: it goes to the Management API with a *personal*
access token, not with the site's key.

**The credential is the whole story, so read this part.** A token (`sbp_...`)
from https://supabase.com/dashboard/account/tokens belongs to *your account*, not
to this site: it reaches every project you can see and can do anything to any of
them. Two ways to give it, and either is enough:

    npx supabase login                        # stores it for the machine, in the browser
    SUPABASE_ACCESS_TOKEN=sbp_...             # a line in .env.local (gitignored)

`SUPABASE_ACCESS_TOKEN` wins if both are set. It is never read by `app/`, never
needed to build or run the site, and must never go in `.env.production` or
anywhere under `app/` - that file is committed and those values reach a browser.

Then link the checkout once, so `--linked` means something. The project ref is
in `.env.local` already (`https://<ref>.supabase.co`), and this asks for the
database password (Dashboard -> Project Settings -> Database):

    npm run db:link -- --project-ref <ref>

Two flags matter when the SQL is not a question:

    npm run db -- --write "..."     run a statement that changes something
    npm run db -- --dry-run "..."   print the statement and the command, run nothing

A statement that is not a read is **refused** without `--write`, and printed in
full first, so the review is of the SQL rather than of the flag. `--read-only`
refuses the other way: it errors if the statement turns out to be a write. The
CLI has no read-only mode of its own, so this is a courtesy rather than a guard -
but it is the difference between a typo and an outage. `Temp/` is gitignored, and
so is `.env.local`.

### The migrations, and how the history was adopted

`supabase/migrations/` is now **a real CLI migration chain**, and this is the
part worth understanding before touching it, because the history had to be
reconciled by hand exactly once.

Every file is named to the CLI's rule - `<14-digit timestamp>_name.sql`, in the
order `db push` applies them:

    20260921000009_comms_realtime.sql              section 9
    20260921000013_group_conversations.sql         section 13
    20260921000014_music_and_profile_songs.sql     sections 14, 15
    20260922000016_group_ownership.sql             section 16
    20260923000017_notifications.sql               section 17
    20260924000018_forum_pins.sql                  section 18
    20260926000019_profile_comment_pins.sql        section 19
    20260927000020_forum_audio_and_track_tags.sql  section 20
    20260928000021_music_folders.sql               section 21
    20260929000022_lore_pages.sql                  section 22
    20260930000023_arcade.sql                      section 23
    20260930000024_comms_events.sql
    20260930000025_music_library.sql
    20260930000026_profile_status.sql
    20260930000027_welcome_tag.sql

The date part is the date the section was written; the time part is **the
schema section it holds**. That is deliberate: the old names were
`20260921_name.sql` - an 8-digit date - and the CLI needs a 14-digit timestamp,
so the time had to be invented for each file. Using the section number keeps the
order meaningful rather than arbitrary, which matters because the sections have
real dependencies (`comms_realtime` publishes what `group_conversations` makes;
`group_ownership` tightens what `group_conversations` loosened). The four files
with a section number of 24 or higher are the ones with no section of their own:
they only add, and they run last.

**Reconciling the history, once.** The schema had been run by pasting
`schema.sql` into the SQL editor, so the remote
`supabase_migrations.schema_migrations` table knew about none of this and a
`db push` would have replayed all fifteen files. The fix is `migration repair`,
which records what is already true without running anything:

    npx supabase migration repair --status applied 20260921000009
    # ...and so on for each timestamp, then:
    npm run db:list          # local and remote, side by side

Every line should read `applied` once that is done, and `db push` then applies
only what is genuinely new. `20260925000019_catch_up.sql` is deliberately *not*
in the list above: it was 95 verbatim duplicates of sections 16-18 plus a
verification query, kept because a human had to paste it. It has moved to
`supabase/cleanup/catch-up.sql` with the other hand-run utilities, so it can
never be replayed by a push. Sections 16-18 are the three files above it.

From here on, a new change is:

    npm run db:new -- my_change       # creates <timestamp>_my_change.sql, empty
    # write the SQL in it, using `if not exists` / `drop policy if exists` like
    # every other file here, so it is safe on a project that is already partway
    npm run db:push:dry               # what would run
    npm run db:push                   # run it

A file that is already written but not yet in the chain can be run on its own
without touching the history - for a project that is behind by one section, or to
re-run something:

    npm run db -- --file supabase/migrations/20260930000023_arcade.sql

The read checks do not depend on the history table either way: they ask the
*project* what it has.

1. Run the schema
-----------------
For a **new** project, this is the whole database in one paste. Supabase dashboard -> SQL Editor ->
New query, paste the whole of `schema.sql`, and Run. It is written to be re-run: tables, indexes,
triggers and policies are created with `if not exists`, and the policies are dropped and recreated by
name, so running it again after a change only adds what is new.

For a project that is already running, `schema.sql` is still the reference - the migration chain in
`supabase/migrations/` is the same statements cut into sections - and a change reaches it with the
CLI rather than by hand:

    npm run db:push:dry      # what would run
    npm run db:push          # run it

Either way, one section can be run on its own when that is what is wanted:

    npm run db -- --file supabase/migrations/20260930000023_arcade.sql

It creates:

  profiles                  name, name colour, bio, place line, visibility
                            switches, presence (last_seen_at / is_online)
  profile_avatar_versions   the append-only picture history
  profile_tags              tags other accounts gave somebody
  profile_comments          comments on a profile, and on one picture version
                            (the owner pins one to the wire - section 19; the board
                            reads them as threads of its own - see below)
  profile_song_versions     the one track beside a picture (section 15)
  forum_threads             the board's posts, each able to carry an MP3 (section 5)
  forum_comments            replies, including the auto-filed item threads
  comms_threads             one row per conversation: a pair of accounts, or a group
  comms_members             who is in a group; a dm's pair answers for it too
  comms_messages            the messages themselves
  comms_reads               each account's read marker per conversation
  forum_notifications       who tagged you, who replied to you, and who wants a game (sections 17, 23)
  game_invites              who challenged whom to which game, and whether it was answered (section 23)
  forum_pins                the posts a moderator has pinned, and for how long (section 18)
  music_tracks              the shelf's files, with their tags and the folder they are filed in
  music_folders             the folders the file browser makes, keyed by their whole path (14b)
  lore_pages                the world written down: one row per page, holding the shared document
                            and the plain text a visitor reads (section 22)

plus the Row Level Security that makes each of those safe to read from a browser,
a trigger that gives every new account a profile row, the house account's dark
blue name, and the realtime publication the board and the message pop-up listen to.

The last section of the file has three queries to run afterwards (tables and their
RLS flag, the policies, and the profile rows) - each should answer without error.

A project that has been running since before section 13 (groups) existed needs that one
section run on its own: `supabase/migrations/20260921000013_group_conversations.sql` is section
13 as a file, safe to re-run. See Groups below for what happens until it has run.

The same goes for three later sections, each with its own file: section 16 (which stops a
group member renaming a group and claiming it) is
`supabase/migrations/20260922000016_group_ownership.sql`, section 17 (tags and replies) is
`supabase/migrations/20260923000017_notifications.sql`, and section 18 (pinned posts, and the test
pin that comes with it) is `supabase/migrations/20260924000018_forum_pins.sql`. All three are safe
to re-run. Until section 17 is in, the bell is empty rather than broken: posting, replying and
tagging all still work, and the tag is simply not delivered - see Notifications below. Until
section 18 is in, the board works and nothing can be pinned: the pin controls and the
moderators' panel answer with the store's own words rather than half-working.

Section 19 (pinned comments on a profile) is `supabase/migrations/20260926000019_profile_comment_pins.sql`,
safe to re-run too. Until it is in, the profile page is exactly as it was: comments read and file
as normal, the pin button beside each one answers with the database's own words rather than
half-working, and the wire draws every comment in its scattered order with no `PINNED` plate. The
same file also publishes `profile_comments` to Realtime, which it never was - see Pinned comments
on a profile below.

Two more catch-ups have files of their own, safe to re-run, and both are already part of what
`schema.sql` does - they exist for a project that has been running since before them:

  `supabase/migrations/20260927000020_forum_audio_and_track_tags.sql`  an MP3 filed with a post, and the
      audio tags the file directory filters on (`forum_threads.track`, `forum_comments.track`,
      `music_tracks.tags`). Run it *before* the build that posts audio goes up: every post and reply
      writes the `track` column, so until the column exists an insert is refused with the database's
      own words and nothing lands on the board. The shelf is gentler - `music_tracks.tags` is only
      ever read, so a missing column costs a console warning and files fall back to their own names.
      It needs no new bucket and no new policy: the audio goes into the `mp3` bucket section 14
      already made (see Music below).

  `supabase/migrations/20260928000021_music_folders.sql`               the folders /music is browsed by,
      and the path a file is filed under (`music_folders`, `music_tracks.folder_path`). Until it is
      in, /music still works: the browser lists the catalogue's own releases - their folders are read
      off the files rather than off this table - and it cannot make a new folder or file into one
      somebody made, which it reports in the console rather than pretending.

Section 22 (the lore pages, and the document two editors merge) is
`supabase/migrations/20260929000022_lore_pages.sql`, safe to re-run. Until it is in, /lore says so
rather than pretending to be an empty shelf: the list is a read that fails, and no page can be
opened. Nothing else on the site reads the table - see Lore pages below.

One more catch-up is worth knowing about, because its failure is silent:
`supabase/migrations/20260921000009_comms_realtime.sql` puts the four `comms_*` tables in the
`supabase_realtime` publication. A channel bound to a table that is not in it reports
SUBSCRIBED and then delivers nothing at all - from any of its tables - which reads on
screen as "nobody has messaged you yet". See Realtime below.

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
  the shelf and the archive  app/lib/audio/supabase-music-repository.ts + the `mp3` bucket
  lore pages + their channel app/lib/lore/supabase-lore-repository.ts
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

If a project's `comms_*` tables predate section 13, run the catch-up script -
`supabase/migrations/20260921000013_group_conversations.sql`, Dashboard -> SQL Editor, safe to
re-run. Until it has run, the site is honest rather than half-broken: the conversation
read falls back to the pair-only shape (so the comms page, the unread badge and the
notification pop-up all work on direct messages), and `[ + NEW GROUP ]` answers with the
file to run instead of a raw PostgREST error. That message is `GROUPS_NEED_MIGRATION` in
app/lib/comms/supabase-comms-repository.ts, and the fallback is the `readThreads` method
beside it.

Realtime
--------
Section 9 of the script puts the tables the site listens to in the `supabase_realtime`
publication, and it has one rule that is easy to get wrong because getting it wrong is
silent:

  a channel bound to a table that is NOT in the publication reports SUBSCRIBED, and then
  delivers no event from ANY of its tables. The one unpublishable binding takes the whole
  channel down.

That is what the comms channel did: it watched `comms_messages`, `comms_threads` and
`comms_members` (published) plus `comms_reads` (never published), so every event was
dropped - messages that arrived while a page was open were never shown, a member added to
a group never appeared, and nothing moved until a reload.

Two things follow, and both are in the repository now:

  - `comms_reads` is not bound any more. The read marker is written by the reader, and
    every event and every poll re-reads the whole conversation anyway;
  - `comms_members` is bound only once the group script is known to be there, because a
    binding for a missing table breaks a channel the same way;
  - and the channel is no longer the only path: `CommsProvider` re-reads on a timer
    (`COMMS_POLL_MS`, 15s, only while the tab is visible), so a blocked socket or a quiet
    channel delays a message by seconds instead of hiding it until a reload. A channel
    that cannot join now says so in the console rather than looking like an empty inbox.

`supabase/migrations/20260921000009_comms_realtime.sql` is that publication catch-up as a file
you can paste on its own - all four tables, safe to re-run. Run it on a project that has
been live since before `comms_reads` was published.

Music
-----
Section 14 puts the audio somewhere it survives a deploy: a public `mp3` bucket, with the
same folder rule the pictures use (`<user id>/...`), 20MB and the five audio types the
site itself insists on (`MAX_TRACK_BYTES` and the list in app/lib/audio/catalogue.ts).
`music_tracks` is what gives a file its title and its credit.

The player reads the *bucket*, not the table: app/lib/audio/supabase-music-repository.ts
lists it (one level deep, so the per-account folders are found). That is what makes a file
dropped in by hand play the moment it lands, and it is why the first track in the bucket is
what the bar at the bottom of the window opens on, looping (`[ LOOP: ON ]` by default). A
file with no row is titled from its own name, and if the listing is refused the shelf falls
back to the archive's own hand-filed tracks (app/lib/projects/tracks.ts) rather than
showing nothing. `Temp/check-music-bucket.cjs` prints what the player will find.

The same bucket takes the audio that rides with a post. Any post or reply on the board, an asset's
comment box and a profile's own thread can carry one MP3 - filed from the poster's machine, or
linked from somewhere else, which is the way in for a guest (`app/components/TrackAttachmentPicker.tsx`).
The row keeps only what the board says about the file (`track`, read back defensively), and the
file itself lands on the shelf, so a track filed in a thread is in the player's queue and in the
`/music` directory the moment it is posted - under the heading `BOARD`, credited to whoever filed
it. Tags describe how a track sounds (`HIP HOP`, `LO FI`, `AMBIENT`), are spelled and capped in one
place (`app/lib/audio/tags.ts`), and are what the directory's filter bar counts and filters on.
Section 20 adds the three columns that hold all of that; `Temp/check-forum-audio.cjs` checks the
grammar, the filter, the link field and the collection of posted tracks.

`/music` itself is a **file browser**, and section 21 is what makes it writable: any signed-in
account may make a folder and file a track into one (`music_folders`, and
`music_tracks.folder_path`). A folder's whole path is its key and a file is filed by path, so a
file's name is simply where it is - `GLASS CORRIDOR` filed into `HEXHAM/GRIDLOCK` is listed as
`GLASS CORRIDOR - GRIDLOCK - HEXHAM`, the archive's naming convention derived rather than typed.
Folders come from two places and are the same thing either way: the paths the catalogue implies for
its own releases, and the paths people have made. A path only a *file* mentions exists too - a
directory is real while something is in it - which is why `folder_path` carries no foreign key and
why an unreadable folder table costs the folders people added rather than the whole listing.
`Temp/check-archive-tree.cjs` covers the paths, the naming, the tree, the search and the folder
store.

Section 15 is the track beside a picture: `profile_song_versions` (append-only, like the
drawings), `profiles.current_song_version_id` and `show_song_comments`, and
`profile_comments` grows `song_version_id` plus a `'song'` kind - so one comments table,
with one set of read rules, holds all three surfaces (the profile, the picture, the track).
Filing a song also updates `profiles`, which the profile channel already watches, so an
open page shows the new track without a reload; nothing new needs publishing.

### Those comments on the board

The board shows them without a second copy of anything. `ForumProvider` reads
`profile_comments` once (`listCommentFeed`), and `app/lib/forum/profile-threads.ts` files
what comes back as one thread per subject - the page, each picture version, each track
version - with tags read out of the words, the header crediting the house account as an
asset's thread does, and the source filter offering them as `PROFILE COMMENTS`. Replying on
such a thread is a profile write (`ForumProvider.addProfileComment`), so the owner's
`show_*_comments` switches and a pinned remark keep working, and the profile page and the
board read the same rows.

No policy change was needed for this, and that is the point of doing it this way: the read
policy on `profile_comments` already decides what a visitor may see - the row's own author,
the page's owner, and otherwise the page's switch for that aspect. The board therefore shows
exactly what the profile page shows a visitor, and nothing wider.

**One gap in that policy, found while wiring this up.** The clause list in section 4 covers
`kind = 'profile'` and `kind = 'avatar'`; section 15 added a `'song'` kind to the same table
but no clause for it, so a track comment is readable only by whoever wrote it and by the
account whose page carries it - a visitor reading somebody else's profile sees none of the
comments left on their track, and so does the board. If track comments should be as public as
picture comments, it is one clause (add it to the policy, or run this on its own):

```sql
drop policy if exists "profile comments readable" on public.profile_comments;
create policy "profile comments readable" on public.profile_comments
  for select using (
    user_id = auth.uid()
    or author_id = auth.uid()
    or (kind = 'profile' and exists (
      select 1 from public.profiles p where p.id = user_id and p.show_profile_comments
    ))
    or (kind = 'avatar' and exists (
      select 1 from public.profiles p where p.id = user_id and p.show_avatar_comments
    ))
    or (kind = 'song' and exists (
      select 1 from public.profiles p where p.id = user_id and p.show_song_comments
    ))
  );
```

It is left to the owner of the data to run: it is a visibility decision, not a bug fix.

Section 19's pin columns are read too: a pinned remark still leads the profile's wire, and it
is the same row the board draws.

A project that has been live since before either section needs them run on their own:
`supabase/migrations/20260921000014_music_and_profile_songs.sql`, safe to re-run.

Groups and who owns them
------------------------
Section 13 lets any member of a group change the group's row, which is how a group gets its
name and how it is renamed - and it is also how somebody who was only *invited* to a group
could rename it and hand himself ownership, with one PATCH to `comms_threads`. Both of those
are a write to `name` and to `created_by`, and the policy asked only whether the writer was in
the conversation.

Section 16 is the fix, in three layers:

- **one writable column**: `revoke update on public.comms_threads` and
  `grant update (updated_at)`, so a client can stamp the conversation when it sends a message
  and nothing else. `name`, `created_by`, `kind` and the pair columns are refused by the table
  itself, before any policy is looked at;
- **a trigger** (`comms_threads_guard_metadata`) that refuses a change to the metadata unless
  the caller is the owner - so a policy re-created by hand later cannot quietly re-open it -
  while still letting the house account repair what it must;
- **four functions**, and they are the only door: `rename_group`, `transfer_group_ownership`
  (to somebody already in it), `remove_group_member`, and `leave_group`, which passes the
  group to whoever has been in it longest and closes it when the last member goes.

Ownership therefore moves two ways and no others: the owner hands it over, or the owner leaves.
Nothing a member can call changes it.

The section also puts back the `created_by = auth.uid()` case on the insert policy, which
section 12 had re-created without it - a group has no pair to be "in", so without that clause
no group could be opened at all from a client - and tightens the membership insert policy so
that adding *yourself* is only allowed in a conversation you opened, rather than to any group
whose id you happen to know.

A project that has been live since before section 16 needs it on its own:
`supabase/migrations/20260922000016_group_ownership.sql`, safe to re-run. Until it is run, groups
work and only the owner's controls (rename, hand over, remove) say they need the update.

`Temp/probe-group-metadata-write.cjs` is the probe that found it and the one to run afterwards:
as a member, it writes the values that are *already there*, so a success proves write access and
changes nothing. Before section 16 it answers `ALLOWED` for the name and the ownership column;
after it, `refused` for both.

Notifications
-------------
Section 17 adds `forum_notifications`, one row per account told, and it is what the bell at the
top of the side panel's comms block reads. Two things write to it:

  - a `@name` in a post or a reply is a tag: the words are matched against the account list
    (case-insensitively, with `_` standing in for a space), and every account named gets a row;
  - answering somebody is a tag too, and arrives without being asked: a reply under a post is
    addressed to whoever wrote it, and a reply to a reply to whoever wrote that. Those are the
    rows marked as replies rather than tags.

The menu shows both in one list, newest first, because recency is the only order that matters
when what you want to know is who is waiting on you. Unread rows draw white with a filled
square; opening one marks it seen and takes the reader to the post.

The rules are worth restating because they are the whole point of the table being separate
from the board: a row is readable, updatable and deletable by exactly one account - the one it
names - while an insert is allowed for any signed-in, unbanned account as long as it is signed
by its author (`actor_id = auth.uid()`, so a tag cannot claim to be somebody else's words) and
is addressed to somebody other than themselves. Nobody can read somebody else's feed, and the
house account is no exception.

**And the write is made without asking for the row back.** `insert(...).select(...)` - PostgREST's
`Prefer: return=representation` - makes the writer read the row it has just filed, and a row
addressed to somebody else may not be read by the writer: the whole statement is refused with
`new row violates row-level security policy for table "forum_notifications"`, which reads exactly
like a missing policy even when every policy is in place, and nothing is filed. The repository
therefore inserts without a return and `notify()` hands nothing back (see the contract in
app/lib/notifications/types.ts); the recipient's own bell is what shows the row. That distinction
was first found by this check failing after the SQL had been applied - the check used the
returning shape itself.

Until section 17 is in, nothing is lost but the delivery: a post files, the tag is simply not
written, and the bell says the feed needs the update rather than pretending the list is empty
(`NOTIFICATIONS_NEED_MIGRATION`, see app/lib/notifications/supabase-notifications-repository.ts).

`Temp/check-notifications-schema.cjs` asks the project whether it is there, and then what it is for:
with the table in place it signs two throwaway accounts up and exercises the four policies one at a
time - a tag filed for the account it names (written the way the app writes it, with no return), a
read-back of that row refused and filing nothing, a row addressed to the tagger refused, the
recipient's feed holding it while the tagger's does not, the tagger unable to mark it read or delete
it, and the recipient able to do both. Realtime is reported rather than asserted, because the bell
also polls. `Temp/probe-live-schema.cjs` is the wider one: every table and every section-16
function, which is what caught the two sections this project was missing.

The feed follows the board's data source, so a project with
`NEXT_PUBLIC_FORUM_DATA_SOURCE=supabase` needs nothing else;
`NEXT_PUBLIC_NOTIFICATIONS_DATA_SOURCE=mock` (or `supabase`) overrides it on its own.

Pinned posts
------------
Section 18 adds `forum_pins`: one row per post a moderator has lifted to the top of the board and
to the front of the newswire. A pin is *not* a column on the thread, because it is not part of
what was written - it is the archive's decision about somebody's post, and it comes off without
touching the post.

  - **Who.** The house account and only it, the same `is_admin()` that lets it edit or remove a
    post. The row is signed with the account that took it (`pinned_by = auth.uid()`, which the
    insert policy checks), and the label beside the pin is that name as it was then. Reading is
    open, like the board: a pin has to be visible to the visitors it is meant for.
  - **How long.** `expires_at` is null for a pin that never runs out, and anything else is the
    moment it stops. Nothing sweeps a lapsed pin up - `app/lib/forum/pins.ts` simply stops
    counting it, so a pin never depends on a scheduled job to stop working. Re-pinning a post
    extends it; the one-row-per-post key (`thread_id` is the primary key) is what makes that a
    single write rather than an unpin and a pin.
  - **Where it shows.** The post sits at the top of the board whatever else has been filed, with
    a `PINNED ...` badge and an `[ UNPIN ]` on it for the moderator; on the newswire the pinned
    post leads the crawl wearing the same badge; and for the moderator there is a panel at the
    top of the board - `PINNED POSTS :: MODERATORS` - saying what is held, by whom, how long is
    left, and how to let it go. Nobody else is handed the panel or the control.

The file also writes **one test pin**, so the feature has something in it: a post titled
`PINNED TO THE TOP`, authored by the house account and pinned forever. It is guarded by title, so
re-running the file will not leave two of them, and it can be taken away either from the panel in
the app or with

  delete from public.forum_threads where title = 'PINNED TO THE TOP' and anchor_kind = 'board';

(which takes the pin with it, by the same cascade the table keeps).

Pinned comments on a profile
----------------------------
Section 19 adds two columns to `profile_comments` - `pinned` and `pinned_at` - and they are the
board's pin in miniature, without a deadline. Pinning a comment on your own profile does one thing:
it takes the leading row of every run of three on the profile's feed, so a remark the page wants
read keeps coming back round as the strip goes past. A pin never lapses; it stays until the owner
takes it off.

  - **Two columns, not a table.** Which is the opposite of what section 18 does, deliberately: a
    board pin is the *archive's* decision about somebody else's post and outlives edits to it,
    while a profile pin is the page owner's own mark on a comment that lives on that page and dies
    with it. One row per comment, two columns, nothing to join.
  - **Who.** The profile's owner, on any comment their page carries: the remarks on the profile
    itself, and the ones left on the picture and the track. That is what the feed under the two
    columns is made of - all three kinds, each row tagged with what it is about (`PROFILE`, `P2`,
    `M1`) - so a pin on a drawing's remark has somewhere to lead. Both stores refuse anybody else,
    and the policy refuses again.
  - **What it may not touch.** The update policy is written for the owner's own page, but a policy
    cannot say *which* columns a write may touch - on its own it would hand an owner the right to
    rewrite what somebody said about them. The `profile_comments_guard_pin` trigger is what closes
    that: it lets a change to `pinned` / `pinned_at` through and refuses any change to the words,
    the byline, the time, the element a comment was written about, or whose page it is on, unless
    the writer is the comment's own author. A null caller - the SQL editor, the service role - is
    left alone, the way section 16's guard does it.
  - **Where it shows.** A small blue pushpin beside each row of the lists the page keeps - the
    comments on the profile itself (`[ 3 VISIBLE :: 1 PINNED ]` in the panel's title bar) and the
    remarks on the drawing and the track - drawn for the owner and nobody else. A comment that is
    pinned wears the same `PINNED` plate the feed draws. On the feed, one row in every three is a
    pinned comment, the pins taking the leading row in turn and everything else filling the two
    behind them (app/lib/profile/feed.ts). Nothing pinned means every comment in its scattered
    order.

The same file puts `profile_comments` in the `supabase_realtime` publication, which it had never
been in: the profile channel has always subscribed to that table, and a channel bound to a table
that is not published reports SUBSCRIBED and then delivers nothing at all - from any of its tables.
So this section is also what makes a comment left on a profile appear on an open page without a
reload, pins included.

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

Lore pages
----------
The archive's lore is written rather than drawn, and it is written *together*: /lore holds pages
that any signed-in account may open and any account may write on, with the writing merging as it is
typed rather than one save overwriting another (app/components/LoreEditor.tsx, Tiptap over Yjs).

A page is a row, and the writing inside it travels two ways:

  while a page is open      the editors merge over a Realtime channel named `lore:<slug>`, carrying
                            Broadcast messages: one Yjs update per change, plus presence for the
                            carets. The channel is *not* attached to the table, and the table is not
                            in `supabase_realtime` - a Yjs update is not a row, and a change feed
                            over this table would put every keystroke through the replication
                            stream and write a row per letter. It also means this feature can never
                            be the table that takes a channel quiet (see Realtime above).

  when somebody saves       the whole document is written to the row as base64 (`yjs_state`), with
                            the same writing as plain text beside it (`body_text`). The plain copy
                            is what a visitor who is not signed in reads, so the writing is never
                            locked away behind an account that only wanted to look.

The editor files the page a couple of seconds after the last keystroke, when the tab is put away,
and whenever somebody presses `[ SAVE NOW ]` - so the row is a snapshot rather than a stream, and
the worst a dropped connection costs is the last few seconds of typing. The editors keep merging
throughout, whether or not anything has been filed.

The address is the title read as a slug (`THE GLASS CORRIDOR` -> `the-glass-corridor`) and it cannot
be changed afterwards, because it is what every link to the page says. Both sides enforce its shape:
the site refuses to file a title that makes no address, and the table's `lore_pages_slug_shape`
check is the backstop.

A project with no backend at all still has live editing, which is the point of the split: the mock
store keeps its pages in localStorage and its room is a `BroadcastChannel`, and the handshake over
it is the same code (app/lib/lore/session.ts), so two tabs on one machine merge exactly as two
accounts do.

What the permissions actually allow
-----------------------------------
Read as an anonymous visitor (the public key, no session):

  profiles, profile_avatar_versions, forum_threads, forum_comments   all rows
  music_tracks, music_folders, lore_pages                            all rows
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
  music_tracks                   the files you uploaded, and only signed by you
  music_folders                  the folders you made, and only signed by you
  lore_pages                     pages you opened; *any* account may file one, which
                                 is what writing together means, and the policy holds
                                 the row to the account that filed it last
  comms_*                        only the two accounts in the conversation; a
                                 message can only be signed by its writer

Write, with no session at all: the board and the tag/comment shelves still accept
a row whose author is null, which is what "posting stays open to guests" means once
this backend is live (the mock store behaved the same way). Those rows have no
owner, so nothing can delete them through the API - only SQL, or a moderation
policy added on purpose. If guest posting turns out to be more trouble than it is
worth, the fix is one line per policy (`with check (author_id = auth.uid())`) plus

The arcade
----------
Section 23 adds `game_invites`: one row per challenge. Who asked, who was asked, which game, and
whether it has been answered.

  - **Readable by the pair.** The two accounts a row names, and nobody else. That is also what
    makes a match private: it is played on a realtime broadcast channel named after the invitation
    (`match:<invite id>`, see app/lib/games/channel.ts), and only the pair can read the id.
  - **Written by either of them.** The sender inserts it (the policy checks `from_user = auth.uid()`
    and that it is not addressed to them), the recipient answers it by moving `status`, and both may
    delete it: the sender cancels, the recipient clears one they have answered.
  - **Nothing about a game in progress is stored.** A board and a court travel over the channel and
    are forgotten. There is no match table, no move log and nothing to clean up: the worst a
    disconnect leaves behind is an invitation nobody answers, which the arcade shows as old.

The same section widens `forum_notifications` so the bell can carry a challenge: `kind` gains
`'invite'` (the constraint is dropped and re-made, so a project with section 17's rows keeps them),
`game_id` says which game, and `invite_id` points at the row with a cascade so deleting an
invitation cannot leave a notification behind. The menu's row then reads
`INVITED YOU TO A GAME` with a `[ ACCEPT & PLAY ]` plate, and opens `/games?invite=<id>` - which
answers the invitation and starts the match in one press.

  - **Two games, two ways of agreeing.** Tic-tac-toe needs no authority: both sides hold the board
    and apply the same rule to it, so an illegal move is refused on both ends. The paddle duel has
    one: the host steps the court and sends it out, while the guest sends only its paddle's position.
    Both live in app/lib/games/, pure and checked without a browser.
  - **Who may play.** Any signed-in, unbanned account. A guest may play solo, and is told why an
    invitation needs an account rather than being quietly refused.

`Temp/check-games.cjs` is the offline one, and it does not need a project: the rules of both games,
the four buckets an invitation is sorted into, the mock store walked end to end, and the third kind
of notification, which is where a paddle that never returned the ball was caught.
`Temp/probe-live-schema.cjs` asks the database for the table, the two columns, the widened
constraint, the policies and the realtime entry; the migration file ends with the same questions in
one result.

Until section 23 is in, nothing is broken but the invitations: solo play needs no table at all, the
games page says the store did not answer (`GAME_INVITES_NEED_MIGRATION`), and the bell simply has no
challenges to draw. `NEXT_PUBLIC_GAMES_DATA_SOURCE` moves the arcade to the local store on its own -
or back.

hiding the composer for signed-out visitors.

Sweeping the throwaway accounts
-------------------------------
Every check in `Temp/` that talks to a real project signs accounts up, because that is the only way
to ask a policy anything: a tag has to be filed by one account for another, and a policy cannot be
asked without a session. The client cannot delete an account - that takes the service role, which
the site never holds - so they accumulate in `auth.users`, and `auth.users` is what the user
directory on /users lists. A session of live checks therefore leaves a directory full of `probe actor`
and `diag <stamp>` accounts.

`supabase/cleanup/` is the sweep:

  throwaway-accounts-review.sql   read-only: lists the accounts the checks made, and counts what a
                                  sweep would leave, so the list is seen before anything is removed
  throwaway-accounts-sweep.sql    removes exactly those accounts plus anything they wrote, so no row
                                  is left pointing at nobody; idempotent

The sweep matches on the names the checks use - `cline-*@debaser.site`, `probe actor`, `probe to`,
`diag <stamp>`, `PROBE ACCOUNT` - so an account somebody really made is not touched by it. Run the
review first and read it.

`Temp/check-games-live.cjs` is the same ground, live: it signs two accounts up and walks the whole
path against the project - the challenger files an invitation and reads it back (allowed, because the
read policy names both sides), the invited account reads it and a reader with no session does not,
inviting yourself is refused, the invited account answers it and the challenger sees the answer, the
challenger''s screen hears the answer over realtime, the invitation is filed in the bell the way the
app files it (no read-back, with `game_id` and `invite_id`), and either side can clear it. It cannot
delete the two accounts it made, so sweep them afterwards - see "Sweeping the throwaway accounts".
