# Privacy, phase 3: what outsiders see

Settled from Luke's privacy plan and `SPEC-privacy-decisions.md` (decisions 12 and 13), without an interview, as he asked.

The one rule: **the database hands outsiders the blacked-out version.** The real words, names, titles and pictures never reach their browser.
A blur or a black box on screen would not be privacy.

## Status
Done and live, 2026-11-06. Known limit: a new private record reaches other people's boards the next time they load the board, not live, because nobody gets an event for a thread they can't read. Somebody who joins sees theirs at once.

## What outsiders will see

| Where | Members see | Everyone else sees |
|---|---|---|
| ROOM tab | The room, as now | `PRIVATE ROOM :: LIVE :: 4 JOINED`, with no link: the link is the key (decision 1) |
| A private room's link | The room | The door (phase 2), and under it the outline below |
| People | Names | `ANON-417`, `ANON-23` |
| Chat | Every message | `ANON-417 :: 02:14 :: ███ █████ ██` |
| Queue | Titles | `3 IN QUEUE` |
| Canvas | The drawing | `DRAWING :: 214 STROKES BY 3`, no picture (decision 12) |
| The board | The stream's thread, full record and replies | `STREAM :: PRIVATE :: 5 NOV`, the record in bars, no replies, no reply box |
| STREAM CHAT under a file | The fold | `1 PRIVATE STREAM`, in bars |

- **Bars come in three sizes:** short, medium and long, never the exact length (decision 13).
- **Screen readers** hear PRIVATE MESSAGE, not block characters.
- **ANON tags can't be followed.** One person keeps one tag inside one room, and a different one in the next. Tags are random rather than in joining
  order, so the host isn't always the same number.
- **The count says JOINED, not IN ROOM.** The database knows who joined, not who has a tab open right now, so "in room" would not be true.

## The forum record
- **A private stream gets its thread back,** which phase 2 held off. Its members read it as today: the full record, and they can reply.
- **Replies inherit.** A reply on a private record is private to the same people, and nobody outside can reply. A reply made after a room goes private is
  private too, even under a thread that started in the open.
- **Going public later never exposes the past.** A record that started private stays private when the room opens. What is said after that shows in the room
  itself.
- **The thread can only be tied to a room by that room's host,** so nobody can file a fake record against someone else's room.

## How it is built
Five functions, each returning only tags, times, sizes and counts, never words, names, titles or a room's link:
`watch_private_rooms`, `watch_room_outline`, `stream_record_outlines`, `stream_record_outline`, `private_stream_folds`.

The board's private rows are drawn from those. The thread itself stays unreadable, so its title and author never leave the database.

Both stores change together.

## The house account (decision 8)
It moderates only what was made in the open: it can't read, change, delete or pin a private record or a reply to one. Only a thread made in the open can be pinned, because pins are public.
A record whose room no longer exists stays its author's to read and delete; somebody removed from a room that still exists gets nothing from that.

## Left out, said plainly
- **The `[ TV ]` key for fellow members.** The plan shows it to fellow members of a private room. Today it is shown to nobody for a private room, which is the safe
  side. Showing it needs a list of "which of my rooms is this person in", and it can come later if Luke wants it.
- **Names on the board for signed-out visitors** are phase 5.
- **Music rooms' menu** comes after this phase, as Luke chose.

## Proof
A drive on the live site: as test account C (locked out) and as a signed-out visitor, with every network response recorded, none of the test message's words,
the host's name or the queue's title appears anywhere. The room's name appears only for somebody signed in with the link, who sees `JOIN <ROOM NAME>?` as the plan
says (Luke's OK); a signed-out visitor is never told it. Screenshots of each outsider view at desktop and phone width, and the screen-reader
label checked. Also `npm run verify`, the whole `npm run checks`, capture and audit, the code review, and `npm run read`.
