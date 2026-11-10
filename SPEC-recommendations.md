# SPEC: recommendations (Luke, 2026-11-10)

Part 2 of 3, built after SPEC-letters.md, because recommendations are made from letters.

## What Luke asked for
- A **RECOMMENDATIONS** button in the sidebar **under ARCADE**, and a new module in **MODULOS**, **off by default**.
- The recommendations page has **three parts**:
  1. **Recommendations from other users**, in the same look as the **stream queue** window.
  2. and 3. **Two panels with your own sources**, working the same way as the stream queue: search your letters,
     playlists and so on, add things to the same **pre-list** (like the queue's right side), then **order them into
     a queue on the left**.
- That queue can be **posted to another user (or several) or publicly**.
  - **Publicly:** it goes into the **forum** and shows as public on the main recommendations tab.
  - **To chosen people:** it shows in **their** recommendations tab.
- A recommendation can carry a **message**, which is its **title**. If it holds only **one** thing, it uses that thing's
  own title instead. If the message is **blank**, it also uses the thing's own title.
- When someone has **interacted** with a recommendation, their **profile picture** appears to the **right of its title**.
- The UI stays **very close to the stream queue's**.

## Luke's answers (2026-11-10)
| Question | Answer |
|---|---|
| MEDIA's old `[ RECOMMEND ]` key and RECOMMENDED list (SPEC-discover.md) | **The new page replaces them.** Past recommendations move into it as public one-item recommendations by the same person. MEDIA's RECOMMENDED *filter* (the algorithm's picks) is a separate thing and stays unless the build session finds it depends on the old key; if it does, ask Luke. |
| Telling someone they've been sent one | **A site notification** in the existing notifications, plus a mark on the RECOMMENDATIONS button until they open it. |
| What counts as "interacted" | **Played, read or watched** something in it (pressed LISTEN, WATCH or READ). Just opening it, or replying in its thread, doesn't count. |
| Where it can be posted | Publicly, or to one or more chosen people. |

## Open points the build session decides, then reports to Luke
- "Two panels of your own sources, one of which is letters": the **second panel** is read as **everything else you
  have** (things you've added to letters before, beat box songs, highlights, recent MEDIA plays), searched the way the
  stream queue searches MEDIA. If that isn't what Luke meant, ask him before building it.
- Blank message with **several** things: the title becomes the first thing's title, then `+ N MORE`.

## How it should feel
- The same window structure as the stream queue: rows coloured the same way, drag from the pre-list on the right into
  the queue on the left, a key for keyboards and phones, and reorder by dragging.
- A posted recommendation is a row: title, sender's picture and name, the time, then the pictures of the people who
  interacted, on the right of the title (at most 5, then `+N`).
- Opening one shows its queue. Each item has its WATCH, READ or LISTEN key (the same pop-up as letters).
- Public ones: a forum thread in a recommendations category, linked both ways.

## Firm lines and how they apply
- Items are references, as in letters. Titles and pictures come from their sources, and the message is plain text.
- **Privacy:** a recommendation to chosen people is readable only by the sender and those people (Row Level Security,
  not the browser). Interaction pictures show only to people who can read the recommendation. Visitors see public
  ones only, with ANON in place of names, as RECOMMENDED does now.
- **Database (Luke's OK first):** `recommendations` (sender, message, public flag, forum thread, time),
  `recommendation_items` (position, kind, ref), `recommendation_to` (who it was sent to, read time) and
  `recommendation_plays` (who played it, first time). Moving the old recommendations across is a data change
  that needs its own OK, with counts first. Mock and Supabase repositories both.
- The module is **off by default** in MODULOS, so nobody's sidebar changes until they turn it on.

## Out of scope
- Replies inside the recommendation itself (the forum thread is the place to reply).
- Recommending to groups or to everyone you follow.

## Proof (for the build session)
- Checks, asked live: a person-to-person recommendation can't be read by a third test account or a visitor; a public one
  reaches the forum; an interaction adds the picture; the notification arrives.
- Screenshots at desktop and phone width of the three parts, a drag from the pre-list into the queue, and a posted one
  with interaction pictures.
- The house loop in core.md through to `npm run read`.
