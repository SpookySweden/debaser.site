# Site review, November 2026

Written 2026-11-13 by a review session, at Luke's request ("make sure more things hook back into the forum as posts and
tidy up the formatting ... interconnected usability and visibility / readability / comprehensiveness / expression and
personalisation"). Nothing here is built yet. Each item says what you would see, why it helps, and roughly how big it is:
**S** is an afternoon, **M** is a day or two, **L** needs its own SPEC and session.

How this was checked: live screenshots of every page signed out, at desktop and phone width (`Temp/browse/review/`), plus a
read of the code for the forum, profiles, preferences, the reader, lore and the character workbench. Not checked: pages
signed in, and a real phone.

---

## The top ten, in order

1. **TEXT SIZE in Preferences (S).** You'd see a SIZE row with 100 / 125 / 150 / 200%. Every word on the site grows
   together, and it follows your account to the laptop. The site already has one dial that scales every font
   (`--scale-type` in `app/theme/tokens.css`), but nothing lets a reader turn it. This is the biggest help for poor eyesight
   for the least work.
2. **Phones get the 1280-wide desktop shrunk to fit (L).** On a 390-wide phone a 13px label shows at about 4px, so nothing
   can be read without pinching. You chose this on 2026-11-02, and it was the right call while the site was being built.
   But nobody on a phone can read the forum today. Suggestion: a phone layout for the reading pages (forum, a thread, a
   profile, a lore page, the reader), with the desktop fit kept for the busy tools (beat box, ANIMATE, the workbench).
3. **A MADE THIS strip on the forum (M).** You'd see a quiet one-line post in the feed, for example "Good morning saved a
   beat box song", "sweden started a lore page", "Demzou put a drawing on the art shelf". Each has the thing's picture
   or player, and a reply box under it like any post. Today most things people make never reach the board (see "Hooking
   things into the forum" below). Each person picks which kinds post on their behalf, and the board gets a
   `[ MADE ▾ ]` filter so you can hide them.
4. **Empty stream records are filling the forum (S).** Signed out, half of the forum's first page is `STREAM :: PRIVATE
   :: 0 MESSAGES` rows, and Good morning's profile is six `STREAM :: 0 REPLIES` lines. Suggestion: a stream that ended
   with no messages and no queue folds away. It leaves no row, or one per day ("3 STREAMS TODAY"), and private ones never
   show to people who couldn't join.
5. **Names you can't read (S).** On the dark theme, Good morning's name at the top of their profile is Royal Blue on
   Nigrosine, which is close to invisible. The `.name-strip` fix only covers the bright themes. Suggestion: on dark
   themes, the dark name colours (Royal Blue, Nigrosine) get a light strip, the same way the bright themes do it.
6. **YOUR DESK: a home page that's yours (M-L).** Today `/` just jumps to the forum. Signed in, you'd see one page with
   these, each a link:
   - CONTINUE READING, with the books you're partway through;
   - REPLIES TO YOU;
   - people online now;
   - rooms that are live;
   - what the people you talk to most made lately.

   Signed out, it stays the forum. Most of the data is already there (`book_places`, notifications, presence, the VANITY
   "people you interact with most").
7. **A profile shows everything someone made (M).** You'd see a row of shelves under the picture, and the owner picks
   which ones show and in what order:
   - SONGS;
   - BEAT BOX;
   - CHARACTERS;
   - HIGHLIGHTS (public quotes from books);
   - RECOMMENDED;
   - LORE (pages they started or edited);
   - ART (stream-art drawings).

   Today a profile shows a picture, a track, comments, the last 8 threads and public letters, and leaves a big empty
   right-hand column.
8. **Stop the moving lines (S).** You'd see a `[ ❚❚ ]` key on the newswire and the profile wire, plus a MOTION OFF row in
   Preferences that stops every crawl and the page-turn swing. Today the crawl only stops while a mouse is on it, or if
   Windows is set to reduce motion. Moving text is the hardest kind to read.
9. **Retire the HAD AN ACCOUNT? window (S).** It covers the middle of every page for every signed-out visitor, a week
   after the loss. Suggestion: show it only on the sign-in screen, as a line under `[ LOG IN ]`: "HAD AN ACCOUNT BEFORE 6
   NOVEMBER? [ FIND IT ]".
10. **Comments on lore pages (S).** You'd see a `[ COMMENT ]` key on every lore page. Its thread lands on the forum
    with the page's name, like the concept sheets do. A new lore page also makes a post. Lore is the comic's own world,
    and today nobody can talk about a page where it lives.

---

## Hooking things into the forum

What already posts: forum posts and replies, beat box songs (by `[ SHARE ]`), music tracks (through the composer),
stream GO LIVE, public book highlights (one thread per reader per book), public recommendations, and MEDIA items (by
DISCUSS).

What people make that never reaches the forum or their profile:

| Thing | Suggestion | Size |
|---|---|---|
| Lore pages | New page makes a post; `[ COMMENT ]` on each page; the page lists who edited it, as profile links (today "LAST FILED BY" is plain text) | S-M |
| Stream art drawings | Saving to the shelf makes a MADE post with the picture; the drawing shows on the drawer's ART shelf | S |
| Music rooms going public | Posts like a stream does: "Good morning opened a music room", with a JOIN key while it's live | S |
| Characters | Once characters can be public (see the character SPEC), "made a character" posts with the pixel render | M |
| ANIMATE animations | An `[ POST ]` key after export, which puts the GIF on the board (it's local only today, so this would upload the GIF: your call) | M |
| Game results | "sweden beat Demzou at PADDLE DUEL, 7-3" as a MADE post (no scores are kept today) | M |
| Finishing a book | "finished *Frankenstein*" when the reader reaches the last page, if you allow it | S |
| Letters made public | A MADE post linking to the letter | S |
| Profile picture or track changed | "new picture" post with the picture, replies go to that version's comments (the threads exist already) | S |

Two fixes to how posts look:
- **Rich cards for every kind of thread (M).** A thread about a book shows the cover and READ. A lore page shows its
  first lines and OPEN. A recommendation shows what was recommended and links back. A highlight shows the quote in a
  quote block. Today only songs, streams, concept sheets and MEDIA items get a card; books, recommendations and
  highlights are plain text.
- **Notifications for what you'd want to know (S).** Today you're told about tags, replies, game invites and
  recommendations. Add: someone commented on your profile or picture (today: silence), someone you talk to went live,
  someone replied in a lore page's thread you edited.

---

## Formatting and readability

Beyond the top ten:
- **Writing at 15px everywhere (S).** The newswire rows show people's posts at 13px, the smallest size, in one line.
  Posts are writing, and writing is 15px by the site's own rule.
- **A HIGH CONTRAST theme (S).** Pure black, white words, Daffodil keys, no dithers or dotted rules, a thick solid focus
  outline. A sixth choice in Preferences.
- **Solid focus outline (S).** The box that shows where the keyboard is points is a thin dotted line; make it a solid
  2px ring.
- **Dim keys (S, to measure).** In the screenshots, the top bar's module names and the music bar's `[ HIDE ]` /
  `[ OPTIONS ]` look olive rather than bright Daffodil. Run `npm run contrast` on them.
- **Placeholder squares look broken (S, your art).** Dithered squares sit where art is missing: the taskbar's walk cycle,
  the profile status bar's sprite. To a visitor they look like a failed image. Until the art is drawn, hide the empty
  slots, or show a text stand-in such as `(·_·)` (text art is allowed).
- **Lower-case labels on profiles (S).** "comment", "their track", "comments off" are lower case, unlike every other
  label on the site.
- **Forum reply preview overlaps (S).** On the board, the latest-reply text beside a post runs into the post's own row
  (seen on the pinned post at desktop width).
- **Hover-only tips (S).** Some explanations only show when a mouse rests on a key, which nobody on a phone or tablet
  can do. Move any that matter behind `[ ? ]`.
- **Sizes in rem (M).** Sizes are set in pixels. Browser zoom works, but a browser's own "bigger text" setting is
  ignored. Switching the size tokens to rem fixes that without changing anything at the default size.
- **The users list is thin (S).** `/users` is four names. Show each person's picture bigger, their status line, flag,
  online lamp and what they made last. The side panel already repeats the bare list.

---

## How the parts link to each other

- **One search box for the whole site (M).** Today search lives separately in the forum, MEDIA, BOOKS and DISCOVER. One
  box on the top bar would find posts, people, lore pages, songs, books and media together, grouped by kind.
- **Every thing links to where it's talked about (S).** A book page, a lore page, a song and a MEDIA item each get a
  `TALKED ABOUT IN` line listing their forum threads. Counting replies is fine; this isn't a like or view count.
- **Everything links to who made it (S).** Lore edits, stream art, recommendations and beat box songs name their maker
  as a profile link, not plain text.
- **Recommendation threads link back (S).** The thread card has no way back to the recommendation.
- **Friends (L, a database change).** There's no follow or friends list; "follow" today only means listening along to
  someone's music. A FRIENDS list would drive YOUR DESK, notifications and "friends' servers" in one place. Worth
  speccing, not urgent while the site has four people.

---

## Personalisation

- **Your settings follow you (S-M, a database change).** Theme, cursor, the music bar's settings and the text size live
  in one browser today. On the laptop you start again. Save them to the account, like modules and window layouts
  already are.
- **Your character beside your name (M).** A small pixel render of your chosen character, beside your posts or as a
  profile picture choice. Today characters are only ever seen by their owner. This ties in with the characters-on-profiles
  SPEC.
- **Profile looks (M).** A profile accent colour from the dyes, a background tile (the dithers and patterns the rules
  allow), and the shelf order from item 7.
- **NOW lines (S).** An automatic "READING *Dracula*" and "LISTENING TO ..." on your profile, from what the site
  already knows. Each has a privacy switch, off by default.
- **Remembered filters (S).** The forum's sort, tags and the new `[ MADE ▾ ]` filter stay as you left them, on every
  device.

---

## Things noticed in passing (not part of the review)

- The lore directory is empty: `lore_pages` has 0 rows. Signed out it says `NO PAGES YET.`, so either lore went with the
  accounts on 6 November or nobody has written a page since.
- The live site answers at `debaser-site.vercel.app`. `debaser.site` didn't resolve from this machine on 2026-11-13.
