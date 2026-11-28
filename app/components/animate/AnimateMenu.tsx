'use client';

import { allActions, keyLabel, keyOf, type Action } from '../../lib/animate/actions';
import { getEngine } from '../../lib/animate/engine';
import { updateSettings, useStudio } from '../../lib/animate/store';
import { AnimatePanelFrame } from './AnimatePanels';
import { explain } from '../../lib/ui/explain';

/** Pressed again and again while watching the result, so the menu stays. */
const STAYS = new Set(['ui.bigger', 'ui.smaller', 'view.in', 'view.out', 'view.left', 'view.right', 'view.flip', 'brush.bigger', 'brush.smaller']);

/** What the hover box says for each thing in the menu (shown only while [ EXPLAIN ] is on). */
const MENU_WORDS: Record<string, [string, string]> = {
  'tool.pencil': ['Takes up the pencil, a grainy line.', 'For rough drawing and sketching.'],
  'tool.ink': ['Takes up the ink brush, a smooth line that thins and thickens with the pen.', 'For clean lines.'],
  'tool.flat': ['Takes up the flat colour brush, which paints a wide, even stroke.', 'For laying down colour by hand.'],
  'tool.eraser': ['Takes up the eraser, which rubs out what you draw over.', 'For taking out part of a drawing.'],
  'tool.hand': ['Takes up the hand, for dragging the sheet around the window.', 'The drawing is not moved on the sheet.'],
  'tool.pick': ['Takes up the colour picker: press the drawing to take its colour.', 'For matching a colour already used.'],
  'tool.fill': ['Takes up the bucket: one press colours the area you press.', 'For filling a shape you have drawn round.'],
  'tool.fillbrush': ['Takes up the fill brush: every area your stroke crosses is coloured.', 'For filling many small areas in one go.'],
  'tool.filleraser': ['Takes up the fill eraser: every area your stroke crosses loses its colour.', 'For emptying many areas in one go.'],
  'tool.lasso': ['Takes up the lasso: draw round part of a drawing to select it.', 'What is selected can be moved, sized or turned.'],
  'tool.rect': ['Takes up the box select: drag a box round part of a drawing to select it.', 'What is selected can be moved, sized or turned.'],
  'tool.shift': ['Takes up Shift and Trace: move a neighbouring drawing on screen to draw over it.', 'That drawing itself is not changed.'],
  'tools.popup': ['Opens the tool pop-up on the sheet.', 'The same block of tools the pen’s right button opens.'],
  'palette.panel': ['Opens the colours panel, with every colour and the palette.', 'For choosing a colour or saving a set of them.'],
  'select.none': ['Lets go of the selection.', 'The drawing stays as it is.'],
  'select.delete': ['Rubs out what is selected.', 'UNDO brings it back.'],
  'edit.undo': ['Takes back your last change.', 'For a stroke or an edit you did not mean.'],
  'edit.redo': ['Puts back the change you last took back.', 'For when you undid one step too many.'],
  'edit.redo2': ['Puts back the change you last took back.', 'The same as REDO, on a second key.'],
  'edit.cancel': ['Closes what is open, or drops the stroke you are drawing.', 'For backing out.'],
  'brush.bigger': ['Makes the brush bigger.', 'The menu stays open, so you can press it again.'],
  'brush.smaller': ['Makes the brush smaller.', 'The menu stays open, so you can press it again.'],
  'view.in': ['Zooms in on the sheet.', 'The menu stays open, so you can press it again.'],
  'view.out': ['Zooms out from the sheet.', 'The menu stays open, so you can press it again.'],
  'view.fit': ['Fits the whole sheet in the window.', 'For getting back after zooming and dragging.'],
  'view.left': ['Turns the view to the left a step.', 'Only the view turns, not the drawing.'],
  'view.right': ['Turns the view to the right a step.', 'Only the view turns, not the drawing.'],
  'view.flip': ['Mirrors the view left to right.', 'A fresh look at a drawing; the drawing itself is not flipped.'],
  'view.full': ['Goes full screen, or leaves it.', 'Full screen is just the sheet and the timeline.'],
  'view.sidepanel': ["Shows or hides the site's side panel.", 'For more room, or to get at the rest of the site.'],
  'view.lighttable': ['Switches the light table on or off: the other layers wash out.', 'For seeing the layer you are on clearly.'],
  'ui.bigger': ["Makes the studio's keys and panels a size bigger.", 'For reading them more easily.'],
  'ui.smaller': ["Makes the studio's keys and panels a size smaller.", 'For more room for the sheet.'],
  'settings.panel': ['Opens the settings: pen, smarts, drawings, size, saving and keys.', 'For setting the studio up your way.'],
  'file.projects': ['Opens your projects: start, open or delete one.', 'Projects are kept in this browser.'],
  'file.save': ['Saves this project to a file where you choose.', 'A star by its name means the file is behind your latest work.'],
  'file.open': ['Opens a project file from your computer.', 'For work saved to a file before.'],
  'picture.import': ['Brings a picture from your computer onto the sheet.', 'For tracing over, or using as part of a drawing.'],
  'export.panel': ['Opens or closes export: a GIF, picture frames or a video.', 'For taking the animation out of the studio.'],
  'time.menu': ['Opens the timeline menu: drawings, holds, range, onion and sound.', 'Everything to do with frames is in it.'],
  'time.play': ['Plays the animation, or stops it.', 'For checking how the movement reads.'],
  'time.next': ['Goes on one frame.', 'For stepping through the movement.'],
  'time.prev': ['Goes back one frame.', 'For stepping through the movement.'],
  'time.next2': ['Goes on one frame.', 'The same as NEXT FRAME, on a second key.'],
  'time.prev2': ['Goes back one frame.', 'The same as PREVIOUS FRAME, on a second key.'],
  'time.nextdrawing': ['Jumps to the next drawing on this layer.', 'For skipping over held frames.'],
  'time.prevdrawing': ['Jumps to the drawing before on this layer.', 'For skipping over held frames.'],
  'time.start': ['Goes to the first frame.', 'For starting again from the top.'],
  'time.end': ['Goes to the last frame.', 'For getting to the end of a long shot.'],
  'cel.new': ['Starts a blank drawing on this frame.', 'On the layer you are on.'],
  'cel.copy': ['Puts a copy of this drawing right after it and goes there.', 'For changing a little from one drawing to the next.'],
  'cel.delete': ['Deletes the drawing on this frame, at once.', 'UNDO brings it back.'],
  'cel.longer': ['Holds this drawing one frame longer.', 'For slowing a moment down.'],
  'cel.shorter': ['Holds this drawing one frame less.', 'For speeding a moment up.'],
  'cel.ones': ['Makes every drawing on this layer last one frame.', 'For the smoothest movement.'],
  'cel.twos': ['Makes every drawing on this layer last two frames.', 'The usual pace for drawn animation.'],
  'cel.threes': ['Makes every drawing on this layer last three frames.', 'For a slower, choppier pace.'],
  'cel.mark': ['Changes this drawing’s mark: key, breakdown or in-between.', 'The mark shows on the timeline.'],
  'cel.copyclip': ['Copies this drawing, ready to paste.', 'For using it again somewhere else.'],
  'cel.paste': ['Pastes the copied drawing here.', 'On the layer and frame you are on.'],
  'frame.insert': ['Inserts one frame here.', 'For making room, or holding a moment longer.'],
  'frame.remove': ['Takes one frame out here.', 'For tightening the timing.'],
  'range.in': ['Starts the playing range at this frame.', 'PLAY then keeps to that stretch.'],
  'range.out': ['Ends the playing range at this frame.', 'PLAY then keeps to that stretch.'],
  'range.clear': ['Clears the playing range.', 'The whole shot plays again.'],
  'range.mode': ['Changes how PLAY runs: loop, ping-pong or once, one after another.', 'For watching a movement the way you need.'],
  'sound.panel': ['Opens the sound panel.', 'For adding a sound to the shot and timing it.'],
  'onion.toggle': ['Turns onion skin on or off: the drawings either side show faintly.', 'For lining a drawing up with its neighbours.'],
  'onion.panel': ['Opens the onion skin settings.', 'How many drawings show, and how they look.'],
  'trace.back': ['Puts the shifted drawings back where they belong.', 'No drawing is changed.'],
  'smart.carry': ['Colours the next drawing from this one, area by area.', 'It needs a figure layer and a next drawing.'],
  'smart.toggle': ['Turns the smarts on or off.', 'Held down on the keyboard, it flips them for one stroke only.'],
  'smart.make': ["Treats the selected colour as if drawn with this layer tag's smarts.", 'The layer needs a tag with smarts.'],
  'layer.new': ['Adds a new empty layer.', 'For drawing something apart from what is there.'],
  'layer.folder': ['Adds a new folder.', 'For keeping related layers together.'],
  'layer.up': ['Picks the row above.', 'For moving through the layers without the mouse.'],
  'layer.down': ['Picks the row below.', 'For moving through the layers without the mouse.'],
  'layer.moveup': ['Moves this row up the list.', 'Higher rows are drawn on top.'],
  'layer.movedown': ['Moves this row down the list.', 'Lower rows are drawn underneath.'],
  'layer.visible': ['Hides this row from the sheet, or shows it.', 'Nothing in it is changed.'],
  'layer.lock': ['Locks this row, or unlocks it.', 'Nothing can be drawn on a locked row.'],
  'layer.solo': ['Shows only this row, or ends that.', 'For looking at one thing on its own.'],
  'layer.delete': ['Deletes this row and what is in it, at once.', 'UNDO brings it back.'],
  'layer.panel': ['Shows or hides the layer list.', 'For more room to draw, or for working with layers.'],
  'tag.panel': ['Opens the layer tags.', 'A tag gives a layer a colour mark and smart ways of behaving.'],
  'help.keys': ['Opens or closes this menu.', 'It lists everything with its key.'],
  'help.close': ['Closes the panel that is open.', 'For getting back to the sheet.'],
};

/** A thing with no words of its own above: the numbered tag keys, and anything added later. */
const menuWords = (action: Action): [string, string] =>
  MENU_WORDS[action.id] ?? (action.id.startsWith('tag.layer.') ? [`Adds a new layer wearing tag number ${action.id.slice('tag.layer.'.length)}.`, 'The numbers follow the order of the tags panel.'] : [`Does ${action.label.toLowerCase()}, the same as pressing its key.`, 'Every action of the studio is listed here.']);

/**
 * The one way in to everything: every action the studio has, under its heading, with its key. Written from the action list, so nothing can
 * be on the keyboard and missing here, or the other way round.
 */
export default function AnimateMenu() {
  const name = useStudio((state) => state.project.name);
  const saveState = useStudio((state) => state.saveState);
  const fileDirty = useStudio((state) => state.fileDirty);
  const zoomPercent = useStudio((state) => state.zoomPercent);
  const uiScale = useStudio((state) => state.settings.uiScale);
  const engine = getEngine();
  const groups = new Map<string, Action[]>();
  for (const action of allActions()) groups.set(action.group, [...(groups.get(action.group) ?? []), action]);
  return (
    <AnimatePanelFrame title="MENU" wide>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-title">
        <input
          aria-label="Project name"
          value={name}
          maxLength={60}
          onChange={(event) => engine.tweak((project) => ({ ...project, name: event.target.value }))}
          className="frame w-56 max-w-full bg-paper px-1 py-0.5 font-mono text-title text-ink outline-none focus:outline-2 focus:outline-dotted focus:outline-bubble"
        />
        <span role="status">{saveState === 'failed' ? 'NOT SAVING' : saveState === 'saved' ? 'SAVED HERE' : 'SAVING SOON'}</span>
        <span>{`SHEET ${zoomPercent}%`}</span>
        <span>{`INTERFACE ${Math.round(uiScale * 100)}%`}</span>
      </div>
      <p className="mb-2 text-title">HOLD SPACE OR THE MIDDLE BUTTON TO PAN. WHEEL TO ZOOM. SHIFT + WHEEL TO TURN. ALT + PEN PICKS A COLOUR. THE RIGHT BUTTON OPENS THE TOOLS, AND DROPS A STROKE MID-LINE.</p>
      <div className="columns-2 gap-4 max-md:columns-1">
        {[...groups.entries()].map(([group, actions]) => (
          <section key={group} className="mb-3 break-inside-avoid">
            <h3 className="text-title text-accent-ink">{group}</h3>
            <ul>
              {actions.map((action) => (
                <li key={action.id}>
                  <button
                    type="button"
                    className="key flex w-full cursor-pointer items-baseline justify-between gap-2 px-1 py-0.5 text-left text-title"
                    data-animate-menu-item={action.id}
                    {...explain(...menuWords(action))}
                    onClick={() => {
                      updateSettings({ hintSeen: true });
                      if (!STAYS.has(action.id)) useStudio.setState({ panel: 'none' });
                      action.run();
                    }}
                  >
                    <span className="min-w-0">{action.id === 'file.save' && fileDirty ? `${action.label} *` : action.label}</span>
                    <span className="shrink-0 whitespace-nowrap">{keyOf(action) === '' ? '' : keyLabel(keyOf(action))}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </AnimatePanelFrame>
  );
}
