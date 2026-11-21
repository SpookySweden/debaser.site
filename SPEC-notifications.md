# SPEC: notifications (NOTIFY, list 5, 2026-11-20)

Luke: "Notifications: replies, letters, rooms going live, new comic pages. Shown on the site and optionally in a weekly
email." Interviewed 2026-11-20 in the NOTIFY chat. His answers: "1b-but they are also like a photo album or letter 2c 3a
4a 5b 6a 7a 8a 9a 10a 11b". Status: WAITING FOR LUKE'S OK. Nothing is built; database changes wait for his typed OK.

## What exists today (kept, built on)
- `public.forum_notifications`: one row per person told (kinds tag, reply, invite, recommend), readable only by that
  person, live over realtime, polled every 30 s. Code: `app/lib/notifications/` (mock + Supabase repositories, `feed.ts`).
- The bell (`NotificationBell.tsx`, `NotificationMenu.tsx`) on the side panel's COMMS title line, drawn only while
  something is unread; the account pop-up carries the same list on narrow screens.
- DESK: REPLIES TO YOU (replies and tags from the same feed), LIVE NOW, WAITING FOR YOU (messages, recommendations).
- COMMS messages keep their own unread count and pop-up (`IncomingMessageWindow`). Untouched by this SPEC.
- Resend already sends the sign-in mails from the PC; pg_cron timers on the PC already call the site (the hourly
  MEDIA fetch, with a lock header: `app/api/web/ingest/route.ts`).

## The answers, as the site will behave

### What tells you (answers 1B, 2C)
| Kind | When | Bell line (example) | Opens |
|---|---|---|---|
| Replies and tags | as today | `ALEX REPLIED TO YOU "post title": words...` | the post |
| Letters | someone sends you a letter (a letter sent through RECOMMEND: the canvas, like a photo album or a letter) | `ALEX SENT YOU A LETTER "name"` | the letter's canvas |
| Recommendations | as today (things sent through RECOMMEND without a letter) | `ALEX RECOMMENDED YOU SOMETHING` | RECOMMENDED |
| Rooms going live | a person YOU PICKED makes their room live (answer 2C) | `● ALEX WENT LIVE "room name"` while it is on; `ALEX WAS LIVE` after | the room |
| New comic pages | a batch of pages is released and you follow the comic | `5 NEW PAGES IN CHAPTER 3` | the first new page |
| Game invites | as today | `ALEX INVITED YOU TO A GAME` | the game |

- Messages (COMMS) are NOT in the bell or the email (1B): they keep their own count and pop-up.
- Picking people for rooms (2C): a key on someone's profile, `[ TELL ME WHEN LIVE ]`, which reads
  `[ ✓ TELLING YOU WHEN LIVE ]` once pressed. Private: the person is never told who picked them. The list of picked
  people sits in PREFERENCES with an `[ X ]` beside each.
- Which rooms count: a picked person's room becoming listed as OPEN or PASSWORD (GO LIVE, or a stream room opened in the
  open). A PRIVATE (link-only) live room tells nobody: it is meant for the people the host gives the link to. At most one
  alert per room per person every 30 minutes, so GO LIVE / GO PRIVATE / GO LIVE again is one alert.
- Comic: COMIC releases pages in batches (every page sharing one release time); one alert per batch. Following the
  comic IS the COMIC NEW PAGES switch; the comic reader's `[ FOLLOW ]` key flips the same switch (agreed with the
  COMIC session, see "COMIC interface" below).

### Where you see them (answers 3A, 4A)
- The bell and its menu, as today, now carrying every kind above; DESK's sections read the same feed (REPLIES TO YOU
  stays; letters join WAITING FOR YOU; picked people's live rooms show in LIVE NOW as today).
- A balloon (4A): when a new notification arrives while the site is open, a small box appears at once at the bottom
  right, above the taskbar, like an old Windows tray balloon: the bell line, `[ OPEN ]` and `[ X ]`. It stays 6 seconds
  (longer while the pointer is on it), one at a time; several at once read `+2 MORE` and open the bell menu. It appears
  and goes instantly (no slide, no fade). Not for messages (COMMS already has its pop-up). Not shown while the tab is
  hidden. Text-character marks only, site tokens, 13px or larger.
- Visitors who aren't signed in get nothing (no feed exists for them).

### Switches (answers 5B, 6A)
A NOTIFICATIONS section in PREFERENCES, saved to the account (both machines agree). One switch per kind, covering both
the site and the email (5B):
- `REPLIES AND TAGS` on · `LETTERS` on (letters and recommendations: both arrive through RECOMMEND) ·
  `ROOMS GOING LIVE` on (only ever fires for people you picked) · `COMIC NEW PAGES` off until you follow the comic ·
  `GAME INVITES` on.
- `BALLOONS` on: the site-only pop-up of 4A, for anyone who wants the bell alone.
- `WEEKLY EMAIL` off until each person turns it on (6A).
A switch turned off means no notification of that kind is filed at all (the database drops it), so the bell, DESK,
balloon and email all agree.

### The weekly email (answers 6A, 7A, 8A, 9A, 10A)
- Who: accounts that turned WEEKLY EMAIL on and have an email address. Never test or hidden accounts
  (`profiles.is_hidden`), stream guests or banned accounts: the database leaves them out, and a check holds that.
- When: Sunday 18:00 UK time (the PC's time zone, GMT/BST). If the PC is off then, it goes out at the next hour the PC is
  on, up to Monday 18:00; after that the week is skipped. Nobody gets two in one week.
- What (8A): only things still unread, kinds whose switch is on, up to 5 lines per kind with `AND 4 MORE`, each line a
  link to the site. A plain list in the site's look (monospace, black and white, works with pictures blocked), plus a
  plain-text copy. Private words never leave the site: lines carry names, post titles and letter names, never message
  text. A week with nothing unread sends nothing.
- From (9A): `DEBASER_OS <post@debaser.site>`, through the same Resend account the sign-in mails use. Found
  2026-11-20: debaser.site is not yet a sending domain in Resend (no Resend record in its DNS), so Luke does two things
  himself (the house rule: his accounts, his clicks, his keys):
  1. In Resend, add the domain `debaser.site`, and let Resend put its records into Cloudflare (it has a one-click
     Cloudflare button), or copy the 3 records it shows into Cloudflare's DNS page.
  2. Make a Resend API key with "sending access" for debaser.site only, and paste it into the PC's site settings file
     (`G:\DEBASER-HOST\site.env`) as `RESEND_API_KEY=...`. Nobody else types or sees it.
- Unsubscribe (10A): every email has `[ TURN OFF WEEKLY EMAIL ]`, a link that turns it off in one click with no sign-in
  (`debaser.site/unsubscribe?t=<a random code that belongs to that person>`; the page says `WEEKLY EMAIL: OFF` and offers
  `[ TURN IT BACK ON ]`). Gmail's and Outlook's own Unsubscribe button works too (the standard one-click headers), and
  the email links to PREFERENCES for the per-kind switches. (The link's page turns it off as it opens in a browser, not
  on a bare fetch, so mail scanners that pre-open links can't unsubscribe people by accident.)
- Testing: a test email goes only to Luke's own address, and only when he says so in chat. Test accounts are never
  emailed.

### Keeping (answer 11B)
Notifications are kept forever. (Note: this keeps the feed growing; the menu still reads only the newest, so it stays
quick. Revisit if anyone's feed passes a few thousand rows.)

## Database changes (each waits for Luke's typed OK, with a dry run and `npm run db:backup` first)
One migration, re-runnable, Row Level Security on everything new:
1. `forum_notifications` gains kinds `letter`, `live`, `comic` (and `comic_reply`, reserved for COMIC's later panel
   comments), and three columns: `href` (where the line opens), `room_id` (the live room; cleared if the room goes), and
   `ref` (a key so the same event can never be filed twice for one person).
2. `notification_prefs`, one row a person: the six switches above, WEEKLY EMAIL, the unsubscribe code and when the last
   email went. Only the person can read or change their own row; the unsubscribe page changes only WEEKLY EMAIL, by code.
3. `live_watches`: who picked whom for TELL ME WHEN LIVE. Only the picker can see, add or remove their own picks; the
   person picked can't see them.
4. A database check before every notification is filed: if the person's switch for that kind is off, the row is
   quietly not filed. (One place, so every way a notification is made obeys the switches.)
5. When a room becomes listed as open or password, the people who picked its host (with ROOMS GOING LIVE on) are told.
6. `recommendation_send` files `letter` instead of `recommend` when what is sent is a letter. Nothing else in it changes.
7. `notify_comic_page(...)`: COMIC's way in (below). Callable only by the database itself, never by a browser.
8. The weekly email's database side: a locked function that hands the site the week's list per person (only for people
   who asked, minus hidden/guest/banned accounts), one that records "sent", and one that turns WEEKLY EMAIL off by code.
   A pg_cron timer calls `https://debaser.site/api/notify/digest` every hour from Sunday 18:00 to Monday 18:00 UK time
   with a lock header (the hourly MEDIA fetch's pattern); the site sends through Resend's API.
Nothing existing is deleted. No existing notification row changes.

## COMIC interface (agreed with the COMIC session, 2026-11-20; also in the shared notes, `notify-comic-interface.md`)
- `public.notify_comic_page(p_ref text, p_title text, p_body text, p_href text)`: security definer, revoked from
  browsers, idempotent on `p_ref` (one alert per release batch, ever). Fans out one `comic` row per person with COMIC NEW
  PAGES on.
- Release is by hand (COMIC, from Luke's answers): Luke ticks pages in the studio and presses RELEASE; COMIC's
  `comic_release(page_ids)` (security definer, admin only) calls it once per press with
  `p_ref = 'comic:release:<comic_releases.id>'` and `p_href` = the first new page, `/comic/<chapter>/<page>` (chapters
  numbered across the whole comic). No timer. Unreleased pages never reach it. COMIC's spec: `SPEC-comic.md`.
- Later phase: replies to a reader's panel comment arrive as `comic_reply` with an href to the page and panel.
- FOLLOW: COMIC's reader key flips the COMIC NEW PAGES switch (`notification_prefs.comic`, off by default) through
  NOTIFY's store, `app/lib/notifications/notify-settings-store.ts`: `useNotifySettings(me).prefs.comic` to read,
  `setNotifySwitch('comic', on)` to change (mock and Supabase alike).

## MODERATION (SPEC-moderation.md, not built yet)
- Blocking is one way: the gate files nothing for somebody who has blocked whoever did it, once MODERATION's
  `has_blocked(blocker, blocked)` exists (the gate looks for it, so no change is needed when it ships). That covers
  replies, tags, letters, invites and rooms going live, since every one of them names who did it.
- A "new report" alert for moderators is MODERATION's own kind, added by its migration (the kind list and the gate's
  database-only list gain it there).
- If Luke gives COMIC a separate follows list, `notify_comic_page` reads that instead; COMIC will say.

## Phase 2 as built (Luke 2026-11-20: "Key is in", then "A: set up debaser.site")
- `20261120110000_notifications_weekly_email.sql`: a lock made at random in the database's vault; `notify_digest_due`,
  `notify_digest_sent` (both need the lock), `notify_unsubscribe(code, on)`; the timer `notify-digest`, minute 23 of
  every hour on Sundays and Mondays (UTC), posting to `https://debaser.site/api/notify/digest`.
- `app/api/notify/digest/route.ts` sends through Resend's API only inside Sunday 18:00 to Monday 18:00 UK time
  (`digestWindow`, `app/lib/notifications/digest.ts`), two a second at most; it sends nothing without `RESEND_API_KEY`.
  A test run (`{"test": true, "person": "<id>"}`, made from the database so the lock never leaves it) sends one person's
  email at once and doesn't count as their week's.
- The email: the whole text in a `<pre>` (no pictures, no colours), each line a link, and the one-click unsubscribe as a
  link and as the List-Unsubscribe headers. `/unsubscribe` and `POST /api/notify/unsubscribe` turn it off (or back on).
- PREFERENCES: `[ WEEKLY EMAIL ]` beside the other switches, off to start.
- Before the first real Sunday: debaser.site verified in Resend (DNS) and `RESEND_API_KEY` in `G:\DEBASER-HOST\site.env`.

## Phases
1. On the site: the new kinds, letters, TELL ME WHEN LIVE, the switches, the balloon, COMIC's function. Needs only the
   migration OK.
2. The weekly email: after Luke has added debaser.site in Resend and pasted the key (above).

## How it will be proved
- Local, mock data (`NEXT_PUBLIC_*_DATA_SOURCE=mock`): a drive on a local dev server shows the balloon for each kind,
  `+2 MORE`, the switches turning a kind off (no bell line, no balloon), TELL ME WHEN LIVE on a profile, PREFERENCES'
  NOTIFICATIONS section. Desktop width, dark then bright theme; capture + audit.
- Checks in `Temp/check-notify-*.cjs`, each watched failing first: bell wording per kind; the weekly list (5 per kind,
  `AND N MORE`, no message words, nothing for an empty week, one per week, the Monday 18:00 cut-off, summer time);
  hidden accounts left out; the unsubscribe page turns off only WEEKLY EMAIL.
- Live, short, through `heavy-step.cjs --live-check`: the policies (nobody reads another's prefs or picks; a browser
  can't call notify_comic_page or the email functions; a switched-off kind files nothing), then `npm run read`.
- Email: one test to Luke's own address, on his word, after phase 2's setup.

## Out of scope
Phone-specific layout (desktop first; nothing breaks at 390 wide). Browser push notifications when the site is closed
(could be a later idea). Sounds. Emails other than the weekly one. Message (COMMS) notifications in the bell or email.
