# SPEC: queues become rooms (Luke's list P1 and P2; answers of 2026-11-14)

Status: written from Luke's eleven answers and **OK'd by Luke on 2026-11-14** (typed in the main session). Nothing is
built yet. The earlier draft (`SPEC-rooms-queues-draft.md`) is kept as it was.
Build from this in a fresh session, one phase at a time, each live before the next.

**Luke's OK, in his words (2026-11-14):**
- A, the database change (section 3): "Yes, OK (Recommended)". This OKs the one migration exactly as section 3
  describes it, changes 1 to 7. The building session still shows the dry run and asks again before pushing.
- B, the 90-day scheduled delete (what was change 8): "No, keep it". There is NO scheduled delete of own-room
  queues. Change 8 is not built and is not in the migration.
- C, the privacy line (section 4): "Yes, as written (Recommended)", without its last sentence, since B is no.
- D, the build order (section 8): "Yes, build in that order (Recommended)".

## Can the two risky answers be made safe? Yes, both, each with limits said here once

**1B, your room in the database from the first press: yes.** It costs about 80 small writes per listener per hour
and no live messages at all, because it writes only when something changes and never on a timer. Storage stays
level (it does not grow month by month). The lock is the database's own rules, using the private-room rules that
already exist. One thing needs a small database change, in its own section below.

**6B, pictures from any pasted link: yes, with three limits that cannot be removed.**
1. The site cannot cap how many megabytes an outside picture is unless that outside server tells us. Its width,
   height and loading time are always capped.
2. The site cannot check or control what an outside server shows, and it can change after it was added.
3. A viewer's browser has to call that outside server to show the picture, which tells that server the viewer's
   internet address.
So outside pictures are covered until each viewer presses SHOW, are marked as from outside, and can be taken off
by the host, a crown or whoever added them. Our server never touches them.

**Not part of either, but found while checking:** the cost that could really break the free plan is the one live
rooms already have (a write every 3 seconds, sent to everyone in the room). Easier GO LIVE means more of it. See
COST, and the optional phase 8.

---

## 1. LUKE'S WORDS AND HIS ANSWERS

> "rework the 'queues' feature entirely and implement its general ideas into the room function, have it retain your
> room queues and have queues be able to hold both picture and video, whenever you play music or watch a video on the
> site, have it open a room which is a real room but with also the ui basically scattered across the usual websites
> components, so that going live just gives you different access to the same functions"

> "at any time you can click the pop up above the music player to open the room window like usual and access all the
> usual stuff"

| # | Question | Luke's answer |
|---|---|---|
| 1 | Where does your room live while it is just you? | **B.** In the database from the first press. |
| 2 | One permanent room, or a new one each time you go live? | **A.** A new room each time you go live. |
| 3 | What is a playlist? | **A.** A saved queue: songs, videos and pictures. |
| 4 | "Picture" means? | **A.** Still pictures. |
| 5 | How does a picture take its turn? | **B.** It stays until somebody presses NEXT. |
| 6 | Where may pictures come from? | **B.** The site's sources and any pasted image link. |
| 7 | MEDIA's row key | **A.** PLAY / + QUEUE; GO LIVE is one key on the bar. |
| 8 | The SHELF's QUEUES key | **A.** `[ ↻ QUEUE ]`, opens your room's queue. |
| 9 | RADI-OH | **A.** A tab in the queue window. |
| 10 | Does your queue follow you between devices? | **A.** Yes, when signed in. |
| 11 | Does a live room that only plays music file a record? | **A.** Yes, every live room does (today's rule). |

---

## 2. THE DESIGN

### The one idea
**You always have a room of your own.** The first thing you play starts it. It is a real room in the database,
private, with only you in it. The site's usual parts are its parts:

| The room's part | Is this part of the site |
|---|---|
| Its controls (play, pause, next, volume) | the music bar |
| Its screen | the floating player for a video; the cover card for a song; a picture |
| Its queue | the queue window, opened by `[ QUEUE ]` on the bar and `[ ↻ QUEUE ]` on the SHELF |
| Its door | the pop-up above the bar: press it and the whole room window opens |
| Its saved queues | PLAYLISTS |

**GO LIVE lets people in.** It starts tonight's room (a new one each time, with its own record on the board) and
carries what you are playing and your queue into it. **END STREAM** brings what is left back to your own room.

### Your own room (the just-you room)
- **One per account, kept and reused.** Made the first time you play something while signed in. Never ended.
- **Private and unlisted, held by the database:** only you can read it. It is on no list, has no board thread,
  lights no lamp or TV key, and cannot be joined, even by someone who somehow had its address. The database
  refuses to switch it open (section 3, change 1).
- **It can never go live itself.** Going live always makes a new room (answer 2A). So nobody but you is ever a
  member of your own room.
- **It writes only when something changes** (COST). There is no timer.
- **No live connection is held for it.** Nobody else is in it, so there is nobody to keep in step. A second
  device of yours reads the room when you open the site there and when you come back to its tab. (Channel: a
  standing line between browser and database. None is needed, so none is opened.)
- **It follows your account (answer 10A).** Because the room is on your account, your queue, what is on and where
  you had got to are the same on your phone and your desktop. Nothing extra is stored for this.
- **It never starts by itself.** After a reload, or on another device, it is there but paused. Browsers would not
  allow the sound without a press anyway.
- **Playing never waits for the database.** A press plays at once in the browser and the database is told after.
  If the database cannot be reached the room carries on in the browser and catches up.
- **At most 200 things queued.** The last 20 things played are kept (the red part of the queue window); older ones
  are deleted as you play, so rows never pile up.

### A signed-out visitor's room
A visitor has no account, so the database will take no rows from them (and a stream-room guest is treated as
signed out everywhere outside the room they joined). **A visitor's room lives in their browser only:** same bar,
same queue window, same pop-up, kept in that browser, nothing sent anywhere. GO LIVE asks them to log in, as now.
When they do log in, what was queued in the browser is added to the end of their account's queue.

### How 1B and 2A fit together: what happens at GO LIVE and at END STREAM
**GO LIVE** (the key on the bar, in the room window, on the SHELF and on the STREAM page: one key, one meaning):
1. The WHO CAN JOIN menu opens, PRIVATE already picked, as now. Nothing happens until START.
2. START makes **a new room**, exactly as GO LIVE does today: its own address, its own record filed on the board
   (answer 11A: every live room files one; a private room's record is its members').
3. What you are playing goes in as that room's first play, from the same spot. The rest of your queue is copied in
   behind it, in order, in one go.
4. **Your own room is left untouched** while you are live. If the tab dies mid-stream, your queue from before is
   still there.
5. From here the bar, the screen and the queue window are the live room's. Chat, crowns, people's additions and
   the canvas are on. Adding follows the crown rule, as now.
- A song carries across with no gap (the bar's one player keeps playing). A video restarts from the same spot
  after a second or two, as WATCH IN ROOM does today, because a room's player is a different one from the platform's.
- With nothing playing, GO LIVE opens the empty black room with BOOKS / VIDEO / MUSIC, as now.

**END STREAM** (or leaving a room that carries on under a new host):
1. The live room ends as it does today. Its record and everything played in it stay.
2. Your own room's queue becomes **what was still waiting in the live queue**. What was on carries on for you
   alone, from the same spot.
3. The live room's address stops working, as an ended stream's does now. Next GO LIVE is a new room.

**Joining someone else's room** is as now. Your own room waits, untouched, and is there when you leave.

### What you would see
- **Playing a song:** as now. Up-next is your room's queue: it survives a reload, follows your account, and takes
  videos and pictures.
- **Playing a MEDIA video:** as now (the platform's own player, in its row or floating). It is on your queue, and
  `+ QUEUE` on another row puts that one behind it without stopping the first.
- **When something ends, the next thing starts,** whatever kind it is, where the player tells us it ended (RISKS).
- **The bar** names what is on (song, video or picture), with NEXT, `[ QUEUE ]` and `[ GO LIVE ]`.
- **The pop-up above the bar (P2)** is there whenever your room has something on. It says what it is in words, big
  enough for a thumb: `[ ▲ ROOM ]`, and `[ ▲ ROOM :: LIVE ]` when live. Pressing it opens the room window: the
  screen, the queue, the cog, the cover card. While it is just you the chat column holds one panel, `JUST YOU HERE`
  and `[ GO LIVE ]`; live, that panel is the chat.
- **MEDIA rows (answer 7A):** the two-halves key reads **PLAY / + QUEUE**.
- **The SHELF (answer 8A):** `[ ↻ QUEUE ]` opens your room's queue window.
- **The queue window's tabs (answer 9A):** UP NEXT, PLAYLISTS, RADI-OH. RADI-OH is the same plates as now, still
  kept in your browser.

### Playlists (answer 3A)
**A playlist is a saved queue:** a named, private list on your account that holds songs, videos and pictures in
order, each kept whole as a link (never a copy).
- Every queue you may arrange (your own, or one you host or hold a crown in) has `[ SAVE AS PLAYLIST ]`,
  `[ LOAD A PLAYLIST ]` and `[ CLEAR ]`. Today these exist only for the host of a music room.
- MY MUSIC shows every item in a playlist; today it hides the videos. Playing a playlist loads it into your room's
  queue, so videos and pictures play too.
- **The shared add-to-playlist helper** that MEDIA and PLAYER are building takes `{ title, link, trackId? }`
  (`link` is a WatchLink: an address, its kind and its title). What ROOMS changes inside it, in phase 4: it accepts
  every kind (today only what the music bar plays); a video or picture is stored as
  `{ trackId: 'link:<address>', addedAt, link }`, the shape stored queues already use; "is it already in the list"
  is answered by the link's address; and it gains a sibling, add-to-my-queue. The callers do not change.
- The saved-lists table needs no change: it already stores each item whole. There are 0 playlists to convert.

### What happens to each thing you can do today (nothing silently lost)
| Today | After |
|---|---|
| ADD TO QUEUE / PLAY NEXT on a song | Same keys, into your room's queue. Hosting live, the crown rule, as now. |
| Up-next lost on reload | Kept on your account (in the browser for a visitor). |
| The bar carries on down the shelf when up-next is empty | Unchanged. |
| PLAY FOR YOU's top-ups | Unchanged; they go onto your room's queue. |
| PLAY, PIP, BACK, FULL, POP OUT, resume a video | Unchanged. |
| `[ WATCH IN ROOM ]` on a MEDIA row | `+ QUEUE` from phase 1. The floating player keeps its own WATCH IN ROOM key until phase 3 replaces it with GO LIVE on the bar, so there is never a gap. |
| `[ ADD TO ROOM ]` while in someone's room | Unchanged. |
| GO PUBLIC (music) | Gone from phase 1; GO LIVE replaces it. OPEN is what GO PUBLIC meant; PRIVATE is new for music. |
| The kept "music room" | Becomes your own room. None exists in the database today. |
| The QUEUES list of live rooms, JOIN and `[ QUEUE ]` to peek | On STREAM's ROOM tab, where the same list already is. |
| RADI-OH | A tab in the queue window. |
| STORE + START BLANK, LOAD A LIST | SAVE AS PLAYLIST, LOAD A PLAYLIST, CLEAR, in every queue. |
| Cover card, crowns, additions, chat, canvas, STREAM ART, guests, passwords, the cog, looks | Unchanged; the shared ones only while live. |
| The board record of a stream | Unchanged (answer 11A). Your own room never has one. |
| The unused follow code (BroadcastHeartbeat, QueueFollower, QueueProfilePopout) | Left alone, as Luke asked. |
| The 43 rooms, 210 queue rows, 876 chat lines, 45 crowns in the database | Untouched. |

### Defaults taken without asking (say if any is wrong)
- A song that starts by itself (a profile's own song when you open the profile) does not touch your queue.
- Queueing something counts as your press for it, so when the queue reaches a YouTube video its player loads, as
  it already does for everyone in a live room. **Outside pictures are the exception:** covered until SHOW.
- No canvas or chat while it is just you.
- With two of your devices open, the newest press wins and the other catches up when you return to it.

---

## 3. DATABASE CHANGE FOR LUKE'S OK (can be read alone)

**One migration, pushed just before phase 1 goes live.** It covers phases 1 to 7. Nothing is deleted and no
existing row is changed. Written to be re-run (`if not exists`, rules dropped and recreated by name). The building
session writes the exact SQL, shows the dry run, and waits for the typed OK. (Migration: a file of database
changes. Policy: a database rule about who may read or change which rows.)

**No new table and no new column.** Your own room uses the room kind the database already has for "a person's own
kept room" (it is called `music` inside the database; that word stays, since renaming would touch every rule).

| # | Where | The change, in plain English | Why |
|---|---|---|---|
| 1 | `watch_rooms` (rooms) | **A new rule:** a person's own room can never be switched public. The database refuses. | So nobody can ever join or read it, whatever a browser sends. Today that kind of room could be opened with GO PUBLIC, which goes away. |
| 2 | `watch_queue` (queue rows) | The list of kinds a row may be gains **picture**. | Pictures in a queue. |
| 3 | `watch_queue` | A picture's address may be https or one of the site's own addresses (as a song's already may). | The site's own FILES pictures. |
| 4 | `watch_queue`, the delete rule | Recreated with everything it allows today, plus two things: **(a)** the owner of an own room may delete any row in it, played or not; **(b)** a picture not yet shown may also be taken out by the room's host and by whoever added it. | (a) so finished things are cleared and rows never pile up; (b) the guard Luke's answer 6B needs. |
| 5 | `watch_queue`, the row guard | At most **500 rows** in one person's own room; the database refuses more. | So nobody can fill the free plan from their own room. (The site itself stops at 220.) |
| 6 | Two existing functions (`watch_room_door`, `watch_room_outline`) | They answer "no such room" for somebody else's own room. | Today they would tell anyone holding a room's address that it exists and how many things are queued. The address cannot be guessed, but this shuts it properly. |
| 7 | One new function (`watch_picture_next`) | Lets the host **or a crown** of a live room take the showing picture off the screen. It refuses for anything that is not a picture, and for anyone else. | Answer 5B: a picture stays until NEXT, and a host who has stepped away must not freeze the room. |
| 8 | NOT BUILT (Luke, 2026-11-14: "No, keep it") | It would have deleted the queue of an own room nobody had touched for 90 days. Luke chose to keep queues. | An abandoned queue (at most 220 rows) simply stays. |

**What each rule lets whom do, after the change**
- Read an own room and its queue: its owner only. No other account, the house account included (the existing
  private-room rules already give no account a way in; this keeps that).
- Add to, reorder and remove from an own room's queue: its owner only.
- Join an own room: nobody. It is never public, and the way in refuses a room that is not.
- Everything about live rooms: as today, plus changes 4(b) and 7.

**Existing rows:** all 43 rooms are stream rooms and there are 0 own rooms, so rule 1 touches none. The 210 queue
rows, 876 chat lines and 45 crowns are not read or written by the migration.

**Not changed:** chat, crowns, members, passwords, canvases, the board's tables, saved lists (`music_playlists`
already stores whole links; the app starts writing videos and pictures into them, with no change to the table),
the old broadcast table, the listen log, FOR YOU's history, and which tables send live changes.

**Timing:** rule 1 makes today's GO PUBLIC switch fail (it would say THAT DID NOT SAVE), so the migration goes in
the same hour phase 1 removes that switch.

**Optional, separate, later (phase 8):** one number inside one existing function (`watch_take_over`: 8 seconds
becomes 45). Its own OK. See COST.

---

## 4. PRIVACY

**What 1B means, said plainly:** the database now holds what each signed-in person is playing alone.

**What is kept in your own room**
- What is on now, where in it you were, and whether it was playing, as of your last press.
- Your queue: each thing's address, kind and title, and when you added it.
- The last 20 things played. Older ones are deleted as you play.
- For how long: until you change or clear it. Nothing deletes it on a timer (Luke chose to keep queues).
- `[ CLEAR ]` in the queue window deletes it at once. ERASE on the account's PRIVACY tab should clear it too.

**Who can read it:** you. No other account can, the house account included, and nobody can join. That is held by
the database's rules, not by the browser. As the privacy plan already words it: whoever runs the database can read
its tables directly, so the promise is "no account on the site", not "nobody ever".

**Listening history already exists in two places**, so this is not the first record of what you play:
- The listen log (`music_listens`): every song a signed-in person hears for 30 seconds, as the file's address and
  the time. Only you can read your own; others see totals only, and not yours if you switched listening off. I
  found no rule that ever deletes it.
- FOR YOU's private history (`user_history`): one row per thing opened, played or read. Only you can read it. It
  deletes itself after 90 days and can be paused or erased.
- RADI-OH is in your browser only.

**What does not change:** a just-you room announces nothing. Live rooms keep every rule they have: PRIVATE by
default, the link is the key, passwords, guests, REMOVE, records private to members.

**The line the privacy page (`app/privacy/page.tsx`) needs, live with phase 1:**
> Your room: what you are playing and your queue are saved to your account so they follow you between devices.
> Only you can read them; no other account can, the house account included.

(OK'd by Luke as written here, 2026-11-14.) Phase 6 adds one more:
> A picture added from outside the site is loaded from wherever it lives, only after you press SHOW, and that
> server then sees that your browser loaded it.

**Signed out:** nothing leaves the browser.

---

## 5. COST

**Supabase's free plan, checked on its pricing page today (2026-11-14):** 500 MB database, 200 live connections at
once, 2 million live messages a month, 5 GB egress, and a project is paused after a week with no use.
The database holds **158 MB** now.

### What writes on a timer today
One thing: **the host of a live room writes where the video is every 3 seconds** (`WATCH_HEARTBEAT_MS`). That is
1,200 writes an hour **per live room** (per host, not per listener), and each one is sent on to every person in
that room. Viewers already work out the current position from "where it was, and when that was true"; the
3-second write exists so the room can tell its host is still there (take-over after 8 quiet seconds, "not live"
after 90, closed after 3 minutes).

### How the just-you room avoids it
- **No timer at all.** It writes when a thing starts, on pause and resume, when a seek settles, and when the
  queue is edited. Where the song is now is worked out from the position and the time of the last write, which the
  room already stores. The room is never ended or taken over, so nothing needs to know its host is "still there".
- **No live messages.** Nobody else can read the room and its owner holds no live connection for it, so its writes
  are sent to no one.

### Writes per listener per hour (estimates, not measured)
| What | Row changes |
|---|---|
| A thing starts (20 songs an hour): mark it, point the room at it, clear one old row | 3 each, about 60 |
| Pause, resume, seek | about 6 |
| Adding, moving, removing | about 10 |
| **Total, music** | **about 80 an hour** |
| Total, long videos | about 10 an hour |
| For comparison, one live room's heartbeat | 1,200 an hour |

### Three hours a day
| | 5 people | 50 people |
|---|---|---|
| Writes a day | about 1,200 | about 12,000 |
| Writes a month | about 36,000 | about 360,000 |
| Busiest moment, everyone at once | 1 write every 9 seconds | about 1 a second |
| Live messages a month | 0 | 0 |
| Live connections | 0 extra | 0 extra |
| Rows held, typical (40 each) to most (220 each) | 200 to 1,100 | 2,000 to 11,000 |
| Space held, with room for churn | under 2 MB | under 25 MB |
| Growth per month after that | none | none |

- Space was sized from the live table: a queue row averages 337 bytes, and the 210 rows there take 224 kB with
  their indexes, so I used 1 kB a row and doubled it for churn. It stays level because finished rows are deleted
  and the queue is capped.
- Against 158 MB used and 500 MB allowed, 50 people's rooms are about 5% of what is free.
- The free plan sets no limit on the number of writes; the limits that matter are space and live messages.

### Rows per event
| Moment | Rows written | Live connections |
|---|---|---|
| First play ever (signed in) | 1 room, 1 member, 1 crown, then as below | 0 |
| A thing starts | 2 changed, 1 deleted once 20 are kept | 0 |
| Add one thing | 1 | 0 |
| GO LIVE | 1 room, 1 member, 1 crown, 1 thread, 1 row per queued thing (at most 200, in one go) | as a stream today |
| END STREAM | 1 changed; your own queue rewritten (at most 200 out, 200 in) | 0 |

### Live rooms: left as they are in phases 1 to 7, and a recommendation
The heartbeat stays as it is, because take-over and "is it live" depend on it. But it is the cost to watch:
- One room of 5 people for 3 hours sends about 18,000 live messages. Every night for a month: about 540,000, a
  quarter of the monthly allowance.
- Ten such rooms a night would be about 5.4 million a month, more than twice the allowance.
- **Phase 8 (optional, its own OK):** beat every 20 seconds, still writing at once on every play, pause, seek and
  skip. That is about 180 an hour, roughly a seventh of the messages. It needs one number changed in one database
  function (take-over after 45 quiet seconds, not 8), so a host whose tab dies is replaced after about 45 seconds.
  I recommend it once GO LIVE is on the bar.

### One thing about cost outside this work
The listen log has no forgetting rule and grows by about one row per song per listener (it holds 442 rows now).
At 50 people it would grow faster than everything in this spec. Not changed here; flagged for Luke.

---

## 6. PICTURES

### What a picture entry is
A link to one still image (GIFs included), with its title and, where known, who made it and its licence. Never a
copy. Still pictures only (answer 4A).

### Where pictures come from (answer 6B)
1. The site's own FILES pictures and STREAM ART (the site holds these itself).
2. MEDIA image results and the GIPHY / Commons picker, from the hosts the site already trusts.
3. **Any pasted https image link.** These are "outside pictures" and carry every guard below.

### How a picture takes its turn (answer 5B)
- It goes on the room's screen and **stays until somebody presses NEXT.** No timer.
- **Simplest reading, and the one specced:** a picture is a stop. Nothing behind it plays until NEXT; a song that
  was playing has finished before the picture came up. (The other reading, the picture staying up as a backdrop
  while the songs behind it play, is not built.)
- **The screen** shows the picture, fitted, never stretched, with its title, maker and licence in plain text under
  it and a link out to where it lives.
- **The bar** shows the title, the word `PICTURE`, `HELD` where the time would be, and a large `[ NEXT ► ]`. No
  seek bar.
- **Who may press NEXT:** alone, you. In a live room, **the host and anyone holding a crown** (database change 7).
  Everyone else sees `WAITING FOR THE HOST`. Any viewer can hide a picture for themselves.
- Everyone in a live room sees the same picture at the same moment, by the same pointer that keeps a video in step.
- On the board's record a picture is a line of plain text with a link out, never the picture itself.

### The guards on an outside picture
| Guard | How |
|---|---|
| https only | Refused otherwise (`ONLY HTTPS LINKS`). The database already refuses anything but https for a link. |
| A real, public address | Refused: an address with a name and password in it, a port, a bare number address, `localhost`, a one-word or `.local` / `.internal` host. This stops a link aimed at a device on the viewer's own network. |
| Must be an image | Checked **in the adder's own browser, never by our server**: the browser loads it as a picture and must be able to draw it. If the outside server allows a "what is this" question (a HEAD request with sharing headers), the browser also asks its type and size. If the server refuses that question, or answers nothing, the drawing test alone decides. |
| No SVG | Refused by its name (`.svg`, `.svgz`) and by its type where the server says. (SVG: a picture format that is really a small program. Shown as a still picture it cannot run script, which is why the rare one that hides both gets no further.) |
| Size | **10 MB at most, where the server tells us the size.** Where it does not, this cannot be enforced; the time limit bounds it in practice. |
| Dimensions | At most **4,096 pixels on either side and 16 million pixels in all.** Always enforced. |
| Loading time | Loaded and drawn within **8 seconds**, or refused (`THIS PICTURE WOULDN'T LOAD`). |
| Every viewer checks again | The address rules, the dimensions and the time limit run again in each viewer's browser before the picture shows, because an outside server can swap the picture later and the adder's check proves nothing to anyone else. A failure shows `THIS PICTURE WON'T SHOW HERE` and chat carries on. |
| No referrer | Shown with `referrerPolicy="no-referrer"`, so the outside server is not told which page asked. |
| Never through us | Not proxied, cached, copied, resized or saved by our server or in the site's storage. Only its address and title are kept. No server route is added. (This is also why there is no server-side check: our server fetches only from a fixed list of hosts, and "fetch any address somebody typed" is what SPEC-watch-links.md refused.) |
| Marked | `OUTSIDE` beside it in the queue, and `FROM OUTSIDE THE SITE :: <host name>` on the screen. |
| Removable | Before it shows: by the host, by any crown, and by whoever added it (database change 4b). While it shows: NEXT by the host or a crown; any viewer can `[ HIDE ]` it for themselves. |
| Plain text | Its title and file name are drawn as plain text, never as HTML. |
| Who may add | Whoever may add to that queue. Guests cannot add to a queue at all, as now. |

**Can outside images load at all today?** Yes. The site sends no content security policy (the browser rule that
lists which hosts a page may load from) except inside the book reader, so a plain picture tag loads from any https
host. `next.config.ts` restricts only the image optimiser, to Supabase storage; outside pictures must not go
through the optimiser anyway, since that would fetch them through our server.

**The per-viewer switch (recommended default: covered).** Showing an outside picture makes the viewer's browser
call a server chosen by whoever added the picture; that server learns the viewer's internet address and browser.
So:
- A picture **you** added shows for you at once.
- Anyone else's outside picture arrives covered: `PICTURE FROM <host name> :: [ SHOW ]`, with
  `[ ALWAYS SHOW IN THIS ROOM ]`. Remembered in that browser only.
- Preferences gets `OUTSIDE PICTURES: ASK / ALWAYS SHOW / NEVER`, starting on ASK. A guest always gets ASK.
- MY MUSIC lists an outside picture by title with `[ SHOW ]`, never as a thumbnail that loads by itself.

---

## 7. FILES AND OWNERS

**ROOMS owns (per the plan file, after Luke's OK and after PLAYER has landed):** `WatchRoom.tsx`, `WatchWindow.tsx`
(the pop-up is here), `StreamQueueWindow.tsx`, `QueueWindow.tsx`, `QueueBrowser.tsx`, `MusicPlayerProvider.tsx`,
`FloatingPlayer.tsx`, `GoLiveWindow.tsx`, `app/lib/watch/**` (not the visualiser files), `app/lib/audio/queue-*`,
`app/lib/ui/floating-player.ts`. New, in `app/lib/watch/`: the own-room rules and its binder to the bar, the
browser-only room for visitors, the picture rules. New migration in `supabase/migrations/`.

**Needs from other groups**
- MEDIA: the two-halves key's second half sits behind one helper (being built now). ROOMS changes the helper's
  inside in phase 1 (below). `WatchInRoomKey.tsx`; the rows that call PLAY; `+ QUEUE` on image results in phase 5;
  `app/lib/web/hosts.ts` to tell a trusted host from an outside one.
- PLAYER: `MusicPlayer.tsx` (the bar naming a video or picture, `[ QUEUE ]`, `[ GO LIVE ]`, `[ NEXT ► ]` for a
  picture, the phone card's key), `SongMenu.tsx` (through the shared helpers), `CytubePage.tsx` (ABOUT's words;
  the one list stays on ROOM).
- CHROME: `SiteNav.tsx` (`SIDE_QUEUES` reads QUEUE and opens the own room's queue), `DesktopSidebar.tsx`,
  `StartMenu.tsx`, `ProfileControl.tsx`.
- LETTERS: `RecommendationComposer.tsx` reads playlists as a source and must cope with videos and pictures in one.

**Touched, owned by nobody on the list:** `PersonalLibrary.tsx`, `MusicLibraryProvider.tsx`,
`app/lib/audio/library.ts` and both music stores, `RadioLoops.tsx`, `MusicRoomKeeper.tsx` (becomes the keeper of
your own room), `ForYouRadio.tsx`, `VanityView.tsx`, `MediaCatalogue.tsx`, `app/layout.tsx`,
`WindowLayoutHost.tsx`, `PreferencesWindow.tsx` (the outside-pictures switch), `app/privacy/page.tsx`,
`supabase/README.md`.

**Both stores, every phase.** Rooms and music each have a mock store and a Supabase store; the mock keeps the same
rules by hand.

**Checks updated on purpose, none deleted:** `check-queues`, `check-watch`, `check-room-settings`,
`check-floating-player`, `check-music-library`, `check-library`, `check-audio`, `check-private-streams`,
`check-owed-renders`, `check-shell`. **New:** the own room's rules (no timer, pruning to 20, position from the
last write), the picture address rules, and a live policy probe (it writes, so it is named outside `check-*`).

**Notes for the building session**
- The room machinery already has a no-subscription read (`useWatchRoom(roomId, { follow: false })`). The own room
  must not mount `WatchRoom`'s presence, heartbeat, take-over, stale-close, watching-line or canvas parts: bind the
  bar to the own room with a small binder of its own.
- The queue window (`StreamQueueWindow`) already talks to a room through the repository, so it can serve the own
  room unchanged.
- The mock room store runs a whole room in the browser behind the same interface: the likely base for the
  visitor's room. It was written for testing and needs a proper read first.
- The floating layer sits over any registered box (`registerBox`), which is how it can be the room window's screen
  without the video reloading.
- `watch_room_door` was last recreated by the guests migration (`20261106194444`): change 6 starts from that version.
- Change 7 only clears the room's pointer; the host's tab already starts the next thing from a blank pointer
  (`blankStart`). The host's beat for a showing picture must not write the pointer back, the guard the black
  screen already uses.

---

## 8. PHASES (each live and useful by itself, smallest first)

**Phase 0: the database change.** Needs Luke's typed OK. Dry run shown first. Nothing on the site changes.
Pushed the same hour as phase 1.

**Phase 1: your room is real and kept.** Needs phase 0.
- You see: up-next survives a reload and is the same on your phone. MEDIA rows read PLAY / + QUEUE (the helper's
  inside becomes "add to the room I am in, else my own room", for audio and video alike). When a song or video
  ends the next thing starts. The bar names what is on. `[ ↻ QUEUE ]` on the SHELF opens the queue window with
  UP NEXT and RADI-OH. GO PUBLIC is gone. A visitor's queue is kept in their browser. The privacy page has its
  new line.
- Proof: a check of the own-room rules, seen to fail first. A drive as TEST ACCOUNT A: play three songs and count
  database row changes before and after; leave one playing for 60 seconds and show the room's row was not written;
  reload and find the queue; sign in as A in a second browser and find the same queue. As TEST ACCOUNT B and as a
  signed-out visitor, with A's room address in hand: every read returns nothing, the door says there is no such
  room, joining is refused. Screenshots at desktop and phone width, both themes.

**Phase 2: the pop-up and the room window (P2).**
- You see: `[ ▲ ROOM ]` above the bar whenever something is on; pressing it opens the room window with the screen,
  the queue, the cover card and JUST YOU HERE.
- Proof: a drive: play a MEDIA video, walk to the board, press the pop-up; the same video is the room's screen and
  did not restart. Screenshots at both widths.

**Phase 3: GO LIVE opens the door.**
- You see: GO LIVE on the bar and in the room window; START carries what is on and your queue into tonight's
  room; chat where JUST YOU was; END STREAM brings what is left back. The floating player's WATCH IN ROOM key is
  replaced by this.
- Proof: a two-account drive on the live site, A and B, with C locked out and a signed-out visitor: A plays alone,
  goes live PRIVATE, B joins by link and hears the same song within 2 seconds, adds one, A pulls it in; C and the
  visitor get no names, titles or words; the record is on the board for A and B only; A ends; A's own queue holds
  what was left. Everything the drive leaves is listed by id and deleted only with Luke's OK.

**Phase 4: playlists are saved queues.**
- You see: SAVE AS PLAYLIST, LOAD A PLAYLIST and CLEAR in every queue; the PLAYLISTS tab; MY MUSIC lists videos;
  ADD TO PLAYLIST takes a video.
- Proof: a check of save and load, seen to fail first. A drive: save a mixed queue, clear, load it back whole.

**Phase 5: pictures from the site's own sources.**
- You see: `+ QUEUE` on FILES pictures, STREAM ART and MEDIA image results; a picture holds the screen until
  NEXT; in a live room the host or a crown presses it; playlists hold pictures.
- Proof: a two-account drive: A queues a picture between two songs, the room holds on it, crowned B presses NEXT
  and the song starts for both; uncrowned B cannot.

**Phase 6: outside pictures.**
- You see: a pasted https image link can be queued; it is marked OUTSIDE; other people get it covered until
  SHOW; the switch in Preferences; the privacy page's second line.
- Proof: a check of the address rules (each refused kind), seen to fail first. A drive with a picture that is too
  big, one that is too slow, an SVG and a good one. A recording of network requests showing our server made none
  for the picture and that B's browser made none before SHOW. Removal by host, crown and adder.

**Phase 7: the QUEUES window retires.**
- You see: old `?queues=` links land on the new queue window; STREAM's ABOUT is rewritten for Luke to read.
- Proof: `npm run read` with `--absent` for the old window; the whole `npm run checks`.

**Phase 8 (optional): the quiet heartbeat.** Its own small database change and its own OK. See COST.

Each phase ends with the house loop (verify, checks, capture and audit, push, deploy-status, read) and a
fresh-context review.

---

## 9. RISKS (said once)

- **GO LIVE still has one hand-over,** because it makes a new room (answer 2A): a song carries across with no gap,
  a video restarts from the same spot after a second or two.
- **"The next thing starts by itself" depends on the player telling us it ended.** The site's own files, YouTube
  and Vimeo do. Internet Archive, PeerTube and friends' servers do not: there you press NEXT.
- **The bar's play and pause for a video** work only where the player takes orders. The site reads YouTube's and
  Vimeo's time by messages; whether it can pause them that way is not confirmed.
- **Outside players cannot be kept perfectly in step** (adverts, players that report no time). Unchanged.
- **Two of your devices at once** share one room with no live line between them: the newest press wins.
- **Own-room writes still make the database check its rules** for each person who has the list of rooms open,
  though nothing is sent. Small at these numbers; not measured.
- **An outside picture can be anything,** and is shown on the site's page even though the site does not hold it. A
  complaint about one would come to the site. The cover, the mark and the three ways to remove it are the answer;
  there is no way to vet it first.
- **An outside server could answer with an address on the viewer's own network** despite a public-looking name.
  The address rules cannot see that; browsers block most of it themselves.
- **A hotlinked picture can vanish or change.** The entry then says it will not show and waits for NEXT.
- **Browsers want a press before sound.** After a reload your room is back but paused.
- **This touches the two biggest files on this part of the site** (`WatchRoom.tsx`, 1,966 lines;
  `MusicPlayerProvider.tsx`, 1,305) while other groups work beside them. Start after PLAYER, MEDIA and CHROME land.
- **Easier GO LIVE means more live rooms,** each with the 3-second heartbeat (COST, phase 8), and more anonymous
  lines on the ROOM tab and the board from private rooms (answer 11A keeps today's rule).

---

## 10. NOT CHECKED

- Nothing was driven or built. No room was started. This is from the code, the migrations, two desktop screenshots
  of the live site and three read-only counts. Nothing was left behind.
- The write and space figures are estimates from the code and from the live table's row size, not measurements.
- Supabase's limits were read from its pricing page today. Whether a database change that is delivered to nobody
  counts as a "live message", and what Supabase does when the monthly allowance is passed, were not checked.
- Whether the floating player can pause YouTube and Vimeo by message.
- Whether the mock room store is fit to be the visitor's room.
- `WatchRoom.tsx` was read in part. The claim that the host's tab starts the next thing after change 7 clears the
  pointer rests on `blankStart` and the effect that uses it, not on a run.
- The phone-width look of the bar and the pop-up.
- The room-channel rules added after `20261105124800` (the private-streams migrations) were read for the tables,
  not line by line for the live channels. The own room opens none, so it does not depend on them.
- Which of the 43 rooms is the one not ended.

---

## 11. ADDENDUM: Luke's answers while phase 0 was being written (2026-11-14, typed in the main session)

The building session asked three things about the migration. His answers change the SPEC above in these places.

**The private-stream count (asked as question 2): "A: Stream rooms only (Recommended)".**
Under a file in FILES, STREAM CHAT shows `1 PRIVATE STREAM` bars for private rooms that played it. That count
(`private_stream_folds`) did not know an own room from a stream room, so a FILES video played alone could have shown
as a trace under the file. It now counts stream rooms only. This is change 8 of the first migration
(`20261114145645_own_rooms_and_pictures.sql`), and it is why an own room may hold one of the site's own files.

**A trial run of the migration (question 3): "B: No trial".** It is pushed once, in the same hour phase 1 goes live.

**Joining an own room (question 1), in his words:** "make it so that if you have someones link you can still join,
with the ability to refresh the link in the room settings next to where you copy it."

This changes "nobody can ever join your own room" (section 2, "Your own room"; section 3, changes 1 and 6; section 4)
to: **nobody can join without your room's current link.**
- An own room is still never public, on no list, with no board record, no lamp and no TV key.
- It can have ONE link, holding a long random secret, not the room's address. Until its owner first presses
  COPY LINK there is no link, and the room is exactly as locked as sections 2 to 4 say.
- Somebody signed in who opens the current link becomes a member: they hear and see what the owner plays, in step,
  and see the queue. Accounts only.
- REFRESH LINK (in the room's settings, beside COPY LINK) makes a new secret; the old link lets nobody new in.
- **Luke's answers on the link (typed in the main session, 2026-11-14 and 15):**
  - What a joiner may do: "A: Listen, see queue, add". They hear and see what plays, see the queue, and add to it;
    what they add waits on their own list until the owner pulls it in, as in a live room.
  - May a joiner draw? "Let them draw". A link joiner may open a canvas in an own room and draw on it (the existing
    canvas rule already lets a member do so, and it is left as it is).
  - Chat stays as it is: there is no chat in an own room. Chat comes with GO LIVE.
  - What REFRESH does to people already in: "B: Only stops new people". Nobody is put out by a refresh; people
    already in stay until the owner uses REMOVE (in the room's settings, where everybody who joined is listed).
  - The migration: "Yes, add it".
  - A person who was REMOVED is told so at the door ("removed"), not "no such room".
- Cost: a room nobody has joined costs what section 5 says. Only while somebody else is in the room does the owner's
  tab write a light "still here" beat, so they stay in step.
- Its database change is a second migration (`own_room_links`): one new table for the link's secret that nobody can
  read from the site, two new functions (the owner's link, joining by link), one condition added to the door and to
  the way in, and one condition added to the queue's adding rule. It is pushed with its own phase (after phase 2,
  where the room's settings live), not with phase 1.
- The privacy page then gains: "If you share your room's link, people who join with it can see what you play and
  your queue until you remove them. REFRESH LINK stops the old link letting anyone new in."
- The proofs become: B, C and a visitor holding only the room's address get nothing; B holding the current link
  gets in; after REFRESH the old link lets nobody new in and B is still in; after REMOVE, B is out.
- **The old QUEUES list (`QueueBrowser.tsx`):** Luke, 2026-11-15: "Delete it". It goes in the phase 7 clean-up, with
  its lines in check-queues and its entry in the structure check's waiting list.

**Standing rules from the same day:** no screenshots are sent to Luke (he looks at the site himself); testing is on a
local dev server with mock data, and the live site is only confirmed (`deploy-status`, `npm run read`) plus short
scripted policy checks for what only the live database can prove.
