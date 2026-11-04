# SPEC: Snapping, resizable windows (desktop)

Interviewed 2026-10-13. Build this in a fresh session. Read CLAUDE.md and `docs/design.md` first.
(`SPEC.md` is the character creator spec from another session; leave it alone.)

## Goal
Make the docked windows behave like the modular panels in Luke's game: drag one next to another and they
snap edge to edge and become a group that moves together. Every window can be resized from any edge or
corner. Each person's arrangement is saved to their account.

## Which windows
- **Docked windows only**: everything drawn with `app/components/DockWindow.tsx`. Today that's the music
  archive, the arcade, the queue and preferences. Build it into `DockWindow` so any future docked window
  gets it for free.
- **Pop-up dialogs (`PopoutWindow.tsx`) are unchanged**: comments, new post, tag creator, character shelf, etc.

## Desktop only
- None of this applies at phone width (below the existing `sm` breakpoint, 640px). Phones keep today's
  bottom sheets, untouched. Mobile will be worked on separately, so don't add phone behaviour.
- Saved layouts never apply on a phone either.

## Snapping and groups
1. While you drag a window, an edge that comes within a few pixels of another window's edge snaps flush. Tops
   and sides also line up with each other. Windows snap **to other windows only**: no snapping to the
   screen edges, no half-screen or quarter-screen zones.
2. Snapped windows form a **group**. Dragging any window's title bar moves the whole group.
3. **Shake to detach**: shake the mouse quickly side to side while dragging a window, and that window
   breaks off the group and moves on its own. Show a brief visual cue when it detaches (none under reduced
   motion; still detach).
4. Clicking any window in a group brings the whole group to the front.
5. A group can't be dragged so far that a title bar ends up off-screen or under the top bar.

## Resizing
1. Grab **any edge or corner** to resize. The cursor changes to show the direction.
2. **Resizing pushes neighbours**: widening a window in a group pushes the windows snapped to that edge
   along, or shrinks them, so the group stays flush with no gaps or overlaps. Stop at each window's minimum.
3. Each window has a minimum size (set per window so its contents don't break) and can't grow past the screen.
4. **Double-click the title bar to maximise** (fill the area below the top bar). Double-click again to put
   it back where it was, including back into its group.
5. Resize handles follow the reveal rule: they're always there and never move content.

## Remembering layouts
1. **Per account**: sizes, positions, groups and which windows were open are saved to the person's account and
   come back on any desktop device.
2. **One layout per screen shape**. Sort screens into shape buckets by width ÷ height. Suggested buckets
   (the build session can tune them): **tall/square** below 1.45 (e.g. 4:3, 5:4), **standard** 1.45–1.95
   (16:10, 16:9), **wide** 1.95 and up (21:9, 32:9). Each bucket stores its own layout. A bucket with no
   saved layout starts from today's default corners.
3. Within a bucket, if the screen is smaller than when the layout was saved, nudge windows back on-screen and
   shrink them only if they really don't fit, keeping groups together.
4. Signed-out visitors get the same behaviour saved in the browser only (local storage, per screen shape).
5. Save after a drag or resize finishes, not on every pixel. Don't save more than about once a second.
6. **Reset layout** button in Preferences puts every window back in its default corner for the current screen
   shape (and clears that bucket's saved layout).

## Database (needs Luke's typed OK before running)
Plain English: one new table, one row per person, holding their window layouts as a small bundle of
numbers per screen shape. Each person can read and change only their own row (Row Level Security). Nothing
existing is changed or deleted. Follow the CLAUDE.md migration steps (re-runnable, `db:new`, dry run, push)
and add it to `supabase/README.md`. It needs both a mock repository and a Supabase repository like the
other features (`app/lib/*/mock-*`, `supabase-*`).

## Out of scope
- Phones and tablets narrower than `sm`. Any mobile behaviour.
- Pop-up dialogs.
- Merging windows into tabs.
- Snapping to screen edges, half/quarter zones.
- Syncing a layout live between two open tabs (the last save wins).

## Edge cases
- Closing a window that's in a group: the rest of the group stays put. If it reopens, it comes back in its
  saved spot, and re-joins the group only if it's still flush with it.
- The browser window is resized mid-session: keep everything on-screen. If the shape bucket changes (e.g.
  a window is dragged to another monitor), switch to that bucket's layout.
- Opening a window from an address (`/forum?music=1`) uses the saved layout.
- Windows don't re-render the page (window-slot rule): layout state lives in its own small store, not in a
  context over the board.
- Customiser-style "unsaved work asks before closing" still applies to any window that has it.
- Reduced motion: no snap or detach animation.
- Colours from theme tokens only.

## Risks Luke should know about
- **Shake to detach is the riskiest part.** It's hard to find unless you're told about it. Trackpad users may
  find it awkward, and a fast drag can trigger it by accident. The build session should tune the
  sensitivity, and show the hint in the window's status bar (e.g. "SHAKE WHILE DRAGGING TO DETACH").
  **Agent's recommendation:** also add a keyboard/menu way to detach (a small button in the title bar or
  a key), because otherwise people who can't shake a mouse have no way to break a group. Luke to confirm
  at plan time.
- Per-account saving is a database change, so it waits for Luke's OK.

## How the build session proves it's done
- `npm run verify`, `npm run checks`, `npm run capture` + `npm run audit`.
- New checks (prove each fails first): snapping two windows makes a group, dragging moves both, shake
  detaches one, pushing on resize keeps the group flush, layouts are saved per shape bucket, phone width is
  untouched.
- Real-browser screenshots on the deployed site at a standard (1440×900) and a wide (2560×1080) size, plus
  phone width to show nothing changed there. Use test account A (and B to confirm per-account saving
  doesn't leak between people).
- Commit after each verified step; full loop to live; fresh-context subagent review against this spec.
