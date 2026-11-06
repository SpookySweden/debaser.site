/**
 * What the layer list's keys do: the pure edits in `project.ts`, made undoable, with the studio's own idea of "the active row" kept right.
 */
import { addActions } from './actions';
import { BRUSH_SHAPES } from './brushes';
import { getEngine } from './engine';
import { addNode, deleteNode, findNode, firstLayer, isInside, moveNode, nudgeNode, updateNode, visibleRows } from './project';
import { updateSettings, useStudio } from './store';
import { isFigure, tagOf } from './tags';
import type { BlendMode, LayerNode } from './types';

export const BLEND_LABELS: Record<BlendMode, string> = {
  normal: 'NORMAL',
  multiply: 'MULTIPLY',
  screen: 'SCREEN',
  overlay: 'OVERLAY',
  add: 'ADD',
};

export function selectRow(id: string): void {
  const state = useStudio.getState();
  const node = findNode(state.project, id);
  if (node === null) return;
  // A row that isn't a Figure has only its one plane; a Figure keeps whichever the tool wants.
  const brush = getEngine().brushForTool(state.tool);
  const plane = node.kind === 'layer' && isFigure(state.project, node) && brush !== null && BRUSH_SHAPES[brush].colourPlane ? 'colour' : 'line';
  useStudio.setState({ layerId: id, plane });
  getEngine().invalidate();
}

/** A new row just above the active one (inside it, if it's a folder). */
export function newRow(kind: 'layer' | 'folder', tagId: string | null = null): void {
  const engine = getEngine();
  const { layerId } = useStudio.getState();
  let id = '';
  engine.edit(kind === 'folder' ? 'NEW FOLDER' : 'NEW LAYER', (project) => {
    const added = addNode(project, kind, layerId);
    id = added.id;
    if (tagId === null) return added.project;
    const tag = project.tags.find((t) => t.id === tagId);
    if (tag === undefined) return added.project;
    const { blend, opacity } = tag.behaviours.layerDefaults;
    return updateNode(added.project, id, { tagId, name: `${tag.name} ${added.project.nodes.length}`, blend, opacity, locked: tag.behaviours.startLocked });
  });
  if (id !== '') selectRow(id);
}

export function deleteRow(id: string): void {
  const engine = getEngine();
  const before = engine.project;
  engine.edit('DELETE LAYER', (project) => deleteNode(project, id));
  const after = engine.project;
  if (after === before) {
    engine.notify('THE LAST LAYER STAYS');
    return;
  }
  if (findNode(after, useStudio.getState().layerId) === null) {
    const rows = visibleRows(after);
    useStudio.setState({ layerId: rows.find((n) => n.kind === 'layer')?.id ?? firstLayer(after)?.id ?? '' });
  }
}

export function setRow(id: string, change: Partial<LayerNode>, label = 'LAYER'): void {
  getEngine().edit(label, (project) => updateNode(project, id, change));
}

/** A slider's stream of values is not an undo step each. */
export function tweakRow(id: string, change: Partial<LayerNode>): void {
  getEngine().tweak((project) => updateNode(project, id, change));
}

export function toggleRow(id: string, field: 'visible' | 'locked' | 'solo' | 'collapsed'): void {
  const node = findNode(useStudio.getState().project, id);
  if (node !== null) setRow(id, { [field]: !node[field] }, field.toUpperCase());
}

/**
 * A dropped row. `before` is the row it lands above (null: the bottom of the list); `into` is the folder it goes inside (null: the top
 * level), which also says where it lands among that folder's rows.
 */
export function dropRow(id: string, before: string | null, into: string | null): void {
  const engine = getEngine();
  const { project } = useStudio.getState();
  if (into !== null && isInside(project, into, id)) {
    engine.notify('A FOLDER CANNOT GO INSIDE ITSELF', true);
    return;
  }
  engine.edit('MOVE LAYER', (p) => moveNode(p, id, before, into));
}

function stepActive(direction: -1 | 1): void {
  const { project, layerId } = useStudio.getState();
  const rows = visibleRows(project);
  const at = rows.findIndex((n) => n.id === layerId);
  const next = rows[at + direction];
  if (next !== undefined) selectRow(next.id);
}

function activeRow(run: (id: string) => void): void {
  const { layerId } = useStudio.getState();
  if (layerId !== '') run(layerId);
}

/** The tag a row shows, and whether it's only passed down from a folder. */
export function rowTag(id: string): { name: string; colour: string; mark: string; inherited: boolean } | null {
  const { project } = useStudio.getState();
  const node = findNode(project, id);
  if (node === null) return null;
  const tag = tagOf(project, node);
  return tag === null ? null : { name: tag.name, colour: tag.colour, mark: tag.mark, inherited: node.tagId === null };
}

addActions([
  { id: 'layer.new', label: 'NEW LAYER', group: 'LAYERS', key: 'shift+n', run: () => newRow('layer') },
  { id: 'layer.folder', label: 'NEW FOLDER', group: 'LAYERS', key: 'shift+g', run: () => newRow('folder') },
  { id: 'layer.up', label: 'LAYER ABOVE', group: 'LAYERS', key: 'arrowup', run: () => stepActive(-1) },
  { id: 'layer.down', label: 'LAYER BELOW', group: 'LAYERS', key: 'arrowdown', run: () => stepActive(1) },
  { id: 'layer.moveup', label: 'MOVE LAYER UP', group: 'LAYERS', key: 'alt+arrowup', run: () => activeRow((id) => getEngine().edit('MOVE LAYER', (p) => nudgeNode(p, id, -1))) },
  { id: 'layer.movedown', label: 'MOVE LAYER DOWN', group: 'LAYERS', key: 'alt+arrowdown', run: () => activeRow((id) => getEngine().edit('MOVE LAYER', (p) => nudgeNode(p, id, 1))) },
  { id: 'layer.visible', label: 'HIDE / SHOW LAYER', group: 'LAYERS', key: 'v', run: () => activeRow((id) => toggleRow(id, 'visible')) },
  { id: 'layer.lock', label: 'LOCK LAYER', group: 'LAYERS', key: 'alt+l', run: () => activeRow((id) => toggleRow(id, 'locked')) },
  { id: 'layer.solo', label: 'SOLO LAYER', group: 'LAYERS', key: 'alt+s', run: () => activeRow((id) => toggleRow(id, 'solo')) },
  { id: 'layer.delete', label: 'DELETE LAYER', group: 'LAYERS', key: 'alt+delete', run: () => activeRow(deleteRow) },
  { id: 'layer.panel', label: 'SHOW / HIDE THE LAYER LIST', group: 'VIEW', key: 'shift+l', run: () => updateSettings({ showLayers: !useStudio.getState().settings.showLayers }) },
  { id: 'settings.panel', label: 'SETTINGS', group: 'VIEW', key: 'ctrl+,', run: () => useStudio.setState({ panel: useStudio.getState().panel === 'settings' ? 'none' : 'settings' }) },
]);
