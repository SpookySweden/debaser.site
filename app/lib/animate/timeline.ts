/**
 * What the timeline's keys do: the pure edits in `project.ts`, made undoable, with the pictures looked after.
 */
import { addActions } from './actions';
import { getEngine } from './engine';
import { copyRect } from './history';
import { togglePlaying } from './playback';
import { planeKey } from './planes';
import {
  addDrawing,
  celAt,
  copyDrawing,
  deleteCel,
  insertFrames,
  placeCel,
  removeFrames,
  setCelMark,
  setExposure,
  setHolds,
} from './project';
import { useStudio } from './store';
import type { Cel, CelMark, PlaneName, PlayMode } from './types';

function here(): { layerId: string; frame: number; cel: Cel | null } | null {
  const engine = getEngine();
  const node = engine.activeLayer;
  if (node === null || node.kind !== 'layer') return null;
  const { frame } = useStudio.getState();
  return { layerId: node.id, frame, cel: celAt(node, frame) };
}

/** A blank drawing on this frame; inside a hold it starts a new one here. */
export function newDrawing(): void {
  const at = here();
  if (at === null) return;
  getEngine().edit('NEW DRAWING', (project) => addDrawing(project, at.layerId, at.frame, useStudio.getState().settings.defaultHold).project);
  useStudio.setState({ notice: { text: 'NEW DRAWING', fault: false } });
}

/** The pictures of one drawing, copied to another. */
function copyPictures(fromId: string, toId: string): void {
  const engine = getEngine();
  for (const plane of ['line', 'colour'] as PlaneName[]) {
    const source = engine.planes.peek(planeKey(fromId, plane));
    if (source === null) continue;
    const rect = { x: 0, y: 0, w: source.width, h: source.height };
    const key = planeKey(toId, plane);
    engine.planes.adopt(key, copyRect(source, rect));
    engine.planes.markDirty(key);
  }
}

/** A copy of this drawing right after it, to redraw from. */
export async function duplicateDrawing(): Promise<void> {
  const engine = getEngine();
  const at = here();
  if (at === null || at.cel === null) {
    engine.notify('NO DRAWING TO COPY');
    return;
  }
  const { cel, layerId } = at;
  for (const plane of ['line', 'colour'] as PlaneName[]) await engine.planes.open(planeKey(cel.drawingId, plane));
  engine.edit('COPY DRAWING', (project) => {
    const copied = copyDrawing(project, cel.drawingId);
    copyPictures(cel.drawingId, copied.drawingId);
    return placeCel(copied.project, layerId, cel.frame + cel.length, copied.drawingId, cel.length, cel.mark);
  });
  engine.goToFrame(cel.frame + cel.length);
}

export function deleteDrawing(): void {
  const at = here();
  if (at === null || at.cel === null) return;
  const { cel, layerId } = at;
  getEngine().edit('DELETE DRAWING', (project) => deleteCel(project, layerId, cel.id));
}

export function exposureBy(delta: number, push = true): void {
  const at = here();
  if (at === null || at.cel === null) return;
  const { cel, layerId } = at;
  getEngine().edit('EXPOSURE', (project) => setExposure(project, layerId, cel.id, cel.length + delta, push));
}

export function holdsOn(hold: number): void {
  const at = here();
  if (at === null) return;
  getEngine().edit(`ON ${hold}S`, (project) => setHolds(project, at.layerId, hold));
  useStudio.setState({ notice: { text: `LAYER ON ${hold}S`, fault: false } });
}

export function insertFrame(): void {
  const at = here();
  if (at === null) return;
  getEngine().edit('INSERT FRAME', (project) => insertFrames(project, at.layerId, at.frame, 1));
}

export function removeFrame(): void {
  const at = here();
  if (at === null) return;
  getEngine().edit('REMOVE FRAME', (project) => removeFrames(project, at.layerId, at.frame, 1));
}

const MARKS: CelMark[] = ['key', 'breakdown', 'inbetween'];

export function cycleMark(): void {
  const at = here();
  if (at === null || at.cel === null) return;
  const { cel, layerId } = at;
  const next = MARKS[(MARKS.indexOf(cel.mark) + 1) % MARKS.length];
  getEngine().edit('MARK', (project) => setCelMark(project, layerId, cel.id, next));
  useStudio.setState({ notice: { text: next === 'inbetween' ? 'IN-BETWEEN' : next.toUpperCase(), fault: false } });
}

export function setRangeEnd(which: 'in' | 'out'): void {
  const { frame } = useStudio.getState();
  getEngine().tweak((project) => {
    const last = project.frames - 1;
    const range = project.range ?? { in: 0, out: last };
    if (which === 'in') return { ...project, range: { in: frame, out: Math.max(frame, range.out) } };
    return { ...project, range: { in: Math.min(frame, range.in), out: frame } };
  });
}

export function clearRange(): void {
  getEngine().tweak((project) => ({ ...project, range: null }));
}

const MODES: PlayMode[] = ['loop', 'pingpong', 'once'];

export function setPlayMode(mode: PlayMode): void {
  getEngine().tweak((project) => ({ ...project, playMode: mode }));
}

function cyclePlayMode(): void {
  const { playMode } = useStudio.getState().project;
  setPlayMode(MODES[(MODES.indexOf(playMode) + 1) % MODES.length]);
}

export function setOnion(on: boolean): void {
  getEngine().tweak((project) => ({ ...project, onion: { ...project.onion, on } }));
}

// ── copy and paste of whole drawings ─────────────────────────────────────────────────────

let clipboard: { drawingId: string; length: number; mark: CelMark } | null = null;

export function copyCel(): void {
  const at = here();
  if (at === null || at.cel === null) return;
  clipboard = { drawingId: at.cel.drawingId, length: at.cel.length, mark: at.cel.mark };
  useStudio.setState({ notice: { text: 'DRAWING COPIED', fault: false } });
}

/** A separate copy on this layer and frame, so drawing on it leaves the original alone. */
export async function pasteCel(): Promise<void> {
  const at = here();
  const engine = getEngine();
  if (at === null || clipboard === null) return;
  const { drawingId, length, mark } = clipboard;
  for (const plane of ['line', 'colour'] as PlaneName[]) await engine.planes.open(planeKey(drawingId, plane));
  engine.edit('PASTE DRAWING', (project) => {
    const copied = copyDrawing(project, drawingId);
    copyPictures(drawingId, copied.drawingId);
    return placeCel(copied.project, at.layerId, at.frame, copied.drawingId, length, mark);
  });
}

function goBy(delta: number): void {
  const engine = getEngine();
  engine.goToFrame(Math.max(0, engine.frame + delta));
}

addActions([
  { id: 'time.play', label: 'PLAY / STOP', group: 'TIMELINE', key: 'enter', run: () => togglePlaying(getEngine()) },
  { id: 'time.next', label: 'NEXT FRAME', group: 'TIMELINE', key: '.', run: () => goBy(1) },
  { id: 'time.prev', label: 'PREVIOUS FRAME', group: 'TIMELINE', key: ',', run: () => goBy(-1) },
  { id: 'time.next2', label: 'NEXT FRAME (2ND KEY)', group: 'TIMELINE', key: 'arrowright', run: () => goBy(1) },
  { id: 'time.prev2', label: 'PREVIOUS FRAME (2ND KEY)', group: 'TIMELINE', key: 'arrowleft', run: () => goBy(-1) },
  { id: 'time.nextdrawing', label: 'NEXT DRAWING', group: 'TIMELINE', key: 's', run: () => getEngine().stepDrawing(1) },
  { id: 'time.prevdrawing', label: 'PREVIOUS DRAWING', group: 'TIMELINE', key: 'a', run: () => getEngine().stepDrawing(-1) },
  { id: 'time.start', label: 'GO TO THE START', group: 'TIMELINE', key: 'home', run: () => getEngine().goToFrame(0) },
  { id: 'time.end', label: 'GO TO THE END', group: 'TIMELINE', key: 'end', run: () => getEngine().goToFrame(useStudio.getState().project.frames - 1) },
  { id: 'cel.new', label: 'NEW DRAWING', group: 'TIMELINE', key: 'd', run: newDrawing },
  { id: 'cel.copy', label: 'COPY DRAWING AFTER THIS ONE', group: 'TIMELINE', key: 'shift+d', run: () => void duplicateDrawing() },
  { id: 'cel.delete', label: 'DELETE DRAWING', group: 'TIMELINE', key: 'shift+delete', run: deleteDrawing },
  { id: 'cel.longer', label: 'HOLD LONGER', group: 'TIMELINE', key: 'alt+.', run: () => exposureBy(1) },
  { id: 'cel.shorter', label: 'HOLD SHORTER', group: 'TIMELINE', key: 'alt+,', run: () => exposureBy(-1) },
  { id: 'cel.ones', label: 'LAYER ON 1S', group: 'TIMELINE', key: 'alt+1', run: () => holdsOn(1) },
  { id: 'cel.twos', label: 'LAYER ON 2S', group: 'TIMELINE', key: 'alt+2', run: () => holdsOn(2) },
  { id: 'cel.threes', label: 'LAYER ON 3S', group: 'TIMELINE', key: 'alt+3', run: () => holdsOn(3) },
  { id: 'cel.mark', label: 'KEY / BREAKDOWN / IN-BETWEEN', group: 'TIMELINE', key: 'u', run: cycleMark },
  { id: 'cel.copyclip', label: 'COPY DRAWING', group: 'TIMELINE', key: 'ctrl+c', run: copyCel },
  { id: 'cel.paste', label: 'PASTE DRAWING', group: 'TIMELINE', key: 'ctrl+v', run: () => void pasteCel() },
  { id: 'frame.insert', label: 'INSERT A FRAME', group: 'TIMELINE', key: 'insert', run: insertFrame },
  { id: 'frame.remove', label: 'REMOVE A FRAME', group: 'TIMELINE', key: 'delete', run: removeFrame },
  { id: 'range.in', label: 'RANGE STARTS HERE', group: 'TIMELINE', key: 'b', run: () => setRangeEnd('in') },
  { id: 'range.out', label: 'RANGE ENDS HERE', group: 'TIMELINE', key: 'n', run: () => setRangeEnd('out') },
  { id: 'range.clear', label: 'CLEAR THE RANGE', group: 'TIMELINE', key: 'shift+b', run: clearRange },
  { id: 'range.mode', label: 'LOOP / PING-PONG / ONCE', group: 'TIMELINE', key: 'l', run: cyclePlayMode },
  { id: 'onion.toggle', label: 'ONION SKIN', group: 'ONION', key: 'o', run: () => setOnion(!useStudio.getState().project.onion.on) },
  { id: 'onion.panel', label: 'ONION SETTINGS', group: 'ONION', key: 'shift+o', run: () => useStudio.setState({ panel: useStudio.getState().panel === 'onion' ? 'none' : 'onion' }) },
  { id: 'export.panel', label: 'EXPORT', group: 'FILE', key: 'ctrl+e', run: () => useStudio.setState({ panel: useStudio.getState().panel === 'export' ? 'none' : 'export' }) },
]);
