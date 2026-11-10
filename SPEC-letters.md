# SPEC: letters (Luke, 2026-11-10)

Part 1 of 3, built first. Then SPEC-recommendations.md, which is made from letters, and then SPEC-books.md.
Each part is built in a fresh session from its spec.

## What Luke asked for
- An **ADD TO LETTER** key on anything you see on the site, the way you add a song to a playlist.
- Adding something puts it on the letter's **small canvas**, where everything is placed **randomly and stylishly**.
- Clicking anything on the canvas opens a **pop-up** with its details and a **LISTEN** key. The key says WATCH, READ or
  LISTEN depending on the thing.
- **All your letters** show as small **letter icons**. The stamp on each one is a **circular crop of a picture** the owner
  chooses, per letter.
- Next to each letter: **TITLE : description**.
- Letters can be **named**, and the name shows at the top of the letter's own window, with an **edit cog** next to it.
- The cog lets you change the **picture, description, name and text colour** (the text colour inside the letter).
- The stamp picture **repeats as a pattern** behind the canvas at **30% opacity**. Next to the picture are an
  **opacity slider** and a **pattern density slider**.
- Letters live **on your profile**. Each one can be made **public** with a **lock** key in its window.

## Luke's answers (2026-11-10)
| Question | Answer |
|---|---|
| What has ADD TO LETTER | Everything: MEDIA rows (videos, films, music, audiobooks), books, forum threads and single posts, book highlights with their comments, lore pages, FILES, beat box songs, people's profiles, and **any pasted web address** (a plain link card: title only, no picture or text fetched from the page). |
| Stamp picture | **Upload your own** (allow-listed type, size cap and rate limit, like the avatar route) **or pick** the picture of anything already in the letter. |
| Canvas layout | **Stays put.** A new item lands in a random spot and keeps it, and everyone sees the same layout. A **SHUFFLE** key scatters everything again. |
| Who sees a public letter | **Everyone**, signed-out visitors included, like MEDIA and the forum. A private letter is its owner's alone. |

## How it should feel
- The letter list on a profile: a grid of small letter icons, each with its round stamp picture, and beside it the name
  in the letter's text colour, then `: ` and the description.
- One letter's window (an OS window, like the others): the name at the top, `[ ⚙ ]` next to it, and the lock (`[ 🔒 ]` /
  `[ 🔓 ]` as text) at the top. Below that, the canvas: the stamp picture repeating behind at the chosen opacity
  (30% to start) and density, with the items scattered on top as small cards (picture or title), slightly turned, not
  overlapping more than a little.
- Settings (the cog): the picture (upload or pick), with the opacity and density sliders right next to it; name;
  description; text colour.
- ADD TO LETTER opens a small list of your letters, with **+ NEW LETTER** at the top. Adding again to the same letter
  says it's already there and doesn't add it twice.
- Phone width: the list stacks one letter per line, and the canvas scales down to fit the screen width.

## Firm lines and how they apply
- **No drawn artwork.** The letter icon (the envelope) is artwork: put it in a **slot** (`SpriteSlot`, the registry in
  `app/lib/ui/art/`) with a placeholder file and stop, so Luke draws it. The round stamp is the user's own picture, cropped
  by CSS, which is fine. The cog and lock are text characters (allowed). The background pattern is a repeating tile of
  the user's picture, which is fine.
- **Items are references, not copies.** A letter keeps what kind of thing an item is, its id or address, and its
  position on the canvas. Titles and pictures are read from their sources when the letter is shown (MEDIA's own
  rules: hotlinked thumbnails, platform players). A pasted link keeps the address and the title the person typed or
  an oEmbed title, never a scraped page.
- **Images the site holds:** only the uploaded stamp pictures (the site may hold images; see CLAUDE.md MEDIA).
- **Colours** come from the theme tokens, apart from the person's chosen text colour, which is stored as a value and
  checked to be a plain colour. `npm run tokens` must pass.
- **Database (Luke's OK needed before the build session writes it):** a `letters` table (owner, name, description,
  text colour, stamp picture, opacity, density, public flag, created and updated times) and `letter_items` (letter,
  kind, ref, x, y, turn, added time). Row Level Security: only the owner adds, edits, moves or deletes, and anyone
  reads a public letter's rows. Mock and Supabase repositories both.
- Deleting a letter asks first and says how many items go with it.

## Out of scope
- Sharing a letter with chosen people only (public or private only, for now).
- Several people editing one letter together.
- Recommending letters: that's SPEC-recommendations.md.

## Proof (for the build session)
- Checks: a visitor can read a public letter and can't read a private one; only the owner can add, move or delete
  (asked live with TEST ACCOUNT A and B, and signed out); ADD TO LETTER on each kind of item.
- Screenshots at desktop and phone width: the letter list on a profile, one letter's canvas with the pattern at two
  densities, the settings, and the pop-up with its WATCH, READ or LISTEN key.
- The house loop in core.md through to `npm run read` on the live site.
