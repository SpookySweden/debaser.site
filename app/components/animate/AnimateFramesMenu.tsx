'use client';

import { getEngine } from '../../lib/animate/engine';
import { carryForward } from '../../lib/animate/smart';
import { updateSettings, useStudio } from '../../lib/animate/store';
import { clearRange, cycleMark, deleteDrawing, duplicateDrawing, holdsOn, insertFrame, newDrawing, removeFrame, setPlayMode, setRangeEnd } from '../../lib/animate/timeline';
import { toggleLightTable } from '../../lib/animate/trace';
import type { PlayMode } from '../../lib/animate/types';
import { Stepper, TileGrid, useTileColumns, type TileItem } from './AnimateTiles';

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

  const mode = (value: PlayMode, label: string): TileItem => ({ label, on: playMode === value, run: () => setPlayMode(value) });
  const drawings: TileItem[] = [
    { label: 'NEW DRAWING', run: newDrawing },
    { label: 'COPY IT', name: 'Copy the drawing after this one', run: () => void duplicateDrawing() },
    { label: 'DELETE IT', name: 'Delete the drawing', run: deleteDrawing },
    { label: 'MARK IT', name: 'Mark it key, breakdown or in-between', run: cycleMark },
    { label: 'ON 1S', name: 'Layer on 1s', run: () => holdsOn(1) },
    { label: 'ON 2S', name: 'Layer on 2s', run: () => holdsOn(2) },
    { label: 'ON 3S', name: 'Layer on 3s', run: () => holdsOn(3) },
    { label: 'CARRY COLOUR', run: () => void carryForward() },
    { label: 'ADD FRAME', name: 'Insert a frame', run: insertFrame },
    { label: 'CUT FRAME', name: 'Remove a frame', run: removeFrame },
  ];
  const playing: TileItem[] = [
    mode('loop', 'LOOP'),
    mode('pingpong', 'PING-PONG'),
    mode('once', 'ONCE'),
    { label: 'RANGE IN', run: () => setRangeEnd('in') },
    { label: 'RANGE OUT', run: () => setRangeEnd('out') },
    ...(range === null ? [] : [{ label: `CLEAR ${range.in + 1}-${range.out + 1}`, name: 'Clear the range', run: clearRange }]),
  ];
  const more: TileItem[] = [
    { label: 'ONION SETUP', name: 'Onion settings', run: () => useStudio.setState({ panel: 'onion' }) },
    { label: 'LIGHT TABLE', on: lightTable, run: toggleLightTable },
    { label: 'SOUND', run: () => useStudio.setState({ panel: 'sound' }) },
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
            <Stepper label="SPEED" value={`${fps} FPS`} canLess={fps > 1} canMore={fps < 60} less={() => setFps(fps - 1)} more={() => setFps(fps + 1)} />
            <Stepper
              label="FRAME WIDTH"
              value={String(frameWidth)}
              canLess={frameWidth > MIN_FRAME_WIDTH}
              canMore={frameWidth < MAX_FRAME_WIDTH}
              less={() => updateSettings({ frameWidth: Math.max(MIN_FRAME_WIDTH, frameWidth - 4) })}
              more={() => updateSettings({ frameWidth: Math.min(MAX_FRAME_WIDTH, frameWidth + 4) })}
            />
            <Stepper
              label="ROWS SHOWN"
              value={String(rows)}
              canLess={rows > 1}
              canMore={rows < MAX_ROWS}
              less={() => updateSettings({ timelineRows: Math.max(1, rows - 1) })}
              more={() => updateSettings({ timelineRows: Math.min(MAX_ROWS, rows + 1) })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
