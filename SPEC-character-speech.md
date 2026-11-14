# SPEC: characters speak (Luke, 2026-11-14)

**Answered by Luke on 2026-11-14 (his answers are quoted below). Not to be built until he has typed his OK on this
finished spec, and picked the lettering (A, B or C in the picture sent to him).** Build it in a fresh session after reading
CLAUDE.md, `.claude/rules/core.md`, `docs/design.md`, `docs/profile-characters.md`, `docs/companion.md`,
`SPEC-profile-characters.md` and `SPEC-companion.md`.

## What Luke asked for (his words)
- "if a character is on the profile or in a room that is from a profile who has made a comment on the viewed profile,
  have any comments made on the profile by that person, or comments in reply to that person by spoken as pixelated urr urr
  urr undertale looking text."
- "give the character box on the profile an audio button on the top right which starts muted, when unmuted you can hear
  what they are saying using the audio speech synthesiser spec from my game dev project."
- The synthesiser: a wide search of his drives found no such spec (`speech-synth-search.md` in the sessions' notes
  folder). His answer: "Make our own blip voice (Recommended)".
- Desktop first: "dont worry about coding phone specific stuff, the phone version of the site will be worked on separately
  all in one go once the desktop version is feature complete and smooth".

This overturns one line of `SPEC-companion.md` ("Still no talking", and speech bubbles listed as out of scope), on Luke's
own words above. **A character still never says anything its own person did not write.**

## Luke's answers (2026-11-14, typed in the main session)
1. Where: "C: Both at once". A profile's ROOM, and stream rooms (companions speaking).
2. Who is in a profile's ROOM: "A: Commenters visit". Up to 3 of the newest commenters' characters walk in.
3. Where the words show: "B: Bubble over head". A speech bubble over each character, moving with it.
4. Lettering: "A: Chunky pixel font". He picks from the three shown to him (Pixelify Sans, VT323, Press Start 2P).
5. When: "randomly semi frequently".
6. Long comments: "A: Two-line pages".
7. Replies: "i mean any general replies theyve made to anything that user said or posted, clicking the bubble goes to the
   post etc."
8. Which comments: "random selection of all".
9. Voice: "A: From the character".
10. The audio key: "B: Remember my choice".

## What exists already (checked 2026-11-14)
- **The character box** is the profile's ROOM (`app/components/ProfileRoom.tsx`): the last thing on a profile. It holds at
  most two figures today: the owner's SHOWN character and the viewer's own companion, which climbs up into it. Both are
  `RoomWalker`s (`ProfileCharacter.tsx`). The COMPANION session has finished and released these files (its status file,
  2026-11-14).
- **Stream and music rooms** show every member's companion along the bottom strip, or along the room window's top edge
  (`Companion.tsx`). A companion already hops with `...` when its owner says something in the room's chat
  (`companionSpoke` in `app/lib/companion/events.ts`, called from `use-watch-room.ts` with who and when, not the words).
- **Comments on a profile** (`profile.comments`): on the profile itself, on a picture, on the track. What a visitor may
  read is decided by `visibleFeedComments` (`app/lib/profile/visibility.ts`); the owner sees all. They carry no reply link.
- **The whole board is already in every browser** (`useForum().threads`): every post and reply this reader may read,
  each reply with who wrote it and what it answers (`parentId`), and a profile's comments as threads of their own. So
  "replies to anything that user said or posted" can be worked out with no new read and no database change.
- **Anyone's SHOWN character is readable by everyone** as pictures (`profile_characters`; `useShownCharacter(userId)`).
- **The board lands on an exact reply** from an address (`/forum#comment-<id>`, built for this list's F1), and a profile's
  COMMENTS opens at one comment (F3). A pressed bubble uses those.
- **No sound of this kind exists.** Browsers refuse any sound before the reader has pressed something on the page.
- **One typeface** (IBM Plex Mono, `app/theme/fonts.ts`). The site has no way to block a person (BARR marks a song).

## In a profile's ROOM
### Who is there
- The owner's SHOWN character and your own companion, as today.
- **Guests:** the SHOWN characters of the people who most recently commented on this profile (any of the three kinds, as
  this reader may see them), newest commenter first, at most 3, skipping the owner, you, and anyone with no SHOWN
  character. They walk and idle like the owner's character and wear their owner's name on hover.
- With nothing for anybody to say, no guests come and the ROOM is exactly as it is today.

### What each one says
Each character says only what its own person wrote, picked at random (his answer 8) from all of:
- **A guest, or your own companion on someone else's profile:**
  - their comments on this profile (the profile, a picture, the track);
  - their replies anywhere on the board to something the profile's owner said or posted (his answer 7): a reply under a
    post the owner filed, a reply to one of the owner's own replies, and a post or reply that names the owner with `@name`.
- **The owner's character:** the owner's own remarks on their own profile, and the owner's replies to the people whose
  characters are in the room just then (the same three kinds, the other way round).
- A line is not said again until that character's other lines have each had a turn.
- Only what this reader's browser already holds is ever used: a comment the owner has switched off, a private post, or
  anything else this reader may not read is not there to be said.

### How it looks
- **A speech bubble over the speaker's head, moving with it** (his answer 3): a black box with a thin outline in the
  window's ink and a small `▼` text mark under it, the speaker's name in their own name colour, then the words appearing
  a letter at a time in the pixel lettering he picks (16px or more; a token in `app/theme/fonts.ts`, loaded like the
  site's own face). The bubble is kept inside the ROOM's edges. No drawn art: a box, an outline and a text character.
- **The speaker stands still and faces the reader while it talks**, so the bubble can be read. A character that is being
  lifted, catching a letter or mid-wave finishes that first: speech never interrupts a motion.
- **The ROOM is a bubble taller for good** once anybody in it has something to say, so nothing on the page jumps when a
  bubble opens (the site's rule: a reveal takes its space in both states).
- **Pace:** about 25 letters a second, a short stop at `, . ! ?`, no easing.
- **Long lines** (his answer 6): pages of two lines; a page stays about 2.5 seconds after its last letter, then the next
  page replaces it.
- **When** (his answer 5, "randomly semi frequently"): one speaker at a time. The first bubble opens 2 to 4 seconds after
  the ROOM scrolls into view; after a bubble closes, the next opens after a gap picked at random between 6 and 16
  seconds, from a character picked at random among those with something to say. Nothing runs while the ROOM is off
  screen or the tab is in the background. These numbers are named constants, tuned after he has watched it.
- **Pressing a bubble goes to what was said** (his answer 7): a comment on this profile itself opens the COMMENTS list
  here at that comment; anything else opens the board on that exact post or reply. The bubble is a real link, so the
  keyboard reaches it. (This replaces "a press skips to the next page" from the draft: pages move on by themselves.)
- Third-party text is plain text: no links inside it, no HTML, an `@name` shown as written.

## In a stream room (his answer 1, "Both at once")
- **My reading, for him to confirm with his OK:** each person's companion says what that person types in the room's chat,
  as they send it: a bubble over that companion with the line appearing a letter at a time, in the same lettering, pages
  and voice. A new line from the same person replaces their old bubble. A line older than 15 seconds when it arrives is
  not spoken (the hop already works this way).
- Nothing extra is sent to anybody: every browser in the room already has the chat line and works the bubble out itself.
- Companions that are not drawn (more than 8 in a room, or switched off) say nothing. The chat itself is unchanged.
- The audio key for a room sits in the room window, beside its chat.

## The audio key
- **Where:** the right end of the ROOM's title bar on a profile, and beside the chat in a stream room: `[ ♪ OFF ]`,
  and a filled `♪ ON` while it is on (the site's look for a switch that is on; `aria-pressed`). Text characters only.
- **Starts muted. The choice is remembered in that browser** (his answer 10), one choice for the whole site.
- **Browsers need a press before any sound.** The press on the key is that press. On a later visit with the choice
  remembered as ON, the key shows ON and the sound starts with the reader's first press or key anywhere on the page;
  until then the bubbles are silent. No sound machinery is made before a press.
- **The voice** (his words: "Make our own blip voice"): one short blip per letter as it appears, made in the browser (Web
  Audio: a square or triangle wave with a 40 to 60 ms fade), no recordings, nothing downloaded. Silent on spaces, a
  longer gap at punctuation, a small wobble in pitch from letter to letter so it sounds like talking, not a tone.
- **A voice per character, worked out, not chosen** (his answer 9): a taller character is deeper (from its strip's own
  height), and the account gives it a quirk (which wave, how fast, how much wobble), so the same character always sounds
  the same and no two alike. Nothing is stored. A companion with no character of its own (the placeholder) gets a plain
  middle voice.
- **Loudness:** follows the music bar's VOL at about half the music's level. The music is not turned down.

## Edge cases
- **Comments the owner has switched off:** a visitor hears and sees none of that kind, exactly as in the list.
- **Hidden accounts** (the kept test accounts) speak like anyone: they already show as the writers of their comments.
- **Banned accounts:** their words are already withheld by the database, so nothing is said.
- **Signed-out visitors** see and hear the same, without a companion of their own. The audio key works for them.
- **Reduced motion:** no letter-by-letter and nothing opening by itself. Characters stand still as they already do, and
  pressing a character shows its next line whole, in its bubble, until pressed again. With sound on: one soft blip a page.
- **Screen readers:** a bubble is not announced as it types. It is a link whose name is the whole line ("sweden said:
  ..."), and the comments list and the chat stay the ordinary way to read everything.
- **A comment deleted or hidden while it is being said:** the bubble finishes its page and that line is not said again.
- **Phones:** wait for the phone pass (Luke, 2026-11-14). Nothing here may add a sideways scroll at phone width.

## Data
- **Reads:** the profile's comments (already on the page), the board (already in the browser), and one read of
  `profile_characters` per guest (public), at most 3. In a stream room, the chat lines the browser already has.
- **Stored:** the mute choice, in that browser only (`localStorage`). Nothing else.
- **No database change, no new table, no new realtime channel, in any phase.**

## Files, and whose they are
- New: `app/lib/speech/script.ts` (pure: who may say what, the random pick, the pages), `app/lib/speech/voice.ts` (pure:
  a character's voice and when each blip falls), `app/lib/speech/blip.ts` (the sound, and the remembered mute choice),
  `app/components/SpeechBubble.tsx`, `app/components/SpeechAudioKey.tsx`, `Temp/check-character-speech.cjs`,
  `scripts/drive-character-speech.cjs`, a section in `docs/profile-characters.md` and in `docs/companion.md`.
- `PublicProfileWindow.tsx` (PROFILE's): hands the ROOM the comments this reader may see, and the way to open COMMENTS at one.
- `ProfileRoom.tsx`, `ProfileCharacter.tsx` (`RoomWalker`), `Companion.tsx`, `app/lib/companion/events.ts`: released by
  the COMPANION session on 2026-11-14. Needed: guests as further `RoomWalker`s; a `speaking` state on a walker and on a
  companion (stand, face the reader, hold the bubble over the head); the bubble's place over a companion on the strip
  and on a room window's top edge; `companionSpoke` carrying the line's words.
- `app/lib/watch/use-watch-room.ts` and the stream room's window (`WatchRoom.tsx`): **the ROOMS group's.** Needed from it:
  the chat line's words passed to `companionSpoke` (one argument on one line), and a place beside the chat for the audio
  key. Asked of ROOMS when phase 3 starts, not before.
- `app/theme/fonts.ts`, `app/theme/tokens.css`: one new face and its token.
- `SPEC-companion.md`: one line under "Widened" saying talking is allowed here, pointing at this spec.

## Risks, said once
- Sound nobody asked for is the worst thing a page can do: muted until chosen, and never before a press.
- A character saying words puts them in that person's mouth more vividly than a list does: it only ever says what that
  person wrote, that this reader may already read.
- Up to 5 figures and a bubble in a small window may crowd; guests are capped at 3 and one speaks at a time.
- A pixel face is harder to read than the site's own: it is used big, in bubbles only, and the list stays.
- "Replies to the owner" is worked out from the board (who answered whom, and `@name`): a reply that neither answers the
  owner's post nor names them is not counted.
- In a busy stream chat, bubbles replace each other quickly; the chat window is still the place to read it all.

## Phases, each live on its own
1. **A profile's ROOM, text only:** guests, bubbles, the random talk, pressing a bubble; reduced motion; the check.
2. **The voice:** the audio key on the ROOM, the blips, the remembered choice.
3. **Stream rooms:** companions speak the chat, with the same bubbles and voice, and the key beside the chat.
Not in this spec: chosen voices, a reply key on profile comments, speech anywhere else on the site, phones.

## How it is proved (local first: Luke's rule of 2026-11-14)
- `Temp/check-character-speech.cjs` (Node, watched to fail first): who may say which line (a comment on the profile, a
  reply under the owner's post, a reply to the owner's reply, an `@name`, and nothing else); a hidden kind is never said
  to a visitor; no line repeats before the others have had a turn; paging loses no words; the same character always gets
  the same voice and two characters differ; blips fall only on letters; the mute choice is read back.
- `scripts/drive-character-speech.cjs` in a real browser on a **local dev server with the mock data sources** (comments,
  posts and shown characters seeded in that browser, so nothing touches the live database): a guest walks in; a bubble
  opens over a character and its text grows between two looks; it stays over the character; pressing it lands on the
  comment or the board reply; the gap between bubbles falls in the stated range; the key starts off and no sound
  machinery exists before the press; after it, blips are counted against letters shown; the choice survives a reload;
  reduced motion. Stream rooms cannot be shared between two browsers on mock data, so phase 3's two-person proof is one
  short live drive as TEST ACCOUNT A and B, taken in turn under the shared heavy-step lock.
- On the deployed site: `npm run deploy-status` and `npm run read` only, per the rule.
- What no drive can prove: how it sounds and how it feels. Luke listens and watches, and the pace, the gaps and the
  pitch are tuned by number after.
