'use client';

import { toggleFramesMenu, toggleMenu, toggleTools } from '../../lib/animate/actions';
import { BRUSH_LABELS } from '../../lib/animate/brushes';
import { getEngine } from '../../lib/animate/engine';
import { togglePlaying } from '../../lib/animate/playback';
import { importPicture } from '../../lib/animate/picture';
import { FILE_EXTENSION } from '../../lib/animate/project-file';
import { makeSmart } from '../../lib/animate/smart';
import { updateSettings, useStudio, type ToolId } from '../../lib/animate/store';
import { snapBack } from '../../lib/animate/trace';
import { PLATE_MEDIUM, PLATE_PRESSED } from '../../lib/ui/controls';

const TOOL_WORD: Record<ToolId, string> = { ...BRUSH_LABELS, lasso: 'LASSO', rect: 'BOX', pick: 'PICK', hand: 'HAND', shift: 'TRACE' };

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
      <span role="status" className={saveState === 'failed' ? 'bg-bubble-pale px-1 text-ink-bar' : 'text-ink'} data-animate-save={saveState}>
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

/** Where we are, and for a long shot, how far along getting it ready is. */
export function FrameWords() {
  const frame = useStudio((state) => state.frame);
  const frames = useStudio((state) => state.project.frames);
  const readying = useStudio((state) => state.readying);
  if (readying !== null) return <span role="status" className="whitespace-nowrap text-key text-ink">{Math.round(readying * 100)}%</span>;
  return <span className="whitespace-nowrap text-key text-ink" data-animate-frame={frame}>{`${frame + 1}/${frames}`}</span>;
}

export function FramesKey() {
  const open = useStudio((state) => state.panel === 'frames');
  return (
    <button type="button" className={open ? PLATE_PRESSED : PLATE_MEDIUM} aria-pressed={open} title="SHIFT + F" onClick={toggleFramesMenu} data-animate-frames-key>
      [ FRAMES ]
    </button>
  );
}

export function ToolsKey() {
  return (
    <button type="button" className={PLATE_MEDIUM} title="X, OR THE PEN'S RIGHT BUTTON" onClick={toggleTools} data-animate-tools-key>
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
    <button type="button" className={PLATE_MEDIUM} title="?" onClick={toggleMenu} data-animate-menu-key>
      [ MENU ]
    </button>
  );
}

/** Keys that only mean something now: Shift and Trace's options with its tool in hand, MAKE SMART with something selected. */
export function WhenItApplies() {
  const tool = useStudio((state) => state.tool);
  const hasSelection = useStudio((state) => state.hasSelection);
  const mode = useStudio((state) => state.traceMode);
  const side = useStudio((state) => state.traceSide);
  const on = useStudio((state) => state.shiftTraceOn);
  const uiScale = useStudio((state) => state.settings.uiScale);
  if (tool !== 'shift' && !hasSelection) return null;
  return (
    <div className="absolute bottom-1 left-1 z-20 flex max-w-full flex-wrap gap-x-1 bg-paper" style={{ zoom: uiScale }}>
      {tool === 'shift' && (
        <div role="group" aria-label="Shift and Trace" className="flex flex-wrap gap-x-1" data-animate-trace-keys>
          {(['prev', 'next'] as const).map((value) => (
            <button key={value} type="button" className={side === value ? PLATE_PRESSED : PLATE_MEDIUM} aria-pressed={side === value} onClick={() => useStudio.setState({ traceSide: value })}>
              [ {value === 'prev' ? 'BEFORE' : 'AFTER'} ]
            </button>
          ))}
          {(['move', 'turn', 'scale'] as const).map((value) => (
            <button key={value} type="button" className={mode === value ? PLATE_PRESSED : PLATE_MEDIUM} aria-pressed={mode === value} onClick={() => useStudio.setState({ traceMode: value })}>
              [ {value.toUpperCase()} ]
            </button>
          ))}
          <button type="button" className={PLATE_MEDIUM} disabled={!on} onClick={snapBack} title="SHIFT + J">
            [ SNAP BACK ]
          </button>
        </div>
      )}
      {hasSelection && (
        <button type="button" className={PLATE_MEDIUM} onClick={() => void makeSmart()} title="SHIFT + Q" data-animate-make-smart>
          [ MAKE SMART ]
        </button>
      )}
    </div>
  );
}

/** The browser's file pickers, which OPEN A FILE and IMPORT A PICTURE press from the menu or the keyboard. */
export function FilePickers() {
  return (
    <>
      <input
        id="animate-open-file"
        type="file"
        accept={`${FILE_EXTENSION},.zip`}
        className="sr-only"
        tabIndex={-1}
        aria-label="Open a project file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file !== undefined) void getEngine().openFile(file);
        }}
      />
      <input
        id="animate-import-picture"
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-label="Import a picture"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file !== undefined) void importPicture(file);
        }}
      />
    </>
  );
}
