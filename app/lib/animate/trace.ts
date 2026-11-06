/**
 * The light table and Shift and Trace. Neither ever changes a drawing. The light table washes out every layer but the one in hand. Shift and Trace
 * moves, turns or scales the neighbouring drawing's onion so it can be traced where the new one needs it; SNAP BACK, or going to another frame, puts it
 * back.
 */
import { addActions } from './actions';
import { getEngine } from './engine';
import { toolHandlers } from './pointer';
import { onionNeighbours } from './project';
import { useStudio } from './store';
import { setOnion } from './timeline';

export type TraceMode = 'move' | 'turn' | 'scale';
export type TraceSide = 'prev' | 'next';

type Trace = { celId: string; matrix: DOMMatrix };

let trace: Trace | null = null;
let startPoint: { x: number; y: number } | null = null;
let startMatrix: DOMMatrix | null = null;

export function toggleLightTable(): void {
  const lightTable = !useStudio.getState().lightTable;
  useStudio.setState({ lightTable, notice: { text: lightTable ? 'LIGHT TABLE ON' : 'LIGHT TABLE OFF', fault: false } });
  getEngine().invalidate();
}

/** The neighbour being traced, on the layer in hand. */
function neighbourCelId(side: TraceSide): string | null {
  const engine = getEngine();
  const node = engine.activeLayer;
  if (node === null || node.kind !== 'layer') return null;
  return onionNeighbours(node, engine.frame, side === 'prev' ? -1 : 1, 1, false)[0]?.cel.id ?? null;
}

export function snapBack(): void {
  trace = null;
  useStudio.setState({ shiftTraceOn: false });
  getEngine().invalidate();
}

function matrixFor(mode: TraceMode, base: DOMMatrix, start: { x: number; y: number }, x: number, y: number): DOMMatrix {
  const { project } = useStudio.getState();
  const cx = project.width / 2;
  const cy = project.height / 2;
  if (mode === 'move') return new DOMMatrix().translateSelf(x - start.x, y - start.y).multiplySelf(base);
  if (mode === 'turn') {
    const degrees = ((Math.atan2(y - cy, x - cx) - Math.atan2(start.y - cy, start.x - cx)) * 180) / Math.PI;
    return new DOMMatrix().translateSelf(cx, cy).rotateSelf(degrees).translateSelf(-cx, -cy).multiplySelf(base);
  }
  const from = Math.hypot(start.x - cx, start.y - cy) || 1;
  const scale = Math.max(0.05, Math.hypot(x - cx, y - cy) / from);
  return new DOMMatrix().translateSelf(cx, cy).scaleSelf(scale, scale).translateSelf(-cx, -cy).multiplySelf(base);
}

let installed = false;

/** Tell the engine about tracing: called once when the studio opens. */
export function installTrace(): void {
  if (installed) return;
  installed = true;
  const engine = getEngine();
  engine.onionShift = (celId) => (trace?.celId === celId ? trace.matrix : null);

  toolHandlers.set('shift', {
    penDown: (x, y) => {
      const state = useStudio.getState();
      const celId = neighbourCelId(state.traceSide);
      if (celId === null) {
        engine.notify(state.traceSide === 'prev' ? 'NO DRAWING BEFORE THIS ONE' : 'NO DRAWING AFTER THIS ONE');
        return false;
      }
      if (!state.project.onion.on) setOnion(true);
      if (trace?.celId !== celId) trace = { celId, matrix: new DOMMatrix() };
      useStudio.setState({ shiftTraceOn: true });
      startPoint = { x, y };
      startMatrix = trace.matrix;
      return true;
    },
    penMove: (x, y) => {
      if (trace === null || startPoint === null || startMatrix === null) return;
      trace.matrix = matrixFor(useStudio.getState().traceMode, startMatrix, startPoint, x, y);
      engine.paintBelow();
    },
    penUp: () => {
      startPoint = null;
      startMatrix = null;
      engine.invalidate();
    },
    penCancel: () => {
      if (trace !== null && startMatrix !== null) trace.matrix = startMatrix;
      startPoint = null;
      startMatrix = null;
      engine.invalidate();
    },
  });

  // A nudge belongs to the frame it was made for.
  useStudio.subscribe((state, previous) => {
    if (trace !== null && (state.frame !== previous.frame || state.layerId !== previous.layerId || state.project.id !== previous.project.id)) snapBack();
  });
}

addActions([
  { id: 'view.lighttable', label: 'LIGHT TABLE', group: 'ONION', key: 't', run: toggleLightTable },
  { id: 'tool.shift', label: 'SHIFT AND TRACE', group: 'ONION', key: 'j', run: () => getEngine().setTool('shift') },
  { id: 'trace.back', label: 'SNAP BACK', group: 'ONION', key: 'shift+j', run: snapBack },
]);
