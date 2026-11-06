# Guests in streams

Luke, 2026-11-06. This is phase 4 of the privacy plan (`SPEC-privacy-decisions.md`), narrowed to streams. His words: people with a link can join without an
account, private password rooms stay anonymised until the password, and "when you do something that may require a username, such as speaking, you are
prompted with a window to login in or create an account on the left side of the window, or a menu to input some simple details such as a user name for a
temporary guest account."

## What people see
- **/stream signed out:** ABOUT and ROOM. GO LIVE, CUSTOMIZE LAYOUT and CANVASES are for accounts.
- **Open rooms:** JOIN straight away. Nothing is made for somebody who is only watching.
- **Private rooms on ROOM:** anonymous lines with no key. The link is still the only way in.
- **A private room's link:** `JOIN THIS ROOM?`, with no room name, then ANON tags and bars until they get in. A password room asks for its password, and five wrong tries lock
  that guest out for ten minutes. Pressing JOIN makes the guest, with a placeholder name like GUEST-7Q2.
- **Speaking or drawing:** the first line, or the first press on the canvas, opens WHO ARE YOU?. Left: log in or create an account. Right: a name for a temporary guest. A phone stacks them, left first.
  With a guest name, a line sends as soon as the name is saved, and the canvas is ready to draw on. Logging in brings them back to the room with the words still in the box.
- **The room's cog:** GUESTS CAN TALK, on by default, for the host and crowns. Off stops guests drawing too. REMOVE works on guests.

## What guests can't do
Go live, add to or change a queue, save a canvas or stream art, place pictures or chat lines on a canvas, upload, use chat pictures (emotes are fine; a guest's line always draws as words, however it is spelled), post on the board, DM, have a profile, use MEDIA, take a crown or
be handed a room. Everywhere outside a stream room, the site treats a guest as signed out. A room still ends when its last account leaves.

**Drawing** is in (Luke, 2026-11-06, "OK, with drawing"): strokes, rubbing out and undo. A guest's strokes are credited by name when somebody with an account saves the canvas.

## Guest names
- 2 to 20 letters, numbers, spaces, - or _.
- The database adds ` [GUEST]` and writes the name on each of the guest's lines. The browser's word for it is ignored.
- Refused: another account's or current guest's name, ignoring capitals, spaces, punctuation and lookalikes (0 for O; 1 and I for L; 3 for E; 5 for S), and house words
  (anything starting guest or anon, anything with admin or debaser, and host, mod, moderator, staff, owner, system, unknown).
- Picked once, kept while the browser keeps the guest.

## Limits
- 5 lines in 10 seconds and 20 a minute per guest, and 60 a minute for all of a room's guests. Accounts aren't limited.
- 60 strokes in 10 seconds and 200 a minute per guest, and 600 a minute for all of a canvas's guests.
- 20 wrong guest passwords in 10 minutes shuts guests out of that room for 10 minutes, right password included. Accounts aren't affected.
- 30 new guests an hour per internet address (Supabase's own limit).
- **No Turnstile yet** (decision 11): Supabase's bot check also covers ordinary sign-ins, so it would probably stop the test accounts' sign-in. Not tried.

## How it is built
- A guest is Supabase's anonymous sign-in, kept under its own name in the browser and used only by the room stores (`app/lib/watch/room-client.ts`). Both stores have it.
  The mock store has no other guests or accounts to compare names with and no flood limits.
- **To Postgres a guest is an ordinary signed-in person**, so everything written for accounts lets them in unless told otherwise. Four things tell it:
  1. **The gate** (`guest_request_gate`, run by PostgREST before every request): non-guests pass on its first line, and a guest gets only what it names. New tables and
     functions stay shut to guests with nobody having to remember.
  2. **"guests stay out"**, a restrictive read rule on every table except the room's own. The gate can't see live changes or a read that embeds another table.
     `Temp/check-guests.cjs` fails if a new table lacks it.
  3. **Rules on `storage.objects` and `realtime.messages`**: the gate doesn't cover uploads or live channels.
  4. **The server routes** that take a session token refuse a guest's (`web-session.ts`, media upload, avatar, YouTube).
- Guests have hidden profiles, because room membership points at `profiles`, and no welcome tag.
- Presence carries a guest's name and `guest_id`, never `user_id`, so nobody can crown them or hand them the room, and their strokes are heard on the wire as they draw.

## Undo
The gate, in about a minute, by a route that doesn't pass through it:

    npm run db -- --write "alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';"

Guest sign-in: the project's Auth settings, Anonymous sign-ins, or `external_anonymous_users_enabled` through the Management API.

## Known limits
- REMOVE stops that guest, not a person who clears their browser and comes back through the link and password. GUESTS CAN TALK off is the answer to that.
- Guest records pile up until the tidy-up exists (decision 7). Deleting a guest today deletes their chat lines too (`watch_messages.author_id` cascades), but the decision says
  lines stay as FORMER GUEST, so the tidy-up has to change that first.
- KEEP THIS GUEST (linking Google to a guest) isn't built. Somebody who logs in after being a guest starts afresh as their account, and their guest's lines stay as the guest's.
- A guest could turn into a real account by hand with Supabase's own email change. The site offers no way to, and it would be an ordinary account with a hidden profile.
- A guest turned out by REMOVE or GUESTS CAN TALK can still send made-up strokes on the live wire from an altered tab. The timeline refuses them, so other tabs drop them within 30 seconds.
- An account's chat line still takes its name from the browser, which nothing checks. Separate from this work, and not changed here. One new effect: an account that writes [GUEST] after its name could use up a room's 60 guest lines a minute, and its pictures draw as words.

## Proof
`Temp/check-guests.cjs` (in the suite: rolled-back, makes no guests) and, live, `Temp/guest-probe.cjs` and `Temp/guest-drive.cjs`, which do make throwaway guests
to remove afterwards.
