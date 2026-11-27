# SPEC: [ DEVICES ], YOUR OWN DEVICES IN A ROOM (Luke, 2026-11-27)

Luke, in his words, typed to the coordinator on 2026-11-27: "for room syncing, when signed into the same account, allow another
option in the top right called devices, which lets you mute devices or disable influence over them from the device you are
currently acting on, to sync with them or to sync them to you, all with icons in a nice creative and well done ui".

Built the same day, on top of the volume sync of `SPEC-rooms-your-room.md` Part 5 (the account's own line).

## Luke's answers (2026-11-27, word for word)
- To "DEVICES (your own devices on one account, in a room): where should the [ DEVICES ] key sit?": "Room window, top right
  (Recommended)"
- To "DEVICES: for each of your other devices, which controls should its row have?": "Mode switch + mute (Recommended)"
- To "DEVICES: the code may not draw icons (your asset rule). How should the device and mode icons be made?": "Text keys only"
- To "DEVICES: when you set a device to APART or FOLLOWS ME, how long should that last?": "Until you change it (Recommended)"
- The line the words travel on is the one he OK'd for the volume sync: LUKE, 2026-11-27, "Yes, add it (Recommended)" (two rules
  on `realtime.messages` for the channel `account:<own id>`, `supabase/migrations/20261127100000_own_device_line.sql`). DEVICES
  needs no further database change.

## What he sees
- **The key.** `[ DEVICES ]` on the room window's own title line, top right, beside `[ FIT ]`, only while another device of his
  account is in the room (and the room is live). It goes when the other device leaves.
- **The window.** DEVICES, in the house window:
  - THIS DEVICE: its name (a guess from the browser, `WINDOWS · EDGE`, until renamed) and `[ RENAME ]`; and, when this device
    was muted from another, a Rose chip `MUTED FROM <name>` with `[ UNMUTE ]`.
  - YOUR OTHER DEVICES HERE: one row per device, in the order they came in. A wire of font symbols says which way the following
    runs (`THIS ══▶ LAPTOP` it copies this one, `THIS ◀══ LAPTOP` this one copies it, `═╳═` apart, `◀═▶` nothing chosen), then
    the switch `[ FOLLOWS ME ] [ APART ] [ I FOLLOW ]` (the one chosen is a filled pill; pressed again, it clears to nothing
    chosen), `[ MUTE ]` / `[ ♪ MUTED ]`, and one line saying what the choice does in this room now.
  - In someone else's room, one line first: every device follows the host there, so the ways choose only the sound.
- **Both ends agree.** Setting the laptop to FOLLOWS ME on the PC makes the laptop show I FOLLOW for the PC.
- **Kept until changed** (his answer): on each device, in its own browser storage. Nothing is stored anywhere else.

## Decisions
1. **A device is an open tab.** Each tab takes an id; a browser keeps a short list of its ids, and an open tab holds one by a
   lock, so a tab closed and opened again on the laptop is the laptop again, and a reload keeps its id. Two tabs on one PC are two
   devices (two rows), as they are two players.
2. **Nothing chosen is today's rule:** the device touched last leads play, pause and jumps in your own room (device-lead.ts),
   and the sound follows both ways (Part 5 of `SPEC-rooms-your-room.md`).
3. **The sound, in any room:** a device takes volume and mute only from a device it follows, or from any while nothing is
   chosen between them. FOLLOWS ME: it copies this one's volume, and its own turns don't move this one. APART: neither. The music
   bar's volume in your room goes by the same rule.
4. **Play, pause, jumps and skips, in a room your account hosts:**
   - FOLLOWS ME / I FOLLOW decide which device leads. The follower never takes the room: its PLAY, seek and skip keys give way to
     `FOLLOWING <name>`, a press in its player goes back to the room, and a song played in from elsewhere isn't put on (the bar
     says `FOLLOWING <name> · CHANGE IT IN [ DEVICES ]` for a few seconds).
   - APART: the device playing the room when APART is chosen keeps it; the other is ON ITS OWN: it stops following the room's
     play, pause and jumps, and its own PLAY/PAUSE and seek move only itself. Its skip and back keys hide in the room window
     (they would move the room for everyone); the music bar's NEXT and back say `ON ITS OWN BESIDE <name> · CHANGE IT IN
     [ DEVICES ]` instead (a follower's say `FOLLOWING <name> ...`). What is on still follows the room: when the keeping device moves to the next thing, the other gets it,
     paused, as a press on its own PLAY starts it.
   - In someone else's room both devices follow that host whatever is chosen; the ways change only the sound there.
5. **MUTE from DEVICES:** the muted device is silent (its room player and its music bar) whatever the shared mute or volume says.
   It still takes the shared level, so the sound comes back where the others have it. Lifted by MUTE again on any of your
   devices, by its own `[ UNMUTE ]` in DEVICES, or by its own room speaker key or volume line (sound asked for at that device;
   the one on the music bar's recess counts). Its speaker key says `MUTED FROM <name>`. Kept until lifted, but in force only while another device of yours is in the room,
   where DEVICES shows it: alone, nothing on screen would say why the device was silent.
6. **The words on the line** (`OwnDeviceMessage`, `app/lib/watch/repository.ts`): every message now carries the device that said
   it (`from`); `hello` (presence key, name, the ways it holds, whether it is muted from DEVICES), `pair` (a way chosen, as the
   sender sees it, stamped so two ends that disagree settle on the later choice), `mute-device`. A device from before DEVICES
   sends no `from`; its sound is taken as from a device with nothing chosen.
7. **No icons drawn** (his answer, "Text keys only"): bracket keys, a filled pill for the one chosen, font symbols (`══▶ ◀══ ═╳═
   ◀═▶ ♪`). No SpriteSlot, no CSS or SVG art.

## Where it is
- `app/lib/watch/own-device-modes.ts`: the ways, with no React or browser (`playbackRole`, `takesSoundFrom`, `hearMode`,
  `nextStamp`, `guessDeviceName`).
- `app/lib/watch/own-device-book.ts`: this tab's device id (Web Locks) and its book in local storage.
- `app/lib/watch/use-own-devices.ts`: hello, pair and mute on the account's line, for the room.
- `app/lib/watch/room-devices-key.ts`, `app/components/WatchWindow.tsx` (`RoomDevicesKey`): the key on the title line.
- `app/components/RoomDevicesWindow.tsx`: the window.
- `app/components/WatchRoom.tsx`: the lead rule, the follower's and ON ITS OWN's keys, the sound filter, the mute.
- `app/lib/watch/use-own-bar-volume.ts`: the bar's volume by the same rule. `MusicPlayerProvider` `setSilenced`: the bar silent.
- Both stores carry the new words as they are (both read them through `readOwnDeviceMessage`).

## Proof
- `scripts/drive-same-account.cjs` steps 12-17 (`--only-devices`), mock, two tabs on one account: the key alone and with two;
  FOLLOWS ME, I FOLLOW and APART for play, pause, jumps and volume; MUTE silencing only that device and lifted by its own
  speaker key; the way kept through a reload of either tab; the key going when one device leaves. Shown failing on the code
  before DEVICES.
- `Temp/check-explain.cjs`: words on every new key.
- Live: one short check with two TEST ACCOUNT A connections, that the new words cross the account line.

## Out of scope
- Phone layout beyond not breaking (desktop first).
- Devices not in the room: the window lists only the ones here now; a way chosen for a device is kept for when it comes back.
- Renaming another device from this one (each device names itself).
- Players that take no orders (PeerTube, the Archive's player, LUKE'S SERVER with its remote off): no device follows them,
  as before.
