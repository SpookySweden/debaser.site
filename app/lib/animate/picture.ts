/**
 * Imported pictures, for the Reference tag: a picture to trace over, on a layer of its own that renders leave out. The file stays in this browser and
 * in project files.
 */
import { addActions } from './actions';
import { getEngine } from './engine';
import { copyRect } from './history';
import { selectRow } from './layers';
import { planeKey } from './planes';
import { addDrawing, addNode, addOp, updateNode } from './project';
import { newAssetId } from './sound';
import { readFile, writeFile } from './storage';
import { useStudio } from './store';
import type { ImageOp, PlaneOp, Project } from './types';

const bitmaps = new Map<string, ImageBitmap>();

async function loadAssets(project: Project): Promise<void> {
  const images = Object.values(project.drawings).flatMap((drawing) => [...drawing.planes.line, ...drawing.planes.colour]).filter((op: PlaneOp): op is ImageOp => op.kind === 'image');
  for (const op of images) {
    if (bitmaps.has(op.assetId)) continue;
    const blob = await readFile(project.id, `assets/${op.assetId}`);
    if (blob !== null) bitmaps.set(op.assetId, await createImageBitmap(blob));
  }
}

/** A picture becomes a new Reference layer, held for the rest of the shot from this frame, fitted to the sheet. */
export async function importPicture(file: File): Promise<void> {
  const engine = getEngine();
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    engine.notify('THIS BROWSER CANNOT READ THAT PICTURE', true);
    return;
  }
  const swap = engine.swapCount;
  const projectId = engine.project.id;
  const assetId = newAssetId();
  await writeFile(projectId, `assets/${assetId}`, file);
  bitmaps.set(assetId, bitmap);
  // Only now is the project read: a stroke made while the file was being stored has to stay.
  if (engine.swapCount !== swap) return;
  if (engine.isBusy()) {
    engine.notify('ONE MOMENT', true);
    return;
  }
  const state = useStudio.getState();
  const before = state.project;
  const { frame } = state;

  const reference = before.tags.find((tag) => tag.id === 'reference');
  const added = addNode(before, 'layer', state.layerId, `PICTURE ${before.nodes.length + 1}`);
  const tagged = updateNode(added.project, added.id, { tagId: reference?.id ?? null, locked: reference?.behaviours.startLocked ?? false });
  const made = addDrawing(tagged, added.id, frame, Math.max(1, tagged.frames - frame));

  const fit = Math.min(before.width / bitmap.width, before.height / bitmap.height);
  const width = bitmap.width * fit;
  const height = bitmap.height * fit;
  const op: ImageOp = { kind: 'image', id: `i_${assetId}`, plane: 'line', assetId, x: (before.width - width) / 2, y: (before.height - height) / 2, width, height };

  const key = planeKey(made.cel.drawingId, 'line');
  const canvas = engine.planes.openNow(key);
  if (canvas === null) return;
  const rect = { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const copy = copyRect(canvas, rect);
  canvas.getContext('2d')?.drawImage(bitmap, op.x, op.y, op.width, op.height);
  engine.planes.markDirty(key);
  engine.pushStep('IMPORT PICTURE', before, addOp(made.project, made.cel.drawingId, 'line', op), [{ key, rect, before: copy, after: copyRect(canvas, rect) }]);
  selectRow(added.id);
  engine.notify('PICTURE ADDED ON A REFERENCE LAYER');
}

let installed = false;

/** Tell the engine about pictures: called once when the studio opens. */
export function installPictures(): void {
  if (installed) return;
  installed = true;
  const engine = getEngine();
  engine.opPainters.image = (ctx, op) => {
    if (op.kind !== 'image') return;
    const bitmap = bitmaps.get(op.assetId);
    if (bitmap !== undefined) ctx.drawImage(bitmap, op.x, op.y, op.width, op.height);
  };
  engine.onProjectSwap.push(() => {
    void loadAssets(useStudio.getState().project);
  });
  void loadAssets(useStudio.getState().project);
}

addActions([{ id: 'picture.import', label: 'IMPORT A PICTURE', group: 'FILE', key: 'ctrl+i', run: () => document.getElementById('animate-import-picture')?.click() }]);
