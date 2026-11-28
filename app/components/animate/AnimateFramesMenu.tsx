'use client';

import { getEngine } from '../../lib/animate/engine';
import { carryForward } from '../../lib/animate/smart';
import { updateSettings, useStudio } from '../../lib/animate/store';
import { clearRange, cycleMark, deleteDrawing, duplicateDrawing, holdsOn, insertFrame, newDrawing, removeFrame, setPlayMode, setRangeEnd } from '../../lib/animate/timeline';
import { toggleLightTable } from '../../lib/animate/trace';
import type { PlayMode } from '../../lib/animate/types';
import { Stepper, TileGrid, useTileColumns, type TileItem } from './AnimateTiles';
import {  } from '../../lib/ui/explain';

const close = () => useStudio.setState({ panel: 'none' });

function press(item: TileItem): void {
  close();
  item.run();
}

const MIN_FRAME_WIDTH = 8;
const MAX_FRAME_WIDTH = 80;
const MAX_ROWS = 8;

/** What the timeline's old strip of keys did: everything for the frames, in one block by the timeline. One press, and it closes itself. */
export default function AnimateFramesMenu() {
  const open = useStudio((state) => state.panel === 'frames');
  const playMode = useStudio((state) => state.project.playMode);
  const range = useStudio((state) => state.project.range);
  const fps = useStudio((state) => state.project.fps);
  const lightTable = useStudio((state) => state.lightTable);
  const uiScale = useStudio((state) => state.settings.uiScale);
  const frameWidth = useStudio((state) => state.settings.frameWidth);
  const rows = useStudio((state) => state.settings.timelineRows);
  const columns = useTileColumns(4);
  if (!open) return null;

  const mode = (value: PlayMode, label: string, does: string): TileItem => ({ label, on: playMode === value, run: () => setPlayMode(value), words: { what: does, why: 'This is how PLAY runs the frames.' } });
  const holds = (hold: number): TileItem => ({
    label: `ON ${hold}S`,
    name: `Layer on ${hold}s`,
    run: () => holdsOn(hold),
    words: { what: `Makes every drawing on this layer last ${hold} ${hold === 1 ? 'frame' : 'frames'}, one after another.`, why: 'For setting the pace of the whole layer at once.' },
  });
  const drawings: TileItem[] = [
    { label: 'NEW DRAWING', run: newDrawing, words: { what: 'Starts a blank drawing on this frame, on the layer you are on.', why: 'Pressed inside a held drawing, the new one starts here.' } },
    { label: 'COPY IT', name: 'Copy the drawing after this one', run: () => void duplicateDrawing(), words: { what: 'Puts a copy of this drawing right after it and goes there.', why: 'For changing a little from one drawing to the next.' } },
    { label: 'DELETE IT', name: 'Delete the drawing', run: deleteDrawing, words: { what: 'Deletes the drawing on this frame, at once.', why: 'UNDO brings it back.' } },
    { label: 'MARK IT', name: 'Mark it key, breakdown or in-between', run: cycleMark, words: { what: 'Changes this drawing’s mark: key, breakdown or in-between, one after another.', why: 'The mark shows as a letter and colour on the timeline.' } },
    holds(1),
    holds(2),
    holds(3),
    { label: 'CARRY COLOUR', run: () => void carryForward(), words: { what: 'Colours the next drawing from this one, area by area, and goes to it.', why: 'It needs a figure layer and a next drawing.' } },
    { label: 'ADD FRAME', name: 'Insert a frame', run: insertFrame, words: { what: 'Inserts one frame here on this layer.', why: 'For making room, or holding a moment longer.' } },
    { label: 'CUT FRAME', name: 'Remove a frame', run: removeFrame, words: { what: 'Takes one frame out here on this layer.', why: 'For tightening the timing; UNDO brings it back.' } },
  ];
  const playing: TileItem[] = [
    mode('loop', 'LOOP', 'Sets playback to go round and round.'),
    mode('pingpong', 'PING-PONG', 'Sets playback to run forwards, then backwards, and so on.'),
    mode('once', 'ONCE', 'Sets playback to run through one time and stop.'),
    { label: 'RANGE IN', run: () => setRangeEnd('in'), words: { what: 'Starts the playing range at the frame you are on.', why: 'PLAY then keeps to that stretch.' } },
    { label: 'RANGE OUT', run: () => setRangeEnd('out'), words: { what: 'Ends the playing range at the frame you are on.', why: 'PLAY then keeps to that stretch.' } },
    ...(range === null ? [] : [{ label: `CLEAR ${range.in + 1}-${range.out + 1}`, name: 'Clear the range', run: clearRange, words: { what: 'Clears the playing range, so the whole shot plays again.', why: 'No drawing is changed.' } }]),
  ];
  const more: TileItem[] = [
    { label: 'ONION SETUP', name: 'Onion settings', run: () => useStudio.setState({ panel: 'onion' }), words: { what: 'Opens the onion skin settings: how many drawings show, and how.', why: 'For tuning what you see either side of this drawing.' } },
    { label: 'LIGHT TABLE', on: lightTable, run: toggleLightTable, words: { what: lightTable ? 'Switches the light table off.' : 'Switches the light table on: the other layers wash out.', why: 'For seeing the layer you are on clearly.' } },
    { label: 'SOUND', run: () => useStudio.setState({ panel: 'sound' }), words: { what: 'Opens the sound panel: add a sound to the shot and time it.', why: 'For animating to music or speech.' } },
  ];
  const setFps = (value: number) => getEngine().tweak((project) => ({ ...project, fps: Math.max(1, Math.min(60, value)) }));

  return (
    <div className="absolute inset-0 z-30 overflow-hidden" data-animate-frames-layer>
      <button type="button" aria-label="Close the timeline menu" tabIndex={-1} className="absolute inset-0 h-full w-full cursor-default" onPointerDown={close} />
      <div role="dialog" aria-label="Timeline menu" data-animate-frames-menu className="absolute bottom-1 left-1 max-h-full max-w-full overflow-auto frame bg-paper text-ink">
        <div className="flex flex-col gap-2 p-2" style={{ zoom: uiScale }}>
          <TileGrid items={drawings} columns={columns} onPress={press} />
          <div className="border-t-line border-ink pt-2">
            <TileGrid items={playing} columns={columns} onPress={press} />
          </div>
          <div className="border-t-line border-ink pt-2">
            <TileGrid items={more} columns={columns} onPress={press} />
          </div>
          <div className="flex flex-col gap-1 border-t-line border-ink pt-2">
            <Stepper label="SPEED" value={`${fps} FPS`} canLess={fps > 1} canMore={fps < 60} less={() => setFps(fps - 1)} more={() => setFps(fps + 1)} lessWords={{ what: 'Plays one frame a second slower.', why: 'The drawings are not changed, only the speed.' }} moreWords={{ what: 'Plays one frame a second faster.', why: 'The drawings are not changed, only the speed.' }} />
            <Stepper
              label="FRAME WIDTH"
              value={String(frameWidth)}
              canLess={frameWidth > MIN_FRAME_WIDTH}
              canMore={frameWidth < MAX_FRAME_WIDTH}
              less={() => updateSettings({ frameWidth: Math.max(MIN_FRAME_WIDTH, frameWidth - 4) })}
              more={() => updateSettings({ frameWidth: Math.min(MAX_FRAME_WIDTH, frameWidth + 4) })}
              lessWords={{ what: 'Draws each frame narrower on the timeline.', why: 'More of the shot fits across.' }}
              moreWords={{ what: 'Draws each frame wider on the timeline.', why: 'Easier to aim at, and the little pictures are bigger.' }}
            />
            <Stepper
              label="ROWS SHOWN"
              value={String(rows)}
              canLess={rows > 1}
              canMore={rows < MAX_ROWS}
              less={() => updateSettings({ timelineRows: Math.max(1, rows - 1) })}
              more={() => updateSettings({ timelineRows: Math.min(MAX_ROWS, rows + 1) })}
              lessWords={{ what: 'Shows one layer row fewer in the timeline.', why: 'It leaves more room for the sheet.' }}
              moreWords={{ what: 'Shows one more layer row in the timeline.', why: 'It takes a little room from the sheet.' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
