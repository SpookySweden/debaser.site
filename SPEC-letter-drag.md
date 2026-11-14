# SPEC: drag a letter onto a person (Luke, 2026-11-14)

Luke's answers are in. Waiting for his OK on this finished spec; nothing is built until then.
Built on SPEC-letters.md and SPEC-recommendations.md.

## What Luke asked for
- F6: "you can drag and drop letters from the profile page to users on the sidebar or directly to a users character to
  reccomend them the letter."
- F7: "the character plays a cute animation when grabbing it."
- Asked which "grab" he meant, he typed "Both" (main session, 2026-11-14): a character catching a dropped letter plays a
  cute catch animation (this spec), and the companion gets its own lift animation when picked up (the COMPANION
  session's, live since a927f4c).

## Luke's answers (typed in the main session, 2026-11-14)
| Question | Answer |
|---|---|
| Q1. Which letters can you drag? | "A: Any you can see". Your own letters, and someone else's PUBLIC letter on their profile, which arrives with `FROM <NAME>'S LETTERS` as its note. |
| Q2. What happens when you let go on a person? | "C: Sends at once". No box, no undo. This sets aside the site's "one press opens, one commits" rule for this one action, by his choice. |
| Q3. When does the character do its catch? | "A: When it lands". With no box, the catch and the send happen together. |
| Q4. The way without dragging | "A: SEND TO in letter". A `[ SEND TO ]` key inside the opened letter, beside its cog. |
| Q5. Dragging on a phone | "dont worry about coding phone specific stuff, the phone version of the site will be worked on separately all in one go once the desktop version is feature complete and smooth". Desktop only; no phone-specific dragging. |

## What exists today (read from the code, 2026-11-14)
- **Recommending a whole letter already works**, from the RECOMMENDATIONS page: YOUR LETTERS, `[ ADD THE LETTER ]`, pick
  people, SEND. What is sent is a **copy of the letter as it is at that moment** (its name, description, colour, stamp and
  where each thing sits), never a link to the live letter. The person gets a notification ("RECOMMENDED YOU SOMETHING")
  and a `NEW` mark on their RECOMMENDATIONS key, and the envelope in their list opens the letter's canvas.
- **Sending goes through one guarded database function** (`recommendation_send`). It refuses guests, banned senders,
  yourself as a receiver, an empty letter, more than 50 things, more than 20 people, and **more than 50 sends a day**.
- **Taking one back:** the sender's `[ DELETE ]` on the SENT tab removes it for everyone, its notification included.
- **Who can be picked today:** everyone the site lists (the hidden test accounts are left out). The site has no way to
  block a person, so there is nobody who "can't receive" beyond that.
- **Dragging:** the site already has pointer dragging that works with a mouse (the stream queue's rows, the room canvas).
- **The side panel's people list** shows the first 12 people.
- **Characters:** the profile's ROOM holds the profile owner's character; companions walk along the bottom of the screen
  (your own, and those of people in the same stream room). Since a927f4c each one says whose it is
  (`data-companion-of` on the strip, `data-character-of` in a profile's ROOM), and one call,
  `companionCatches(userId)`, makes that person's character play its `catch` once on this screen (looks up, jumps for it,
  hugs it, wriggles). It is a picture only: it sends and stores nothing, does nothing under reduced motion, and an older
  character without the catch frames hops instead. A drop finds a character by its box on screen, because a companion
  lets presses fall through it.

## The design
### Which letters, from where
- Any letter you can see on a profile: **your own** (public or private) on your own profile, and **someone else's public
  letter** on theirs. Passing on someone else's letter sends `FROM <NAME>'S LETTERS` as its note, so it never looks like
  yours.
- An empty letter can't be sent (there is nothing in it): letting go says `EMPTY LETTER: NOTHING TO SEND` and nothing
  goes. A letter with more than 50 things sends its first 50, and the confirmation says so.
- You must be signed in with a full account. A visitor or a guest can't pick a letter up.

### While dragging
- Press a letter and move 6 pixels: a small copy of its envelope and name follows the pointer. A press without moving
  still opens the letter, as now.
- **Because a drop sends at once, the targets have to be unmistakable.** Everyone who can catch it lights up the moment
  the letter leaves its place, with the site's dotted outline in the accent colour: each person's row in the side
  panel, and each character on screen that belongs to someone else. Yourself, and the letter's own owner, never light up.
- The one under the pointer changes to a solid outline, and the dragged envelope says where it will go: `→ NAME`. With
  nothing lit under the pointer it says nothing, and letting go there sends nothing.
- A drop only counts when the pointer is inside a lit target. Letting go anywhere else, or pressing Escape, puts the
  letter back.
- A character stops walking while a letter is in the air, and its catch area is a little bigger than its picture.

### What a drop does
- **It sends at once** (Luke's Q2). The letter's copy goes to that one person, the same way the RECOMMENDATIONS page sends.
- A plain confirmation shows where the letter landed, for a few seconds: `SENT "MIXTAPE" TO NAME`. The same words stay
  under the LETTERS title until the next send, where a screen reader also hears them.
- A failure (the 50-a-day limit, no network, not signed in) shows the reason in the same two places, and nothing is sent.
- **Taking it back** is the existing `[ DELETE ]` on RECOMMENDATIONS → SENT. No undo key is added.
- If the drop was on a character, it **catches the letter as it lands** (`companionCatches`), at the same moment as the
  send. If that person's companion is on screen and the drop was on their side-panel row, the companion catches too.

### Without dragging: `[ SEND TO ]`
- An opened letter's window gets a `[ SEND TO ]` key beside its cog (on your own letters and on other people's public
  ones). It opens a small box: a people picker (search by name; the same list as the recommendations page, at most 20
  people), one optional line for a note, `SEND` and `[ CANCEL ]`.
- This is the way for a keyboard and a screen reader, the way to add a note, the way to send to several people at once,
  and the only way to reach someone who isn't among the 12 in the side panel.
- No phone-specific work (Luke's Q5, and his standing rule for the whole list). A phone's own way of sending a letter
  waits for the phone pass; `[ SEND TO ]` is built and proved as the desktop's keyboard way, and phone width is only
  looked at once to see nothing broke.

### The catch animation
- Played by the COMPANION session's `companionCatches(userId)` on the figure the letter was dropped on.
- No character, or an older character strip without the catch frames: that function already falls back to a hop, or to
  nothing. Sending never depends on the animation.
- Reduced motion: no animation; the confirmation still shows.

### Data
- **No database change.** A drop calls the same `recommendation_send` that the RECOMMENDATIONS page uses, with the letter's
  copy and one receiver. It writes the same four kinds of row (the recommendation, its things, who it is to, and the
  notification). The existing rules already cover it: the receiver and you are the only readers.
- Both data sources: the mock and the Supabase repositories already take a letter copy; one small shared helper builds
  the copy from a letter and its things (today that code sits inside the composer).
- The note of a recommended letter is shown on its row in RECOMMENDATIONS whenever there is one (today a note is only
  shown when the recommendation holds more than one thing), so `FROM <NAME>'S LETTERS` is always seen.

### Files
| File | Whose | Change |
|---|---|---|
| `app/lib/letters/letter-drag.ts` (new) | LETTERS | the pointer drag, finding what is under the pointer, the light-up |
| `app/lib/recommendations/send-letter.ts` (new) | LETTERS | builds the letter's copy and sends it |
| `app/components/LetterSendBox.tsx` (new) | LETTERS | the `[ SEND TO ]` box with its picker |
| `app/components/LetterDragLayer.tsx` (new) | LETTERS | the envelope that follows the pointer, the lit outlines over characters, the `SENT` confirmation |
| `ProfileLetters.tsx`, `LetterWindow.tsx` | LETTERS | pick-up on each letter; the `[ SEND TO ]` key |
| `UserDirectoryRow.tsx` | LETTERS | each row says whose it is, so a drop can find it, and lights up |
| `RecommendationComposer.tsx`, `RecommendationsPage.tsx` | LETTERS | the composer uses the shared helper; a letter's note always shows |
| `app/globals.css` (the letters block) | LETTERS | the lit and under-the-pointer outlines |
| `Companion.tsx`, `ProfileCharacter.tsx`, `app/lib/companion/**` | COMPANION | nothing: `data-companion-of`, `data-character-of` and `companionCatches` are live; they are read and called, not edited |
| `Temp/check-letter-drag.cjs`, `Temp/drive-letter-drag.cjs` (new) | LETTERS | the checks and the drives |

### Risks, said once
- **Accidental sends.** Luke chose "sends at once", so a slip onto a lit person does send, and they are notified. What
  keeps it rare: nothing is lit until a letter is in the air, a drop counts only inside a lit target, the envelope names
  the person before you let go, and Escape cancels. What mends it: `[ DELETE ]` on the SENT tab. If slips turn out to
  be common, the 5-second UNDO (his option B) can be added later without changing anything else.
- **Spam:** the 50-a-day limit already exists and applies. Nothing stops sending the same letter to the same person
  twice, and the receiver can't block a sender, because the site has no blocking at all. That is a gap in the whole
  site, not new here.
- The receiver's RECOMMENDATIONS key is off until they tick the module, so the notification is how most people will find
  the letter.

### Out of scope
- Dropping onto a person's name or face elsewhere on the site (board posts, comms, the room's member list).
- Dropping one letter on several people at once (the `[ SEND TO ]` picker does several).
- Blocking people. Anything phone-specific.

## Phases, each live on its own
1. **`[ SEND TO ]`:** the key in a letter's window, the box and picker, the shared helper, a letter's note always shown.
2. **Drag onto the side panel:** pick-up on the profile's letters, rows light up, a drop sends and says `SENT`.
3. **Drag onto a character, and the catch.**

## Proof
- **A limit to say plainly:** the test accounts are hidden from every list of people, so TEST ACCOUNT B never appears in
  the side panel or the picker on the live site, and a test must never send to a real person. With "sends at once"
  there is no CANCEL to stop at, so **no test ever lets go of a letter over a real person's row.** So:
  - Phases 1 and 2, on a local copy with made-up people: the whole path is driven (drag onto a row, read `SENT`;
    `[ SEND TO ]`, pick, SEND) and the recommendation is read back with its envelope. A drop on empty space, a drop on
    yourself, and Escape send nothing.
  - Phases 1 and 2, on the deployed site: TEST ACCOUNT A picks a letter up and carries it over a real person's row; the
    drive reads that the row is lit and the envelope names them, then presses **Escape**. The `[ SEND TO ]` box is opened
    and shut without SEND. A's count of sent recommendations is read before and after, and must not change. That the
    live database takes a letter from A to B, and that C can't read it, is already asked live by
    `check-recommendations`.
- Phase 3, on the deployed site, end to end: A and B in one stream room; A drops a letter on B's companion; B's
  RECOMMENDATIONS shows it with its envelope and B's notification arrives; the figure's motion reads `catch`, and with
  reduced motion it doesn't.
- Checks proven to fail without the fix; screenshots at desktop width, dark then bright theme (a phone-width picture
  only to show nothing broke).
- What the drives leave behind (recommendations from A to B, and a stream room) is listed for Luke; nothing is deleted
  without his OK.
