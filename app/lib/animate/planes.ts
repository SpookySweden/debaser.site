/**
 * The pictures: one canvas per drawing's plane, held live only while needed. A 1920x1080 plane is about 8 MB, so a few dozen stay live and
 * the rest wait in storage as PNGs; a plane nobody has drawn on has no canvas at all.
 */
import { readFile, writePlanePicture } from './storage';
import type { PlaneName } from './types';

/** About half a gigabyte of pictures at 1920x1080. */
const MAX_LIVE_BYTES = 560 * 1024 * 1024;

export function planeKey(drawingId: string, plane: PlaneName): string {
  return `${drawingId}.${plane}`;
}

export function planeFile(key: string): string {
  return `${key}.png`;
}

export class PlaneStore {
  private live = new Map<string, OffscreenCanvas>();
  private loading = new Map<string, Promise<OffscreenCanvas | null>>();
  private versions = new Map<string, number>();
  private dirty = new Set<string>();
  private bytesEach: number;

  constructor(
    private projectId: string,
    public readonly width: number,
    public readonly height: number,
    /** Told when a plane has arrived from storage, so the page can be drawn again. */
    private onLoaded: () => void,
    /** Does this plane have anything stored? Without this every empty frame would ask storage. */
    private isStored: (key: string) => boolean,
    /** Build a plane from its operations when its stored picture is missing. */
    private rebuild: (key: string, canvas: OffscreenCanvas) => Promise<boolean>,
  ) {
    this.bytesEach = width * height * 4;
  }

  version(key: string): number {
    return this.versions.get(key) ?? 0;
  }

  bump(key: string): void {
    this.versions.set(key, this.version(key) + 1);
  }

  /** The live canvas, or null: not live right now, or nothing there. Starts a load when something is stored. */
  peek(key: string): OffscreenCanvas | null {
    const found = this.live.get(key);
    if (found !== undefined) {
      // Most recently used goes last.
      this.live.delete(key);
      this.live.set(key, found);
      return found;
    }
    if (this.isStored(key)) void this.load(key);
    return null;
  }

  /** The canvas to draw on, blank if nothing is there: waits for storage if it must. */
  async open(key: string): Promise<OffscreenCanvas> {
    const loaded = this.live.get(key) ?? (this.isStored(key) ? await this.load(key) : null);
    return loaded ?? this.createBlank(key);
  }

  /** The canvas right now if it can be had without waiting, for a stroke that must land at once. */
  openNow(key: string): OffscreenCanvas | null {
    const found = this.live.get(key);
    if (found !== undefined) return found;
    if (this.isStored(key)) return null;
    return this.createBlank(key);
  }

  private createBlank(key: string): OffscreenCanvas {
    const canvas = new OffscreenCanvas(this.width, this.height);
    this.put(key, canvas);
    return canvas;
  }

  private put(key: string, canvas: OffscreenCanvas): void {
    this.live.set(key, canvas);
    this.evict();
  }

  private evict(): void {
    if (this.live.size * this.bytesEach <= MAX_LIVE_BYTES) return;
    for (const key of this.live.keys()) {
      if (this.live.size * this.bytesEach <= MAX_LIVE_BYTES) return;
      // Only a picture already safe in storage can go. A dirty one waits for the next save.
      if (!this.dirty.has(key)) this.live.delete(key);
    }
  }

  load(key: string): Promise<OffscreenCanvas | null> {
    const existing = this.loading.get(key);
    if (existing !== undefined) return existing;
    const job = (async () => {
      const canvas = new OffscreenCanvas(this.width, this.height);
      const blob = await readFile(this.projectId, planeFile(key));
      let filled = false;
      if (blob !== null) {
        try {
          const bitmap = await createImageBitmap(blob);
          canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
          bitmap.close();
          filled = true;
        } catch {
          filled = false;
        }
      }
      if (!filled) {
        filled = await this.rebuild(key, canvas);
        if (filled) this.dirty.add(key);
      }
      // A stroke may have opened this plane while the load ran; that one wins.
      if (this.live.has(key)) return this.live.get(key) ?? null;
      this.put(key, canvas);
      this.onLoaded();
      return canvas;
    })().finally(() => this.loading.delete(key));
    this.loading.set(key, job);
    return job;
  }

  markDirty(key: string): void {
    this.dirty.add(key);
    this.bump(key);
  }

  hasDirty(): boolean {
    return this.dirty.size > 0;
  }

  isDirty(key: string): boolean {
    return this.dirty.has(key);
  }

  /** Every changed picture to storage. A picture changed again while it was being written stays dirty. */
  async flush(): Promise<boolean> {
    let ok = true;
    for (const key of [...this.dirty]) {
      const canvas = this.live.get(key);
      if (canvas === undefined) {
        this.dirty.delete(key);
        continue;
      }
      const before = this.version(key);
      const wrote = await writePlanePicture(this.projectId, planeFile(key), canvas);
      if (!wrote) ok = false;
      else if (this.version(key) === before) this.dirty.delete(key);
    }
    this.evict();
    return ok;
  }

  /** Put a picture straight into the store, from a project file. */
  adopt(key: string, canvas: OffscreenCanvas): void {
    this.put(key, canvas);
    this.bump(key);
  }
}
