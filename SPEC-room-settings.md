# Room settings (Luke, 2026-11-05)

## What Luke asked for
- The `[ LIVE ]` tab on the STREAM page reads `[ ROOM ]`. `[ GO LIVE ]` stays.
- A settings cog inside a room, where its name and other settings change. "Any other stuff you can think of, and keep the
  UI neat."

## Luke's answers
- The host and anybody holding a crown can use the cog; nobody else sees it.
- In the first version: name, topic, who can add, and your look.
- Added by the building session under "any other stuff": copy the room's link. It needs no database change.
- Database OK'd in chat: three new fields, one function, one condition on the queue's add rule. Nothing deleted.

## How it behaves
- **ROOM NAME** (up to 60) replaces the host's name in the room's title bar, and shows on the ROOM tab and QUEUES list.
  Blank goes back to the host's name.
- **TOPIC** (up to 120) is one line beside the chat, shown to everybody in the room. Blank shows nothing.
- **WHO CAN ADD:** ANYONE (as every room always was) or CROWNS ONLY. Under CROWNS ONLY other people can't add, and the
  queue window says so. What they added earlier stays, and chat stays open.
- **SAVE** saves those three. Closing with unsaved words asks first.
- **ROOM LINK** and **YOUR LOOK** act at once. Your look is your own: it colours rooms you host, never someone else's.

## How it's built
- `watch_room_settings` is the only way a crown holder can write to a room, and it writes those three fields only.
- Viewers work out the video's place from `position_seconds` at `updated_at`, and any write stamps `updated_at`. So a save
  while playing walks the position forward, or everybody's picture would jump back.
- Both stores do this: `mock-watch-repository.ts` and `supabase-watch-repository.ts`.
- Accepted from review: `updated_at` is also the host's heartbeat, so a crown's save restarts the clocks for take-over (8
  seconds) and for ending a quiet room (3 minutes). A room only stays open while a crown keeps saving, which is harmless.
- Accepted from review: a crown who loses their crown with the window open sees it close, and typed words go with it. The
  save would be refused anyway.

## Out of scope
Chat locks, room passwords, a topic on the forum record, and renaming `[ GO LIVE ]`. The room's name doesn't reach the
forum thread, which still reads STREAMING A VIDEO.
