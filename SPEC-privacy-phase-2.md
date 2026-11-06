# Privacy, phase 2: private streams

Settled from Luke's privacy plan and `SPEC-privacy-decisions.md`, without an interview, as he asked.

## What he will see

**GO LIVE takes two presses now.** The first opens a small window, WHO CAN JOIN, with PRIVATE already picked. `[ START ]` starts the room.
GO LIVE used to open a room at once, but the choice has to be made before the room exists, and the house rule is two presses to
start something anyway. This window is the one `[ WATCH IN ROOM ]` opens later (`SPEC-floating-player.md`, part 3).

- `[ PRIVATE ]`: only people with the room's link.
- `[ PRIVATE + PASSWORD ]`: the link and a password. A PASSWORD field, shown as dots, with a `[ SHOW ]` key.
- `[ OPEN ]`: anyone, listed, as streams are today.

**Getting in.** Opening a private room's link asks `JOIN <ROOM NAME>?`, then for the password if it has one. An unnamed room says THIS ROOM:
the host's name is not given away. Pressing JOIN makes you a member. Signed out, it says to log in (guests come in phase 4).

**Inside the room:**
- The title bar says PRIVATE or PRIVATE + PASSWORD.
- The cog gains WHO CAN JOIN and CHANGE PASSWORD, for the host only. Saved passwords can't be read back by anyone, the host included; the
  host can replace one. A new host can change it without knowing the old one.
- `[ REMOVE ]` sits beside each person, for the host and crowns. The host can't be removed.

**Rules:**
- **Wrong password:** five wrong tries locks that person out of that room for 10 minutes.
- **Removed (decision 3):** they leave at once, can't rejoin that stream, and lose access to its private chat, queue and drawing. They can
  still read what was said while the room was open, as anyone can.
- **Latecomers (decision 2):** anyone who joins sees the whole stream.
- **Private to open while live:** it asks first: EVERYTHING SO FAR STAYS PRIVATE. Only new messages, strokes and queue items are open.
- **Open to private while live:** from then on only. What was said while open was already public, and the window says so.
- **No account reads a private room, the house account included (decision 8).** Moderation still works on people: bans and REMOVE work
  without reading what was said. Whoever runs the database can still read its tables directly, so the words are "no account on the site".

## What outsiders see in this phase
A private room is simply absent: not on the ROOM tab, no `[ TV ]` key, no board thread, no STREAM ART. **Phase 3** adds what the plan shows them
(`PRIVATE ROOM :: LIVE :: 4 IN ROOM`, ANON tags, bars) and the members' forum record. Until phase 3, a private stream has no forum record at all,
so nothing can leak onto the board.

## What stays as it is
- Rooms that exist today stay open, and everything already said in them stays readable. Nothing is rewritten.
- **Music rooms:** GO PUBLIC stays as it is. It is already a clear, deliberate press, and it means OPEN. Switched off, a music room is the host's
  alone. The plan's "same menu, and members who can talk" for music rooms is a separate step after phase 3, because it needs a new way to invite
  people into something with no stream to link to.

## How it is built
- `watch_rooms.privacy`: `private`, `password` or `open`. New rooms default to `private`, so any route that forgets to choose is private.
- `watch_members`: who joined and who was removed. The host is always a member.
- Passwords live in their own table that no reader can reach, scrambled with bcrypt. Attempts are counted in another one.
- The way in is one guarded function, `watch_join`. Changing the setting and removing someone are functions too. A room's setting can't be
  changed by writing to the room directly.
- Each message, queue item, canvas and stroke remembers the room's setting when it was made (`privacy_at_write`), so opening a room never
  opens its past.
- Read rules: open items to anyone, private items to members. The room's live channels follow the same rule, so a stranger can't hear who is
  in a private room or see strokes.
- The house account's special paths on room material now stop at open rooms.
- Both stores change together.

## Known limit, said plainly
A removed person's chat, queue and reads stop at once. Their tab also leaves the room's live channels, but a tab someone has deliberately altered
could keep hearing who is present and live strokes (never chat) until its connection next renews, at most about an hour. Realtime checks the
rules when a tab joins and when its sign-in renews, not on every message.

## Proof
- A three-browser drive on the live site: A hosts PRIVATE + PASSWORD; B joins with the password and chats; C gets it wrong five times and is locked
  out, and can't read the chat, queue, or who is there, even by asking the database directly.
- A removes B: B leaves at once and can't rejoin.
- Private to open: new messages read by a stranger, old ones not.
- The house account can't read a private room.
- `npm run verify`, the whole `npm run checks`, capture and audit, the code review, `npm run read`.
