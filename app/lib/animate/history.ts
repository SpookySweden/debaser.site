/**
 * Undo and redo. One step is the project before and after, and the part of each picture it changed. A project is immutable, so keeping an
 * old one costs only what changed; a picture patch is a small canvas copy, so nothing has to be read back from the graphics card.
 */
import type { Rect } from './brushes';
import type { Project } from './types';

export type PlanePatch = {
  key: string;
  rect: Rect;
  before: OffscreenCanvas;
  after: OffscreenCanvas;
};

export type HistoryStep = {
  label: string;
  before: Project;
  after: Project;
  patches: PlanePatch[];
  frame: number;
  layerId: string;
};

const MAX_STEPS = 200;
/** Picture patches kept for undo, in bytes. Past this the oldest steps go. */
const MAX_BYTES = 400 * 1024 * 1024;

function stepBytes(step: HistoryStep): number {
  return step.patches.reduce((sum, patch) => sum + patch.rect.w * patch.rect.h * 8, 0);
}

export class History {
  private undone: HistoryStep[] = [];
  private done: HistoryStep[] = [];
  private bytes = 0;

  push(step: HistoryStep): void {
    this.done.push(step);
    this.bytes += stepBytes(step);
    for (const gone of this.undone) this.bytes -= stepBytes(gone);
    this.undone = [];
    while (this.done.length > 1 && (this.done.length > MAX_STEPS || this.bytes > MAX_BYTES)) {
      const oldest = this.done.shift();
      if (oldest !== undefined) this.bytes -= stepBytes(oldest);
    }
  }

  takeUndo(): HistoryStep | null {
    const step = this.done.pop() ?? null;
    if (step !== null) this.undone.push(step);
    return step;
  }

  takeRedo(): HistoryStep | null {
    const step = this.undone.pop() ?? null;
    if (step !== null) this.done.push(step);
    return step;
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  clear(): void {
    this.done = [];
    this.undone = [];
    this.bytes = 0;
  }
}

/** A copy of part of a picture. */
export function copyRect(source: OffscreenCanvas | null, rect: Rect): OffscreenCanvas {
  const out = new OffscreenCanvas(rect.w, rect.h);
  if (source !== null) out.getContext('2d')?.drawImage(source, -rect.x, -rect.y);
  return out;
}

/** Put a patch back: that part of the picture becomes exactly what the patch holds. */
export function restoreRect(target: OffscreenCanvas, rect: Rect, patch: OffscreenCanvas): void {
  const ctx = target.getContext('2d');
  if (ctx === null) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
  ctx.drawImage(patch, rect.x, rect.y);
  ctx.restore();
}
