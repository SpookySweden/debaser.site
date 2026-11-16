# SPEC: THE PERPETUAL ROOM (Luke's second list, ROOMMODEL; 2026-11-16)

Status: **OK'd, being built (Phase B).** Luke, 2026-11-16, in an interview with the list-2 coordinator: the plan
"Yes, build it"; **Q1 A** (the new room's queue starts empty), **Q2 A** (in someone else's room, PLAY from MEDIA asks:
play in your own room and leave theirs / add to their queue / cancel), **Q3 A** (take-over after 45 seconds), **Q4 "OK
as described"** at plan level only (the building session backs up, shows the dry run, and asks for his typed OK again
before anything is applied), **Q5 A** (`OwnRoomWindow.tsx` kept, unreferenced), **Q6 A** (a song does not open the
room window; only videos and the room's own door). ROOMFIX done 775497b the same day.

## Luke's words
> "regarding the pre room stuff we worked on, where any video or music now also plays in your own perpetual room,
> implement it so that when you open a video frmo media, it opens in your room not pip, make sure this also engages the
> room without the need to go live to get access to the room version of the music bar and all the other room features,
> going live just makes it public and for example if you go public, someone joins, you leave, that room can then be
> theirs and you just get a new perpetual room as soon as you play a video again, with that old room following the
> natural process depending on what happens to it, you can also ofc just remove people from the room and private it
> again and refresh the link etc to maintain the same one if you so choose."

> "make sure rooms dont end unless ended. or left empty while it is no ones 'main room'"

Before live and live should be "effectively exactly the same as eachother just that before you are live you have that
option to go live". His interview answers: the room passes to **whoever has been there longest**; a video from MEDIA
**opens the room window every time**, the video on its screen, not PIP.

## What this reverses, on purpose
- SPEC-rooms-queues.md, answer 2A ("a new room each time you go live"): GO LIVE no longer makes a new room. It
  announces the room you are already in. Nothing is carried across, so a video no longer restarts at GO LIVE.
- SPEC-rooms-queues.md, "Your own room": "never ended", "can never go live itself", "no chat while it is just you".
  It can now be ended, go live, be handed on, and has chat (with whoever joined by its link).
- SPEC-rooms-your-room.md, part 1 "As built": YOUR ROOM as a look-alike window over the floating player goes. The room
  you are in always opens in the live room's own window, with the live room's own players.

---

## 1. What a room is from now on

**One kind of room, in two states.** Every room works the same way: its own screen and players, the bar of keys under
the picture, the room's version of the music bar, the queue, crowns, chat, canvas, visualiser, the crawl, SUBS and
QUALITY, the cog. A room is either:
- **private** (before live): on no list, no lamp or TV key, no board record. Joinable only with its link. This is
  how every room starts.
- **live**: announced. On STREAM's ROOM tab and the side panel, with its lamp and TV key and a record on the board.
  Joinable by its WHO CAN JOIN choice (OPEN, PASSWORD, PRIVATE), as live rooms are today.

The one difference Luke sees between the two is the key: `[ GO LIVE ]` in a private room, `[ ● LIVE ]` in a live one.

**Your main room** is the room the site plays into for you. Each account has at most one at a time, made with the
first thing it plays. It is "yours" for good, until you end it or it is handed on. While you have one:
- every video and song you start plays in it (section 3);
- it never ends by itself: not when it is empty, not when you close the tab, not after a week;
- with nobody in it and nothing playing it simply rests; your next press wakes it where it was.

**A room that is nobody's main room** is a room that was handed on (section 3, "host leaves with people in it"). It
belongs to whoever hosts it now, but it is not their main room (they keep their own). It follows what live rooms do
today: it passes on to whoever has been there longest each time its host leaves, and once it is left empty it ends.

**A signed-out visitor** still has a room in their browser only (as today): the same window, the same bar, no link, no
chat, and GO LIVE asks them to log in. Nothing of theirs leaves the browser.

## 2. What Luke will see, in short
- Press PLAY on any video in MEDIA (or FILES): **your room's window opens**, the video on its screen, playing. Every
  time. The row itself no longer plays the video in place, and nothing floats unless you press `[ PIP ]`.
- Play a song anywhere: it plays in your room. The music bar is the room's bar (the room's keys in it, as in a live
  room today). The window does not open for a song unless you press the door `[ ▲ ROOM ]` (question Q6).
- In the window: exactly the live room's window. The chat column is chat; with nobody else in, it says JUST YOU HERE
  above the empty chat with `[ COPY LINK ]`. The last key on the picture's bar is `[ GO LIVE ]`.
- `[ GO LIVE ]` opens WHO CAN JOIN (PRIVATE picked, as now); START announces this same room. Nothing restarts, nothing
  moves, the picture keeps playing. The key becomes `[ ● LIVE ]`, which opens the same menu to change who can join or
  `[ GO PRIVATE ]`.
- The cog has COPY LINK and REFRESH LINK, the list of who is in with REMOVE, and `[ END ROOM ]` (two presses).

## 3. What happens on each event

| Event | What happens |
|---|---|
| **Play a video from MEDIA or FILES** | It is filed in your main room as playing (made now if you have none) and your room's window opens with it on screen. If the window is folded on the shelf it unfolds. If the room was live, everyone in it sees it too (you are its host). |
| **Play a video while you are in someone else's room** | Question Q2. Recommended: a small ask, `PLAY IN YOUR ROOM` (you leave theirs) / `ADD TO THEIR QUEUE` / `CANCEL`. |
| **Play a song** | Filed in your main room as playing, on the room's music bar. The window stays as it is (Q6). |
| **The room window is closed (X) or folded** | Never leaves the room. Your room plays on in the bar, as a live host's does today; the door `[ ▲ ROOM ]` brings the window back. |
| **GO LIVE** | The same room is announced with the WHO CAN JOIN choice. Its board record is filed the first time it goes live; if the same room goes live again later, the same record is used (a room has one record). Chat, crowns and the queue are already on, so nothing else changes. The room starts its "still here" beat (every 3 seconds, as live rooms do), which is what lets a room be taken over if your tab dies. |
| **Someone joins** | Before live: only with your link (as today). Live: by WHO CAN JOIN. They hear and see what plays, in step, chat, see the queue, and add by the room's ADD rule and crowns, exactly as in a live room today. Before live this is new: today a link joiner can only add to their own list and has no chat. |
| **You leave a live room with people in it** | It becomes theirs: the person who has been in it longest (this visit) hosts it, queue, settings and chat as they were. It is no longer anyone's main room. You have no main room until your next play, which makes you a new one (Q1 says what its queue starts with). |
| **What "leave" means for the host** | Pressing `[ LEAVE ]` in the cog (it says `<NAME> WILL HOST`), going into someone else's room, signing out, or closing the tab. A closed or crashed tab hands on only after **45 seconds** of silence (today's live rooms wait 8), so a reload never loses you your room (Q3). |
| **You leave a live room that is empty** | Nothing ends: it is your main room. It drops off the lists after 90 seconds of quiet (as a live room's lamp does today) and rests, still live; when you come back and press PLAY it is on the lists again. |
| **You leave a private room with link joiners in it** | It stays yours (it is not public, so it is not handed on). Joiners see `<NAME> IS AWAY` and the picture holds where it was. |
| **A handed-on room's host leaves** | It passes to the next longest there, again and again. |
| **A handed-on room is left empty** | It ends: off the lists after 90 seconds of quiet, closed in the database 3 minutes after (both as live rooms do today). Its record and everything played in it stay. |
| **REMOVE** | As today: in the cog's list; the person is out, told "removed", and cannot come back by the link or be handed the room. Host and crowns may remove. |
| **GO PRIVATE** | Off every list, no lamp, back to "joinable only by link". Everybody already in stays (as today's private switch warns: use REMOVE for anyone who should not). The record on the board stays. Chat carries on. |
| **REFRESH LINK** | As today: a new secret, the old link lets nobody new in, nobody already in is put out. Works before live and live. |
| **END ROOM** | Two presses. The room ends for everybody in it, live or not; its record and plays stay. What was playing stops. Your next play makes you a new main room. |
| **Somebody else ends a room you were in** | As today: THIS STREAM HAS ENDED. |

**The link while live.** A main room keeps its one secret link (COPY LINK / REFRESH LINK) before and during live. A
live PRIVATE room is joinable by that link only; OPEN and PASSWORD also let people in from the lists. (Today a live
room's plain address is its key; for these rooms the link is, so REFRESH LINK keeps its meaning.)

## 4. Where YOUR ROOM still differs from the live room today, and how they become the same

Today YOUR ROOM (`OwnRoomWindow.tsx`) is a look-alike: the live room's frame drawn round the site's floating player.
Missing from it today: the room's own players (so no Twitch, live streams or HLS in it, `LIVE_ROOM_ONLY`), QUALITY,
SUBS, the visualiser, the canvas, the crawl, chat, the look switch and topic line, the room's keys on the music bar,
PLAY FOR ALL, JOIN PLAYBACK, browser picture-in-picture for files, HIDE on a held picture, END. Its FULL fullscreens the
floating box, not the room's stage.

**How they become the same:** they stop being two windows. Your main room opens in the live room's window
(`WatchRoom.tsx`), bound to your main room, so every one of those parts is simply there. What the live room does that a
private, alone main room must not do is switched by the room's state, not by a second window:

| Part of the live room | Private main room | Live main room |
|---|---|---|
| Players, keys, QUALITY, SUBS, visualiser, canvas, crawl, FULL, PIP, music-bar keys | on | on |
| Chat | on (useful once someone joins by link) | on |
| Presence (who is here) and the live line to the database | only while someone else may be in: the link has been used, or the room window is open with joiners listed | on |
| The 3-second "still here" beat | off (writes only on play, pause, seek, as today) | on |
| Take-over when the host's tab is gone | off (it is not public, so it is not handed on) | after 45 seconds |
| Stale close (ends after 3 quiet minutes) | never | never (only rooms that are nobody's main room) |
| On the lists, lamp, TV key, board record | no | yes |
| `NOT ON THE BOARD` notice | no | if filing the record failed |
| Last key on the picture's bar | `[ GO LIVE ]` | `[ ● LIVE ]` |
| END | `[ END ROOM ]` in the cog | `[ END ROOM ]` in the cog |

`OwnRoomWindow.tsx` is then unused. It stays in the repo, unreferenced, with a one-line comment saying why (house rule),
unless Luke says delete it. Phase B lists every caller of the floating player (`playFloating`) and moves each video one
onto the room; the floating player's code stays for whatever is left, and unreferenced if nothing is.

**What "one room" removes:** GO LIVE's carrying (`go-live-carry.ts`: the song carried across, the video restarted from
its spot, END STREAM bringing the queue home) is no longer needed for a main room, because nothing moves. It stays for
the 1 live stream room open today until it ends, then is unused.

## 5. Database change (for Luke's typed OK; can be read alone)

**One migration. No row is changed or deleted. No new table or column.** Draft:
`rooms-perpetual-migration-draft.sql` in the shared notes folder (not in the repo, not run). The building session
re-reads each function it recreates from its latest version, backs up, shows the dry run, and asks again before
pushing. Read-only counts today: 4 main rooms (all private, none ended), 1 live stream room, 50 ended, 1 room link,
91 member rows, 238 queue rows.

| # | Change, in plain English | Why |
|---|---|---|
| 1 | "One main room per person" becomes "one **open** main room per person". | So a person whose room was handed on, or who ended it, gets a new one on their next play. |
| 2 | A main room may be announced (live). Today the database refuses. | GO LIVE announces the room you are in. |
| 3 | The room guard: a main room's host may end it; its live switch and privacy change only through change 4; it changes hands only through changes 5 and 6, and at that moment it becomes an ordinary stream room, never back. | So nobody can flip someone's room public or take it, and a handed-on room follows today's stream rules. |
| 4 | New function: GO LIVE / GO PRIVATE for a main room, host only, with WHO CAN JOIN and a password as today's. | The key. |
| 5 | New function: hand a live room on to a member who is not removed, host only. | LEAVE with people in. |
| 6 | Take-over: also for a live main room, after 45 quiet seconds (stream rooms keep 8). | A dead tab hands on; a reload does not. |
| 7 | Chat: a main room's link joiners may chat before live. | "All the other room features" before live. |
| 8 | Four existing rules gain one condition each: the door and the outline answer "no such room" for a main room only while it is private; joining follows WHO CAN JOIN once it is live; the private-stream count under a file counts live main rooms; a main room's members add by the room's ADD rule and crowns as in a stream room. The 500-row cap and the owner deleting any row stay. | So a live main room behaves as a live room does today, and a private one stays as locked as today. |
| - | Not changed: stale close (ends only rooms that are nobody's main room), crowns, members, passwords, links, canvases, the board's tables. | |

**Privacy, after the change.** A private main room is exactly as private as today's own room. A live one is exactly as
visible as a live room today. The privacy page's lines change: "Your room is private until you press GO LIVE. If you
share its link, people who join can see and hear what you play, see your queue and chat, until you remove them.
REFRESH LINK stops the old link letting anyone new in. GO LIVE puts your room on the site's lists, with a record on the
board, until you press GO PRIVATE." (Wording for Luke's OK with the rest.)

## 6. Cost
- **A private main room costs what it costs today:** writes on play, pause, seek and queue edits, no timer, no live
  messages. The live line to the database opens only when someone else may be in it.
- **A live main room costs what a live room costs today:** the 3-second beat, sent to everyone in it (SPEC-rooms-queues
  COST: about 18,000 live messages for 5 people over 3 hours). Easier GO LIVE (one press, no carrying) may mean more
  live rooms. SPEC-rooms-queues' optional phase 8 (a slower beat) is still the answer if that cost bites; not in this
  spec.
- **Chat in private rooms** adds nothing until someone joins and talks.
- Not measured; estimated from the code as in SPEC-rooms-queues.

## 7. Files (Phase B)
- Mine (ROOMMODEL): `app/lib/watch/own-room.ts`, `own-room-client.ts`, `go-live.ts`, `go-live-carry.ts`,
  `repository.ts`, `supabase-watch-repository.ts`, `mock-watch-repository.ts` (both stores keep the same rules: the
  mock's `handOver` is looser than the database today and gets the host check), `rules.ts` (`roomIsLive`, the main-room
  state, `handoverTo` unchanged), `use-watch-room.ts`, the migration.
- ROOMFIX's, after "ROOMFIX done": `WatchRoom.tsx`, `WatchWindow.tsx` (the door, the window for a main room),
  `OwnRoomWindow.tsx` (retired), `FloatingPlayer.tsx`, room players in `app/lib/watch/`.
- Others', a few lines each, said in `list2-checkin.md` first: `WebStream.tsx`, `WebMediaRow.tsx`, `KinoSources.tsx`,
  `WebSiteFiles.tsx` (FEED's area: PLAY calls "play in my room" instead of `playFloating`), `MediaCatalogue.tsx`,
  `TagStation.tsx`, `MusicPlayer.tsx` (PLAYERBAR's: the room's keys already reach it through the portal; only which room
  is bound changes), `MusicPlayerProvider.tsx`, `MusicRoomKeeper.tsx`, `GoLiveWindow.tsx`, `GoLiveKey.tsx`,
  `RoomSettingsWindow.tsx`, `CytubePage.tsx`, `DesktopSidebar.tsx`, `StreamQueueWindow.tsx`, `own-screen.ts`,
  `app/privacy/page.tsx`.
- New code the room's players import never imports `app/lib/ui/floating-player.ts` (a9b6af9).

## 8. Phase B, in verified steps
1. **The database change and both stores** (after Luke's typed OK): the new functions in the Supabase store, the same
   rules by hand in the mock. A new check, `Temp/check-rooms-perpetual.cjs`, drives every event in section 3 against the
   mock, each assertion watched failing first.
2. **Your main room opens in the live room's window**, switched by its state (section 4). Local drive on the mock
   server: play a song, open the door, every part of section 4's table is there; GO LIVE in place, nothing restarts.
3. **PLAY in MEDIA and FILES opens the room window** with the video on its screen, every row kind (WEB, YOUR YOUTUBE,
   KINO free copies, a server's rows, site files). Local drive.
4. **Leaving, handing on, take-over, ending, GO PRIVATE, REFRESH, REMOVE, a new main room on the next play.** Local drive
   with two made-up accounts on the mock (the mock's presence works across two tabs).
5. One short live policy probe through `heavy-step.cjs --live` for what only the real database proves: B cannot announce
   or take A's room; B with A's link chats before live; A goes live, leaves, B hosts, the room is a stream room; A's
   next play makes a new main room; the old room ends when left empty. Everything it leaves is listed by id; deleting
   waits for Luke's OK.
Then the house loop once per batch (League mode: one heavy step at a time, low priority), `code-reviewer` on the diff,
`npm run read` on the live site, "ROOMMODEL done <commit>".

**Checks updated on purpose, none deleted:** `check-own-room`, `check-watch`, `check-floating-player`,
`check-room-settings`, `check-private-streams`, `check-queues`, `check-guests`, `check-hide-window`; drives
`drive-own-room.cjs`, `drive-rooms-your-room.cjs`, `drive-floating-player.cjs`.

## 9. Risks (said once)
- **This is the biggest change to rooms since they were made.** `WatchRoom.tsx` (about 2,000 lines) has to serve a
  room that is private and alone without presence, beat or take-over. The old own-room spec warned against mounting
  those parts for it; this spec mounts the window and switches those parts off by state instead. A slip there costs
  live messages or hands a room on wrongly. The check in step 1 and the probe in step 5 are aimed at exactly that.
- **Losing your room is permanent.** Once handed on it is theirs and cannot be taken back (as a live room today). The
  45-second grace is what stops a reload doing it; a host whose connection drops for longer than that while live
  loses the room.
- **MEDIA rows no longer play in place.** Every video opens the room window over the page. Some readers may want to
  keep browsing while it plays: the window folds to the shelf with `[ _ ]` and keeps playing.
- **YouTube and Vimeo in the room's own players** (not the floating player's frame) are what live rooms already use, so
  nothing new, but MEDIA's server rows and KINO free copies have only been played in the floating player until now.
  Each kind gets a drive in step 3; one that cannot play in a room keeps a link out.
- **A board record per room, not per stream.** A room that goes live, private and live again keeps one record.
- **More live rooms, more beats** (section 6).
- The real YouTube, Vimeo and Twitch players in a room, two real accounts and phones are proved only as far as step 5.

## 10. Questions for Luke (each answerable with a letter; recommended first)
- **Q1. After your live room is handed on, your new room's queue starts:** **A. empty**, only what you play next (the
  old queue stays with the people in the old room) / B. with a copy of what was still waiting when you left.
- **Q2. You are in someone else's room and press PLAY on a video in MEDIA:** **A. a small ask**: play it in your room
  (you leave theirs), add it to their queue, or cancel / B. it plays in your room at once and you leave theirs /
  C. it goes on their queue.
- **Q3. Your tab dies while your room is live with people in it. They take it over after:** **A. 45 seconds** (a
  reload never loses your room) / B. 8 seconds, as live rooms do today.
- **Q4. The database change in section 5:** **A. Yes, OK as described** (the building session still shows the dry run
  and asks again before pushing) / B. not yet.
- **Q5. `OwnRoomWindow.tsx` once unused:** **A. kept in the repo, unreferenced** (house rule) / B. deleted.
- **Q6. Playing a song opens the room window too:** **A. No, only videos** (as you asked; a song plays in the room's
  bar and the door opens the window) / B. yes, every time.

## As built (Phase B, 2026-11-16)
- **The window:** an account's main room opens in the live room's window (`WatchWindow.tsx` `RoomWindow`, `WatchRoom.tsx`).
  Its X folds it (it plays on; the key above the player brings it back). Badge PRIVATE / LIVE.
- **The keys** (`MainRoomKeys.tsx`) are on the picture's bar, where END STREAM sits for a stream, not in the cog:
  `[ GO LIVE ]` / `[ ● LIVE ]` (WHO CAN JOIN; SAVE; GO PRIVATE), `[ LEAVE ]` while live with somebody to hand it to
  (its tip names who will host), `[ END ROOM ]` (two presses). COPY LINK, REFRESH LINK and REMOVE stay where they were.
- **GO LIVE elsewhere:** the music bar's `[ GO LIVE ]` and CYTUBE's open your own room on WHO CAN JOIN (the room is
  written first if nothing was played yet). No separate stream room is made for an account any more.
- **PLAY:** a MEDIA or FILES row's video that names its source (`room` on the floating entry: WEB, YOUR YOUTUBE, site
  files, the catalogue) opens your room (`main-room-play.ts`, from `MusicRoomKeeper.tsx`). In somebody else's room the
  small ask comes first (Q2 A).
- **Switched by state:** the host's beat only when announced; take-over only when announced (the store's 45 s);
  lamps and lists only when announced; presence off for a private main room until somebody else's member row
  appears (they used the link). The room's change feed is open while its window is.
- **A reload while live:** your room comes back folded above the player, so its beat carries on (otherwise its people
  would take it after 45 seconds).
- **NEXT on a picture:** any room's host or crown, a main room's too (migration change 13, `watch_picture_next`).
- **The visitor loop PLAYERBAR found** ('Maximum update depth exceeded' when a visitor played a song): the keeper now
  hands the bar a new up-next only when what is in it changes (`MusicRoomKeeper.tsx`); their probe gives 0 errors.
- **A new room:** after END ROOM or a hand-on, the session (`own-room.ts` `renew`) starts a blank room, written with
  the next play; its queue is empty (Q1 A).
- **Not done, said here:** a signed-out visitor keeps the old YOUR ROOM window (their room lives in the browser and
  has no link or chat), so `OwnRoomWindow.tsx` is still used for visitors; KINO free copies and a media server's rows
  carry no source and still play in the floating player; `[ WATCH IN ROOM ]` still makes a separate stream room;
  `<NAME> IS AWAY` for joiners of an away host is not drawn; the 3-minute close of a handed-on room and the
  45-second take-over are proved on the mock store and in the migration, not live (the migration waits for Luke's
  typed OK).
- **Proof:** `Temp/check-rooms-perpetual.cjs` (8, two mutations caught), `scripts/drive-rooms-perpetual.cjs` (9 on a
  mock server).

## 11. Not checked
- Nothing was built or driven. This is from the code (two read-only maps of the room and MEDIA code, the migrations'
  latest functions read in part) and read-only counts.
- Every caller of `playFloating` outside MEDIA and FILES (profiles, the board, letters) is not yet listed; Phase B
  lists them and moves each video one.
- Whether the live room's window, switched to "alone", really opens no live line: proved in step 2 by counting the
  page's realtime channels in the drive.
- The full SQL of change 8's four rules: described here, written in Phase B from their latest versions.
