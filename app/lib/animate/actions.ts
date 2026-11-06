/**
 * Everything the studio can do from a key, in one list: the keyboard handler, the remap screen and the cheat sheet all read it, so a
 * new action is on all three by being written here.
 */
import { togglePagePanel } from '../ui/side-panel-page';
import { MAX_BRUSH_SIZE } from './brushes';
import { getEngine } from './engine';
import { keys } from './pointer';
import { UI_SCALES, updateSettings, useStudio, type Panel, type ToolId } from './store';

export type Action = {
  id: string;
  label: string;
  group: string;
  key: string;
  run: () => void;
  /** For a key held down: told when it's let go. */
  release?: () => void;
};

function tool(id: string, label: string, key: string, which: ToolId): Action {
  return { id: `tool.${id}`, label, group: 'TOOLS', key, run: () => getEngine().setTool(which) };
}

/** Full screen is the sheet and the timeline and nothing else, so the layers fold away on the way in. */
export function toggleFull(): void {
  const full = !useStudio.getState().settings.full;
  updateSettings(full ? { full, showLayers: false } : { full });
}

/** The tools, at the pen, or in the middle of the sheet if the pen isn't over it. */
export function toggleTools(): void {
  const engine = getEngine();
  const stage = engine.stageSize();
  useStudio.setState({ popup: useStudio.getState().popup !== null ? null : (engine.hoverScreen ?? { x: stage.w / 2, y: stage.h / 3 }) });
  updateSettings({ hintSeen: true });
}

export function toggleMenu(): void {
  updateSettings({ hintSeen: true });
  togglePanel('menu');
}

export function toggleFramesMenu(): void {
  updateSettings({ hintSeen: true });
  togglePanel('frames');
}

export function stepUiScale(direction: -1 | 1): void {
  const { uiScale } = useStudio.getState().settings;
  const at = UI_SCALES.indexOf(uiScale);
  const next = UI_SCALES[Math.max(0, Math.min(UI_SCALES.length - 1, (at < 0 ? 0 : at) + direction))];
  updateSettings({ uiScale: next });
}

function togglePanel(panel: Panel): void {
  const state = useStudio.getState();
  useStudio.setState({ panel: state.panel === panel ? 'none' : panel });
}

function brushSizeBy(factor: number): void {
  const state = useStudio.getState();
  const brush = getEngine().brushForTool(state.tool);
  if (brush === null) return;
  const size = state.brushes[brush].size;
  const next = factor > 1 ? Math.max(size + 1, size * factor) : Math.min(size - 1, size * factor);
  getEngine().setBrushSize(brush, Math.min(MAX_BRUSH_SIZE, next));
}

/** Actions other modules bring (timeline, layers, smarts). */
const extra: Action[] = [];

export function addActions(list: Action[]): void {
  for (const action of list) {
    if (!extra.some((other) => other.id === action.id)) extra.push(action);
  }
}

export function allActions(): Action[] {
  return [
    tool('pencil', 'PENCIL', 'p', 'pencil'),
    tool('ink', 'INK', 'i', 'ink'),
    tool('flat', 'FLAT COLOUR', 'f', 'flat'),
    tool('eraser', 'ERASER', 'e', 'eraser'),
    tool('hand', 'HAND', 'h', 'hand'),
    tool('pick', 'COLOUR PICKER', 'k', 'pick'),
    { id: 'tools.popup', label: 'THE TOOLS, BY THE PEN', group: 'TOOLS', key: 'x', run: toggleTools },
    { id: 'palette.panel', label: 'PALETTE AND OTHER COLOURS', group: 'TOOLS', key: '', run: () => togglePanel('palette') },
    { id: 'edit.undo', label: 'UNDO', group: 'EDIT', key: 'ctrl+z', run: () => getEngine().undo() },
    { id: 'edit.redo', label: 'REDO', group: 'EDIT', key: 'ctrl+y', run: () => getEngine().redo() },
    { id: 'edit.redo2', label: 'REDO (2ND KEY)', group: 'EDIT', key: 'ctrl+shift+z', run: () => getEngine().redo() },
    {
      id: 'edit.cancel',
      label: 'DROP THE STROKE, OR CLOSE',
      group: 'EDIT',
      key: 'escape',
      run: () => {
        const state = useStudio.getState();
        if (state.popup !== null) useStudio.setState({ popup: null });
        else if (state.panel !== 'none') useStudio.setState({ panel: 'none' });
        else getEngine().cancelStroke();
      },
    },
    { id: 'brush.bigger', label: 'BRUSH BIGGER', group: 'TOOLS', key: ']', run: () => brushSizeBy(1.2) },
    { id: 'brush.smaller', label: 'BRUSH SMALLER', group: 'TOOLS', key: '[', run: () => brushSizeBy(1 / 1.2) },
    { id: 'view.in', label: 'ZOOM IN', group: 'VIEW', key: '=', run: () => getEngine().zoomAt(1.25) },
    { id: 'view.out', label: 'ZOOM OUT', group: 'VIEW', key: '-', run: () => getEngine().zoomAt(1 / 1.25) },
    { id: 'view.fit', label: 'FIT THE SHEET', group: 'VIEW', key: '0', run: () => getEngine().fitView() },
    { id: 'view.left', label: 'TURN LEFT', group: 'VIEW', key: 'shift+r', run: () => getEngine().rotateBy(-15) },
    { id: 'view.right', label: 'TURN RIGHT', group: 'VIEW', key: 'r', run: () => getEngine().rotateBy(15) },
    { id: 'view.flip', label: 'MIRROR THE VIEW', group: 'VIEW', key: 'm', run: () => getEngine().flipView() },
    { id: 'view.full', label: 'FULL SCREEN', group: 'VIEW', key: '`', run: toggleFull },
    { id: 'view.sidepanel', label: "THE SITE'S SIDE PANEL", group: 'VIEW', key: '\\', run: togglePagePanel },
    { id: 'ui.bigger', label: 'INTERFACE BIGGER', group: 'VIEW', key: "ctrl+'", run: () => stepUiScale(1) },
    { id: 'ui.smaller', label: 'INTERFACE SMALLER', group: 'VIEW', key: 'ctrl+;', run: () => stepUiScale(-1) },
    { id: 'file.projects', label: 'PROJECTS', group: 'FILE', key: '', run: () => togglePanel('projects') },
    { id: 'file.save', label: 'SAVE TO A FILE', group: 'FILE', key: 'ctrl+s', run: () => void getEngine().saveToFile() },
    { id: 'file.open', label: 'OPEN A FILE', group: 'FILE', key: 'ctrl+o', run: () => document.getElementById('animate-open-file')?.click() },
    { id: 'time.menu', label: 'THE TIMELINE MENU', group: 'TIMELINE', key: 'shift+f', run: toggleFramesMenu },
    { id: 'help.keys', label: 'MENU', group: 'HELP', key: '?', run: toggleMenu },
    { id: 'help.close', label: 'CLOSE THE PANEL', group: 'HELP', key: 'shift+escape', run: () => useStudio.setState({ panel: 'none' }) },
    ...extra,
  ];
}

/** The key an action answers to, counting the person's own remap. */
export function keyOf(action: Action): string {
  return useStudio.getState().settings.shortcuts[action.id] ?? action.key;
}

/** A key press as a name: `ctrl+shift+z`, `q`, `[`. */
export function keyName(event: KeyboardEvent): string {
  const key = event.key.toLowerCase();
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('ctrl');
  if (event.altKey) parts.push('alt');
  // Shift is part of a symbol's own name (`?`), so it counts only on letters, digits and named keys.
  if (event.shiftKey && (key.length > 1 || /[a-z0-9]/.test(key))) parts.push('shift');
  parts.push(key === ' ' ? 'space' : key);
  return parts.join('+');
}

/** How a key reads on screen. */
export function keyLabel(key: string): string {
  return key.toUpperCase().replace(/\+/g, ' + ');
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'range', 'color', 'file'].includes(target.type);
  return false;
}

let capturingKey = false;

/** The remap screen is listening for a key of its own. */
export function setKeyCapture(on: boolean): void {
  capturingKey = on;
}

/** The studio's keyboard, for as long as the page is open. */
export function attachKeys(): () => void {
  const onDown = (event: KeyboardEvent) => {
    if (isTyping(event.target) || capturingKey) return;
    const name = keyName(event);
    if (name === 'space') {
      keys.space = true;
      // On a focused key, space still presses it.
      if (!(event.target instanceof HTMLButtonElement)) event.preventDefault();
      return;
    }
    if (event.repeat && !['=', '-', '[', ']', ',', '.', 'arrowleft', 'arrowright'].includes(name)) {
      if (allActions().some((action) => keyOf(action) === name)) event.preventDefault();
      return;
    }
    const action = allActions().find((candidate) => keyOf(candidate) === name);
    if (action === undefined) return;
    // Enter and arrows belong to a focused key or slider.
    if ((name === 'enter' || name.startsWith('arrow')) && document.activeElement !== document.body && !(document.activeElement instanceof HTMLCanvasElement)) return;
    event.preventDefault();
    action.run();
    // A key does what the pop-up was open to do, so it goes. Sizing the brush is the exception: that's watched in the pop-up.
    if (action.id !== 'tools.popup' && !action.id.startsWith('brush.') && useStudio.getState().popup !== null) useStudio.setState({ popup: null });
  };
  const onUp = (event: KeyboardEvent) => {
    if (event.key === ' ') keys.space = false;
    if (isTyping(event.target) || capturingKey) return;
    // By the bare key: a modifier may have been let go first.
    const bare = (key: string) => key.split('+').pop();
    const name = bare(keyName(event));
    for (const action of allActions()) if (action.release !== undefined && bare(keyOf(action)) === name) action.release();
  };
  // A key let go in another window never reports it.
  const onBlur = () => {
    keys.space = false;
    for (const action of allActions()) action.release?.();
  };
  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);
  window.addEventListener('blur', onBlur);
  return () => {
    window.removeEventListener('keydown', onDown);
    window.removeEventListener('keyup', onUp);
    window.removeEventListener('blur', onBlur);
    keys.space = false;
  };
}
