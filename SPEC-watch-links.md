# Watch together: links in the queue

Builds on SPEC-watch-together.md. Interview with Luke, 2026-10-30.

## What Luke sees
- In a stream room's QUEUE, next to the catalogue picker: a text box `PASTE A VIDEO LINK` and `[ + ADD ]`.
- Any signed-in viewer can add a link, just as they can add catalogue files today. Guests can't. The host can
  remove unplayed links like any other entry.
- On add, the link is checked in the adder's own browser before it is queued. A link that won't play is
  refused with a plain reason: `NOT A VIDEO LINK`, `THIS LINK WOULDN'T LOAD`, `THIS VIDEO CAN'T BE EMBEDDED`.
- The title is fetched automatically: YouTube/Vimeo/Dailymotion/Twitch from the site's public oEmbed, and a
  file link uses its file name. The adder can edit it before adding.
- The linked video plays in the same stage, kept in sync like a catalogue file: host play/pause, seek, skip,
  and the next entry when one ends.
- Forum record: a link play appears in play order with its chat fold, like a file. The title opens the
  original link. It has no /media page, so no archive fold.

## What counts as a link
Synced (host controls everyone):
- Direct video files: `.mp4`, `.webm`, `.ogg`/`.ogv`, `.mov`, played in the existing `<video>`.
- HLS streams (`.m3u8`), through hls.js (built into Safari). DASH (`.mpd`) through dash.js if it's cheap to add.
- YouTube (videos, shorts, `youtu.be`; live streams play at the live edge), via the YouTube embed player.
- Vimeo, Dailymotion and Twitch (VODs, plus channels at the live edge), via each site's embed player API.
Refused: anything else, with `NOT A VIDEO LINK`.

## What it will NOT do (decided)
Luke asked for "any video link" and for the CyTube trick of copying a stream address out of inspect element on
streaming sites (anime sites etc.) to keep working, including where those sites have since stopped it. That
trick broke because the sites deliberately lock their streams: short-lived signed addresses, checks on which
site is asking (Referer/Origin), video assembled inside the page (`blob:` addresses), and encryption/DRM.
Getting round those means a server that pretends to be the site, or breaking the encryption. **That part won't
be built**: it's circumventing access controls on someone else's content. It would also send all that video
through this site's Vercel account (bandwidth bills, and takedown risk for the domain).
What it does instead: any address that is directly playable works, including one copied out of inspect
element, as long as the site doesn't block it. When it doesn't play, the room says so plainly rather than
going quietly black.

## Edge cases
- A link that plays for the adder but not for others (addresses tied to one person's connection or session):
  each viewer whose player fails sees `THIS LINK WON'T PLAY HERE` on the stage, with chat still working. If the
  HOST's player fails, the room moves on after 5s and says `SKIPPED: <title> WOULDN'T PLAY`.
- A signed link that expires while it waits in the queue: same as above, at play time.
- YouTube ads play at different moments for different people. Viewers who are behind catch up when the ad ends
  (the normal sync correction). This can't be prevented.
- Embed-blocked or age-restricted YouTube videos: refused on add when the embed player reports it, otherwise
  skipped as above.
- Live streams (Twitch channel, YouTube live, live m3u8): no seek bar, `LIVE` in place of the time, everyone at
  the live edge. They never "end", so the host skips them.
- Mixed-content: `http://` links are refused (`ONLY HTTPS LINKS`), because browsers block them on an https page.
- Only the link and title are stored. The site never fetches the video itself. The oEmbed title lookup only
  ever calls the fixed list of sites above (no "fetch any address" server route).

## Data (migration: needs Luke's OK before it's pushed)
- `watch_queue` gains `source_url text`, `source_kind text` (`file | hls | dash | youtube | vimeo | dailymotion
  | twitch`) and `source_title text`. A row has a catalogue file OR a link. Re-runnable, with the existing RLS
  and host-only "played" rule unchanged.
- Chat lines already carry the queue entry, so link plays get chat folds with no change.
- Both repositories (mock + supabase) get the new fields.

## Build order (each step verified, committed and live before the next)
1. Data + link recognition (pure rules: which kind is this, refuse what isn't) + queue box + forum record.
   Direct files only.
2. HLS (+ DASH).
3. YouTube player behind the same play/pause/seek/ended wrapper the room's sync uses.
4. Vimeo, Dailymotion, Twitch.

## Out of scope
- Unsynced "paste any embed code" (CyTube's custom embed): it lets arbitrary third-party pages into the site.
- Proxying, downloading or re-hosting video.
- Thumbnails for links.
