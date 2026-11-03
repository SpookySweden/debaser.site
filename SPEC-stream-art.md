# SPEC: the room canvas ("magma mode") and STREAM ART in the archive (2026-11-03)

(Interview with Luke, 2026-11-03, in the same session as SPEC-music-queues.md. Build that one first: this
canvas lives on a room's screen, and music broadcasts only get a screen once they are rooms.)

## What Luke asked for
A shared drawing canvas on a room's screen, like Drawpile or Magma, plus dropping GIFs on the screen the way
Discord activities do. Everything drawn is timelined (strokes per person); saved pieces are kept in the
archive under a **STREAM ART** filter, credited like the media viewer, with the host's picture shown the way
language flags show on media, opening to every participant.

## Where it is
- **Every room, music broadcasts and video streams alike.** Any viewer can switch their own screen to the
  canvas at any time (a toggle on the screen; each viewer picks for themselves, nothing synced). While audio
  plays, the canvas is the screen's default; with a video, the picture is.
- **Anyone in the room can draw.** Nobody can clear the canvas.

## The canvas
- **480 x 270 pixels**, scaled up to fill the screen with hard pixel edges (no smoothing). Brushes have **no
  anti-aliasing**: every stroke is solid pixels.
- Tools: **pen** in a few sizes, **eraser** that only rubs out your own strokes, **undo** of your own strokes,
  **any colour** (a free picker).
- **Drag GIFs onto it**: the room chat's GIPHY / Commons search results can be clicked and dragged straight
  onto the canvas, where they land as placed pictures. While the canvas is open, the search results
  **occasionally wiggle** to show they can be dragged (token `--animate-wiggle`; still under the pointer and
  for reduced motion).
- **Drag any chat message onto it**: it lands as a placed line of text (the site font, in the writer's name
  colour), credited to the writer.
- Placed GIFs are **hotlinked** from GIPHY / Commons, never copied (the chat's rule, `chat-images.ts`). Risk,
  said once: a saved piece shows a gap where a GIF the platform later removes used to be.
- Every input (stroke, erase, undo, placement) is **timelined**: who, what, when.

## Saving and the archive
- A canvas lasts **one session** (a stream from GO LIVE to END STREAM; a music room from GO PUBLIC to public
  off). Every input is timelined either way; saving decides whether it is **documented in the archive**.
- **Any participant can press SAVE.** Once anybody says yes, the canvas is documented: it keeps autosaving
  (a snapshot every few minutes while it changes) and its timeline is kept.
- If the canvas changed and nobody has saved:
  - **closing the session** (END STREAM / public off / leaving) asks "save this canvas?";
  - **every 30 minutes**, switching to the canvas view asks the same.
- Each saved piece is a list of snapshots, each **timed, dated and credited** the way the media viewer credits
  things. **At the top: the final snapshot and the full timeline** (replayable, stroke by stroke).
- In /archive: a **STREAM ART** filter. Each piece shows the **host's profile picture** where language flags
  sit on other media; pressing it opens a pop-up of **every participant's picture**, each with their
  **coloured status square** and a **crown on top if they were crowned**. Everything clickable (pictures open
  profiles). The archive stays signed-in only, as now.
- **Nothing is deleted.** One way out: **only Luke** gets a `[ HIDE ]` key on any STREAM ART piece, which takes
  it off the archive without wiping it.
- Snapshots are images the site holds itself (allowed: the site holds images and audio as media itself).
  This is people's own drawing, not artwork made by code, so the asset rules are not touched; the canvas's own
  icons (pen, eraser, undo, save, the toggle) are art slots with font stand-ins until Luke draws them.

## Edge cases (defaults - Luke can overrule)
- Two people drawing at once: both strokes appear for everyone as they are made; order is the order the
  server receives them.
- Someone joining mid-session sees the canvas as it stands (built from the timeline or the latest snapshot).
- A person who leaves keeps their strokes on the canvas and their credit.
- Phones: drawing works with a finger (pointer events), the same way dragging works in the queue window.

## Out of scope (first version)
- Layers, text tool, shapes, fill.
- Uploading your own pictures onto the canvas (GIF search only).
- Clearing, deleting, or editing someone else's strokes.

## Data (needs Luke's typed OK before anything is run)
In plain English - the building session writes the exact migration and asks first:
- A canvas per room session; its timeline of inputs (who, kind, the pixels or placement, when). Strokes travel
  live over the realtime channel and are written in batches, so the database is not written once per pixel.
- Saved pieces and their snapshots (images in a storage bucket), with who saved, when, and the credits.
- A "hidden" mark only Luke can set.
- Row Level Security: anybody in the room adds their own inputs; nobody changes or deletes anyone's; reading
  is for signed-in people. The mock repository keeps the same rules.

## Risks to say before building
- Size: a busy canvas makes thousands of strokes; batching and snapshots keep it manageable, but the timeline
  table will be the biggest on the site. Worth watching.
- Taking a snapshot of a canvas with GIFs on it needs GIPHY's pictures to allow being read into an image
  (cross-origin). If they do not, the snapshot stores the GIF's place and address and draws it live instead of
  baking it into the picture.

## Proof
- Pure rules checked (own-stroke undo / erase, save prompts' timing, timeline replay order), proven to fail first.
- Two-person drive on dev-mock: both draw, drag a GIF and a message, save, see the piece under STREAM ART with
  the participant pop-up; desktop and phone widths.
