# Less text, site-wide (2026-10-25)

Luke: "comb the site for unnecessary text ... keep text to a minimum while still clearly conveying the
info, turn things that don't need to be text into buttons, make things expandable menus if they must
contain information." Example: the display-name field on sign-up explains what a display name is.

A second pass after SPEC-efficiency.md (which moved explanations into hover tips). Inventory: four
read-only sweeps on 2026-10-25, about 300 strings in about 70 files.

## Decisions (Luke, 2026-10-25)
- A needed explanation goes behind a `[ ? ]` key (`app/components/InfoFold.tsx`), which works on
  phones. Hover tips that repeat a label are cut; a tip is a few words naming an unlabelled control.
  Rule rewritten in docs/design.md ("Words are kept to a minimum").
- Remove the tag index's TEST tab (developer diagnostics with file paths). Nothing else is deleted:
  `[ SESSION OPTIONS ] :: SOON`, the missing-artwork wording ("... is not in the assets folder yet") and
  the unreachable ShelfWindow in MusicPlayer stay as they are.
- Luke's uncommitted per-page picker edit in ForumBoard.tsx is left uncommitted (never staged).
- Rolled out area by area, each committed and pushed live.

## The rules applied
1. **Cut** a sentence that restates a title, label, badge, button or switch; a how-to line; the
   instruction after an empty state (`NOTHING YET.` and stop); `ESC CLOSES` / `DRAG THE TITLE BAR` tips;
   a readback of a setting (`CURRENTLY: VISIBLE`); a message nobody can see (shown by a panel that
   unmounts the moment it is set); local-mode notes (`... ONLY IN THIS BROWSER`).
2. **Shorten** labels, keys, statuses, confirmations and errors to the fewest words that still say it.
   An error still says what to do if there is something to do.
3. **Button**: a sentence that tells you to go and do something becomes the key that does it, or the
   site's one locked-action line `[ LOG IN ] TO <VERB>`.
4. **`[ ? ]`** only for the few explanations a reader really needs (a rule that is not visible from
   the controls: following a queue takes the player over; a hidden switch also stops new comments; the
   owner approves tags; the character shelf drops the oldest past its limit; shake-to-detach).
5. **Fix wrong words found on the way** (e.g. "PICK OR TYPE BELOW" with nothing to type in, "EIGHT
   DYES" over sixteen swatches, "four shelves" over five, a backtick for an apostrophe).
6. **Spared**: Luke's story content (lore pages, comic captions), short in-world flavour (the guest
   banner's `ERROR: UNREGISTERED ENTITY.`, RADI-OH's faces), search-engine descriptions (`metadata`,
   never on screen), the /specimen developer page, the notes page's words (folded under each title,
   not rewritten).
7. Mock and Supabase variants of a message change together. Icon-only controls keep an accessible
   name (`aria-label`) when their tip goes. Tap targets are not shrunk.

## Not in this pass (follow-ups)
- The display name is edited in two places (EDIT ACCOUNT and the customiser), and tag approval in two
  (customiser TAGS and the profile's tag list). Merging them is a feature change, not a text cut.

## Areas
- A account and profile: app/account, app/profile, Account*, GoogleSignInButton, GuestPrompt,
  PreferencesWindow, Profile* (not ProfileComment*), PublicProfileWindow, SidebarProfile, UnsavedPrompt,
  MusicOptionsPrompt, TagCreatorWindow, ElementComments, app/lib/auth, app/lib/profile, app/lib/ui/themes.ts.
- B forum: app/forum, Forum*, NewPostForm, Comment*, Post*, ThreadSubjectRow, Mention*,
  AsciiEmoticonPicker, PicturePicker, MediaPicker, ProfileComment*, TagChooser, TagWindow, TrackControl,
  app/lib/forum, app/lib/audio/sorts.ts.
- C media, music, comms, notifications: app/media, app/comms, Media* (not MediaPicker), NewArchive*,
  Music* (not MusicOptionsPrompt), PersonalLibrary, LibraryRow, Queue*, RadioLoops, LoopPopout,
  InlineTrackPlayer, AudioTag*, Comms*, SidebarComms, IncomingMessageWindow, Notification*,
  app/lib/media, app/lib/audio (not sorts.ts), app/lib/comms, app/lib/notifications.
- D the rest: home, projects, concepts, links, notes, lore, users, games, character workbench, the OS
  shell (Taskbar, StartMenu, SiteNav, SiteWindow, DockWindow, PopoutWindow, NewsTicker, NewsCrawl,
  ProjectSectionNav, DesktopSidebar), app/lib/projects, lore, games, concepts, character.

## Proof
`npm run verify`, `npm run checks` (checks that test a cut string are updated on purpose and listed),
`npm run capture` + `npm run audit`, shots at desktop and phone width, `npm run read --absent` on cut
strings after each push.
