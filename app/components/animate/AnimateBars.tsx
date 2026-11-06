'use client';

import { useEffect, useRef } from 'react';
import { BRUSH_LABELS } from '../../lib/animate/brushes';
import { getEngine } from '../../lib/animate/engine';
import { togglePlaying } from '../../lib/animate/playback';
import { visibleRows } from '../../lib/animate/project';
import { updateSettings, useStudio, type ToolId } from '../../lib/animate/store';
import { PLATE_MEDIUM, PLATE_PRESSED } from '../../lib/ui/controls';
import { CelBox, Playhead, Row, RowName, Ruler, SoundRow, THIN_ROW } from './AnimateTimeline';

const NAME_WIDTH = 128;
const RULER = 24;

const TOOL_WORD: Record<ToolId, string> = { ...BRUSH_LABELS, lasso: 'LASSO', rect: 'BOX', pick: 'PICK', hand: 'HAND', shift: 'TRACE' };

/** Open the tools by the pen, or in the middle of the sheet if the pen isn't over it. */
export function openToolsHere(): void {
  const stage = getEngine().stageSize();
  useStudio.setState({ popup: useStudio.getState().popup !== null ? null : (getEngine().hoverScreen ?? { x: stage.w / 2, y: stage.h / 3 }) });
  updateSettings({ hintSeen: true });
}

/** The current tool, colour and size, and the quiet word about saving: read, not pressed. */
export function StatusWords() {
  const tool = useStudio((state) => state.tool);
  const colour = useStudio((state) => state.colour);
  const brushes = useStudio((state) => state.brushes);
  const saveState = useStudio((state) => state.saveState);
  const smartOn = useStudio((state) => state.smartOn);
  const brush = getEngine().brushForTool(tool);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-key text-ink" data-animate-status>
      <span>{TOOL_WORD[tool]}</span>
      <span aria-label={`Colour ${colour}`} className="inline-block h-4 w-4 border-line border-ink" style={{ backgroundColor: colour }} />
      {brush !== null && <span>{Math.round(brushes[brush].size)}</span>}
      {!smartOn && <span className="bg-bubble-pale px-1 text-ink-bar">SMART OFF</span>}
      <span className={saveState === 'failed' ? 'bg-bubble-pale px-1 text-ink-bar' : 'text-ink'} data-animate-save={saveState}>
        {saveState === 'failed' ? 'NOT SAVING' : saveState === 'saved' ? 'SAVED HERE' : ''}
      </span>
    </span>
  );
}

export function PlayKey() {
  const playing = useStudio((state) => state.playing);
  return (
    <button type="button" className={playing ? PLATE_PRESSED : PLATE_MEDIUM} aria-pressed={playing} title="ENTER" onClick={() => togglePlaying(getEngine())}>
      [ {playing ? 'STOP' : 'PLAY'} ]
    </button>
  );
}

export function FrameWords() {
  const frame = useStudio((state) => state.frame);
  const frames = useStudio((state) => state.project.frames);
  return <span className="whitespace-nowrap text-key text-ink" data-animate-frame={frame}>{`${frame + 1}/${frames}`}</span>;
}

export function ToolsKey() {
  return (
    <button type="button" className={PLATE_MEDIUM} title="X, OR THE PEN'S RIGHT BUTTON" onClick={openToolsHere} data-animate-tools-key>
      [ TOOLS ]
    </button>
  );
}

export function LayersKey() {
  const shown = useStudio((state) => state.settings.showLayers);
  return (
    <button type="button" className={shown ? PLATE_PRESSED : PLATE_MEDIUM} aria-pressed={shown} title="L" onClick={() => updateSettings({ showLayers: !shown })} data-animate-layers-key>
      [ LAYERS ]
    </button>
  );
}

export function MenuKey() {
  return (
    <button
      type="button"
      className={PLATE_MEDIUM}
      title="?"
      data-animate-menu-key
      onClick={() => {
        updateSettings({ hintSeen: true });
        useStudio.setState({ panel: useStudio.getState().panel === 'menu' ? 'none' : 'menu' });
      }}
    >
      [ MENU ]
    </button>
  );
}

/** The thin timeline: a ruler and a row per layer, nothing else. How many rows show depends on the layout. */
export function ThinTimeline({ leading, maxRows = 2 }: { leading: React.ReactNode; maxRows?: number }) {
  const project = useStudio((state) => state.project);
  const frame = useStudio((state) => state.frame);
  const uiScale = useStudio((state) => state.settings.uiScale);
  const scroller = useRef<HTMLDivElement>(null);
  const rows = visibleRows(project);
  const count = Math.max(project.frames + 24, frame + 24);
  const cellWidth = 24;
  // The playhead stays in view, on playback as well as on stepping.
  useEffect(() => {
    const box = scroller.current;
    if (box === null) return;
    const x = NAME_WIDTH + frame * cellWidth;
    if (x < box.scrollLeft + NAME_WIDTH || x + cellWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = x - NAME_WIDTH - box.clientWidth / 3;
  }, [frame]);
  return (
    <section aria-label="Timeline" className="border-t-line border-ink bg-sun-pale" style={{ zoom: uiScale }}>
      <div ref={scroller} className="overflow-auto bg-paper" style={{ maxHeight: RULER + maxRows * THIN_ROW + 20 }}>
        <div className="flex" style={{ width: NAME_WIDTH + count * cellWidth }}>
          <div className="sticky left-0 z-20 shrink-0 border-r-line border-ink bg-sun-pale" style={{ width: NAME_WIDTH }}>
            <div className="sticky top-0 z-10 flex items-center justify-between gap-1 border-b-line border-ink bg-sun-pale px-1" style={{ height: RULER }}>
              {leading}
            </div>
            {rows.map((node) => (
              <RowName key={node.id} node={node} height={THIN_ROW} />
            ))}
          </div>
          <div className="relative min-w-0 flex-1">
            <Ruler cellWidth={cellWidth} count={count} />
            <div className="relative">
              <Playhead cellWidth={cellWidth} />
              <SoundRow cellWidth={cellWidth} count={count} />
              {rows.map((node) => (
                <div key={node.id} className="border-b border-ink">
                  <Row node={node} cellWidth={cellWidth} height={THIN_ROW} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const SHEET_FRAME = 24;
const SHEET_COLUMN = 70;

/** C: the timeline as an animator's time sheet: frames run down, layers across, down the side of the screen rather than under the drawing. */
export function TimeSheet() {
  const project = useStudio((state) => state.project);
  const frame = useStudio((state) => state.frame);
  const layerId = useStudio((state) => state.layerId);
  const uiScale = useStudio((state) => state.settings.uiScale);
  const scroller = useRef<HTMLDivElement>(null);
  const rows = visibleRows(project).filter((node) => node.kind === 'layer');
  const count = Math.max(project.frames + 24, frame + 24);
  useEffect(() => {
    const box = scroller.current;
    if (box === null) return;
    const y = frame * SHEET_FRAME;
    if (y < box.scrollTop || y + SHEET_FRAME > box.scrollTop + box.clientHeight - 24) box.scrollTop = y - box.clientHeight / 3;
  }, [frame]);
  return (
    <section aria-label="Time sheet" className="flex min-h-0 flex-col border-l-line border-ink bg-sun-pale" style={{ zoom: uiScale, width: 44 + Math.max(2, rows.length) * SHEET_COLUMN }}>
      <div className="flex flex-wrap items-center justify-between gap-1 border-b-line border-ink p-1">
        <PlayKey />
        <FrameWords />
        <StatusWords />
        <ToolsKey />
        <LayersKey />
        <MenuKey />
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto bg-paper">
        <div className="relative flex" style={{ height: count * SHEET_FRAME + 26 }}>
          <div className="sticky left-0 z-20 w-10 shrink-0 bg-sun-pale">
            <div className="sticky top-0 z-10 h-6 border-b-line border-ink bg-sun-pale" />
            {Array.from({ length: count }, (_, i) => (
              <button
                key={i}
                type="button"
                tabIndex={-1}
                aria-label={`Go to frame ${i + 1}`}
                data-animate-frame-key
                className={`block w-full cursor-pointer border-b border-ink text-right text-label leading-none ${i === frame ? 'bg-bubble text-ink-plate' : 'text-ink'}`}
                style={{ height: SHEET_FRAME }}
                onClick={() => getEngine().goToFrame(i)}
              >
                {(i + 1) % 2 === 1 || i === frame ? i + 1 : ''}
              </button>
            ))}
          </div>
          {rows.map((node) => (
            <div key={node.id} className="relative shrink-0 border-r border-ink" style={{ width: SHEET_COLUMN }}>
              <button
                type="button"
                className={`sticky top-0 z-10 block h-6 w-full cursor-pointer truncate border-b-line border-ink px-0.5 text-left text-label ${node.id === layerId ? 'bg-ink text-paper' : 'bg-sun-pale text-ink'}`}
                onClick={() => useStudio.setState({ layerId: node.id })}
                title={node.name}
              >
                {node.name}
              </button>
              <div
                className="relative"
                style={{ height: count * SHEET_FRAME, backgroundImage: `repeating-linear-gradient(to bottom, var(--color-ink) 0 1px, transparent 1px ${SHEET_FRAME}px)` }}
                onPointerDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  useStudio.setState({ layerId: node.id });
                  getEngine().goToFrame(Math.floor((event.clientY - rect.top) / (rect.height / count)));
                }}
              >
                {node.cels.map((cel) => (
                  <CelBox key={cel.id} cel={cel} layerId={node.id} cellWidth={SHEET_FRAME} active={cel.frame <= frame && frame < cel.frame + cel.length && node.id === layerId} vertical rowHeight={SHEET_COLUMN} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
