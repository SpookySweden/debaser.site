# Moderation: report, block, hide

Luke, 2026-11-20 (list 5): "Moderation tools before the community grows: report, block, hide a post."
His answers to the interview: 1A 2A 3A 4B 5A 6B 7A 8A 9A 10A. What each one means is below.

## What is there today (mapped 2026-11-20)
- **The house account** (`debaser.site`, sign-in ADMIN1212) holds every moderator power through `public.is_admin()`. It can edit or remove
  anyone's open board post or reply, remove profile comments and open room chat lines, pin posts, hide a stream canvas, take over a group
  conversation, and **ban** an account (`profiles.banned_at/banned_reason/banned_by`, schema.sql section 12). A banned account can read
  but not write, and what it wrote is hidden from everyone but the moderator.
- **Nobody is a moderator on the live site right now.** `is_admin()` needs a row in `public.house_account` and an auth user with the house
  address. On the PC's database both are missing (0 rows each, checked 2026-11-20), so every power above is switched off.
- The house account's password is in the public code (`app/lib/auth/builtin-account.ts`). Luke left that alone on 2026-11-04 because the
  account had no real reach. Moderation would give it real reach, so moderation moves off it (answer 1A).
- Rooms: the host and crowns REMOVE people (`watch_remove_member`) and turn GUESTS CAN TALK off. Profile owners delete comments left on
  their own profile. Guests exist only inside stream rooms (SPEC-guests.md). The board, messages (COMMS) and profiles need an account.
- Missing: report, block, a hide that can be undone, a record of what moderators did.
- Things posted in a private room (`privacy_at_write = 'private'`) can't be read or removed by the moderator, by design. That stays.

## Who moderates (1A)
- **Moderators are a list of accounts.** It starts with Luke's own Google account. Luke can add or remove moderators later from the REPORTS
  window. Other moderators can't change the list.
- `is_admin()` is rewritten to mean "is on the moderator list", so every power that already exists (remove, pin, ban, canvas hide, group
  take-over) goes to the moderators without touching each policy.
- The house account is no longer a moderator. It keeps its job as the byline on item threads. It doesn't exist on the PC's database today,
  and nothing here brings it back.
- The first moderator row is written once, naming Luke's account by its id, never his address (the repository is public). That write waits
  for his OK like any other.
- In the mock store (local testing) the mock house account is the moderator, so local drives can see the moderator's view.

## HIDE (2A, 3A)
- A moderator can HIDE a board post, a reply, a profile comment or a room chat line from an open room. It disappears for everyone, at once.
- **Nothing is deleted.** Moderators still see it greyed with `[ HIDDEN ]`, its reason, and `[ UNHIDE ]`.
- The author still sees their own hidden post, marked `HIDDEN BY A MODERATOR` (10A). Nobody else does.
- Hiding a board post hides its replies with it. Unhiding brings them back.
- The moderator's existing REMOVE (deleting for good) stays, for spam floods. Bans stay as they are, and now ask for a reason that goes in the log.
- There is no "hide for me" for ordinary people (3A). They use BLOCK.

## BLOCK (4B, 5A)
One way: what you block disappears for you. The blocked person is never told, and can still see your public things.
- **Hidden from you:** their board posts and replies, their profile comments (on anyone's profile), their room chat lines, and your
  conversations with them (in COMMS, and their lines in group conversations you share). Their rooms drop out of your room list. Their
  activity doesn't reach your notifications (agreed with the NOTIFY session).
- **They can't:** start a conversation with you or send one to you, add you to a group, comment on your profile, or join a room you
  host. If they are in your room when you block them, they are taken out, the same as REMOVE.
- **Their profile:** opening it shows a plain card, `YOU BLOCKED THIS PERSON [ UNBLOCK ]`, in place of the profile (this covers their
  companion, letters and comments too).
- **Where:** a `[ BLOCK ]` key on a person's profile. PRIVACY gets a BLOCKED list with `[ UNBLOCK ]` keys. Unblocking brings everything
  back as it was.
- Moderators can't be blocked from doing moderator work (a block never hides anything from the moderator view).
- **Guests can't be blocked (5A)**, and guests can't block or report: outside a room the site treats them as signed out. Hosts keep
  REMOVE and GUESTS CAN TALK for guests.
- Who blocked whom is private: you see only your own list. Nobody else, moderators included, sees it in the site.

## REPORT (6B, 7A, 8A)
- **What is reported is an account (6B).** A `[ REPORT ]` key sits on a person's profile and in the small menu beside a post, reply, profile
  comment, room chat line or message.
- **The report form:** a reason (SPAM, HARASSMENT, NASTY, OTHER) and an optional line of text (up to 500 characters). Then `REPORT SENT`.
- **The thing it was reported from comes with it (8A):** when the report starts from a post, reply, comment, chat line or message, the
  database copies that one line's text into the report itself. It reads the line only if the reporter could see it, so nobody can pull
  text out of a room or conversation they aren't in. From a private room or a private conversation, the moderator sees **that one
  line** and nothing else of the room or conversation.
- **Limits:** 10 reports an hour per account, and one open report per reporter per account. The reported person is never told who
  reported them.
- **Where reports go (7A):** a `[ REPORTS ]` window that only moderators can open, from a key on the top bar that only moderators see,
  showing how many are open. Each report shows the account, the reporter, the reason, their text, the copied line with where it came
  from, and when. Keys: `[ HIDE ]` (when the line is a post, reply, comment or open chat line), `[ BAN ]`, `[ DISMISS ]`. Handled reports
  move to a DONE list.
- A new report also reaches moderators' notifications. The event's shape is agreed with the NOTIFY session. If NOTIFY isn't built when
  this lands, the top bar's count is the only signal.

## The log (9A)
- Every HIDE, UNHIDE, REMOVE, BAN, UNBAN, DISMISS, and every moderator added or taken off, is written to a moderation log: who did it,
  when, to what and to whom, and the reason.
- The log is a LOG tab in the REPORTS window. Only moderators can read it. It's kept forever, and nobody can edit or delete a line, not
  even a moderator.

## Telling people, and appeals (10A)
- A banned person sees `[ BANNED ]` with the moderator's reason wherever they would write, and one `[ APPEAL ]` box (500 characters).
  Their appeal arrives in REPORTS as an APPEAL. One open appeal at a time.
- A hidden post's author sees it marked `HIDDEN BY A MODERATOR`, with the reason.
- Nothing tells someone they were blocked or reported.

## Out of scope
- Automatic filters (word lists, spam detection), timed bans, warnings, moderator roles with different powers, email about reports,
  blocking guests, moderating inside private rooms beyond the one copied line, a "hide for me" key.

## How it is built (for the building session)
- **Database (one migration, on Luke's typed OK, after `npm run db:backup` and `db:push:dry`).** All new tables get Row Level Security
  and "guests stay out" (`Temp/check-guests.cjs` fails otherwise).
  - `moderators` (account, added by, when, owner flag). Readable by moderators. Changed only by the owner, through a function that logs it.
  - `is_admin()` rewritten to read `moderators`.
  - `hidden_at`, `hidden_by`, `hidden_reason` on `forum_threads`, `forum_comments`, `profile_comments`, `watch_messages`. Their read rules
    skip hidden rows except for the author and moderators. Hiding and unhiding go through functions that also write the log.
  - `blocks` (blocker, blocked, when). Each person reads and writes only their own rows. A helper, `has_blocked(blocker, blocked)`, is
    used by: the read rules of the four tables above and `comms_messages`, the write rules for starting/sending conversations, adding to
    groups and profile comments, and `watch_join` (and the block function takes a blocked person out of a room the blocker hosts).
  - `reports` (reporter, account, kind REPORT or APPEAL, reason, text, copied line, where it came from, state, handled by, when). Filed only
    through `file_report(...)`, which checks the limits, copies the line itself, and refuses lines the reporter can't read. Readable and
    handled by moderators only.
  - `moderation_log`, written only by those functions. Readable by moderators. No update or delete for anyone.
  - Bans move from writing the profile row directly to `ban_account(person, reason)` / `unban_account(person)`, which log.
  - `moderation_pulse`: one row whose time every hide and unhide moves, so open boards and rooms read again at once (a row that just
    became unreadable sends no live change of its own). `my_standing()`: a person reads their own ban, its reason and whether their
    appeal waits (the reason column is not readable to accounts).
- **App:** both stores (mock and Supabase) for blocks, reports, hides and the moderator list. `useAdmin()` reads "am I a moderator" from
  the store instead of comparing with the house account's id. New: the REPORTS window, its top-bar key, the report form, the BLOCK key and
  card, PRIVACY's BLOCKED list, the hidden/banned/appeal marks.
- **Proof:** locally on mock data (hide, block, report, log, appeal, at desktop width). A rolled-back check in `Temp/check-moderation.cjs`
  for the rules: a non-moderator can't hide, read reports or the log; a blocked person can't message, comment or join; a report can't copy a
  line its reporter can't see; log lines can't be changed. One short live check (`--live-check`) of the same rules as TEST ACCOUNTS A and B
  after the push.
- **Coordination:** the NOTIFY session gets the "new report" event and the "nothing from people you blocked" rule.

## Waiting on Luke
- His OK on this SPEC.
- Then, at build time, his typed OK on the migration and on the one write that makes his account the first moderator.
