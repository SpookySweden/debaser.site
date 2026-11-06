/**
 * Playing the shot. Every distinct frame is built once into a picture first, so playback is exact however heavy the drawing is; held
 * frames share one picture. Then a clock picks which picture is on screen, and a slow machine drops frames rather than slowing the time.
 */
import { composite, frameSignature } from './composite';
import { frameAtTick, playRange } from './project';
import { planeKey } from './planes';
import { useStudio } from './store';
import type { AnimateEngine } from './engine';
import type { PlaneName, Project } from './types';

/** How much memory playback's pictures may take, in bytes, before they are made smaller. */
const CACHE_BYTES = 900 * 1024 * 1024;

type Cache = { project: Project; pictures: Map<string, ImageBitmap>; scale: number; layerId: string; lightTable: boolean };

let cache: Cache | null = null;
let running = 0;
/** The sound follows the picture: started, restarted where the picture jumps, and stopped. */
export const clockHooks: { start: (frame: number) => void; stop: () => void } = {
  start: () => undefined,
  stop: () => undefined,
};

function dropCache(): void {
  if (cache !== null) for (const picture of cache.pictures.values()) picture.close();
  cache = null;
}

let dropTimer: ReturnType<typeof setTimeout> | null = null;
let hooked = false;

/** Playback's pictures are kept a minute after stopping, for a quick replay, and no longer: they can be most of a gigabyte. */
function dropCacheSoon(): void {
  if (dropTimer !== null) clearTimeout(dropTimer);
  dropTimer = setTimeout(dropCache, 60_000);
}

/** Every plane a frame shows, ready to draw. */
export async function loadFramePlanes(engine: AnimateEngine, project: Project, frame: number): Promise<void> {
  const signature = frameSignature(project, frame);
  if (signature === '') return;
  for (const drawingId of signature.split(',')) {
    for (const plane of ['colour', 'line'] as PlaneName[]) {
      const key = planeKey(drawingId, plane);
      if (engine.planes.peek(key) === null && (project.drawings[drawingId]?.planes[plane].length ?? 0) > 0) await engine.planes.load(key);
    }
  }
}

async function prepare(engine: AnimateEngine, token: number): Promise<boolean> {
  const state = useStudio.getState();
  const { project } = state;
  if (cache !== null && cache.project === project && cache.layerId === state.layerId && cache.lightTable === state.lightTable) return true;
  dropCache();
  const { start, end } = playRange(project);
  const distinct = new Set<string>();
  for (let f = start; f <= end; f += 1) distinct.add(frameSignature(project, f));
  const scale = Math.min(1, Math.sqrt(CACHE_BYTES / Math.max(1, distinct.size * project.width * project.height * 4)));
  const w = Math.max(1, Math.round(project.width * scale));
  const h = Math.max(1, Math.round(project.height * scale));
  const pictures = new Map<string, ImageBitmap>();
  let done = 0;
  const started = performance.now();
  for (let f = start; f <= end; f += 1) {
    if (running !== token) {
      for (const picture of pictures.values()) picture.close();
      return false;
    }
    const signature = frameSignature(project, f);
    if (pictures.has(signature)) continue;
    await loadFramePlanes(engine, project, f);
    const sheet = new OffscreenCanvas(w, h);
    const ctx = sheet.getContext('2d');
    if (ctx === null) {
      for (const picture of pictures.values()) picture.close();
      return false;
    }
    ctx.scale(scale, scale);
    composite(ctx, {
      project,
      frame: f,
      planes: (key) => engine.planes.peek(key),
      activeLayerId: state.layerId,
      showOnion: false,
      lightTable: state.lightTable,
    });
    pictures.set(signature, await createImageBitmap(sheet));
    done += 1;
    // A short shot just starts; a long one says how far along it is.
    if (performance.now() - started > 150) useStudio.setState({ readying: done / distinct.size });
  }
  cache = { project, pictures, scale, layerId: state.layerId, lightTable: state.lightTable };
  useStudio.setState({ readying: null });
  return true;
}

export function stopPlaying(engine: AnimateEngine): void {
  running += 1;
  clockHooks.stop();
  engine.playbackPicture = null;
  useStudio.setState({ playing: false, readying: null });
  engine.invalidate();
  dropCacheSoon();
}

export async function startPlaying(engine: AnimateEngine): Promise<void> {
  if (useStudio.getState().playing || engine.live !== null) return;
  if (!hooked) {
    hooked = true;
    engine.onProjectSwap.push(() => {
      if (useStudio.getState().playing) stopPlaying(engine);
      dropCache();
    });
  }
  if (dropTimer !== null) clearTimeout(dropTimer);
  running += 1;
  const token = running;
  useStudio.setState({ playing: true });
  const ready = await prepare(engine, token);
  if (!ready || running !== token || cache === null) return;

  const { project } = useStudio.getState();
  const { start, end } = playRange(project);
  const here = useStudio.getState().frame;
  const from = here >= start && here <= end ? here : start;
  const pictures = cache.pictures;
  const began = performance.now();
  const offset = from - start;
  clockHooks.start(from);
  let shown = from;
  let forwards = true;

  const step = () => {
    if (running !== token) return;
    const seconds = (performance.now() - began) / 1000;
    const tick = Math.floor(seconds * project.fps) + offset;
    const frame = frameAtTick(tick, start, end, project.playMode);
    if (frame === null) {
      useStudio.setState({ frame: end });
      stopPlaying(engine);
      return;
    }
    if (frame !== shown) {
      const goingForwards = frame > shown;
      // A loop jumps back and starts its sound again. Ping-pong plays its sound only on the way forward: sound doesn't run backwards.
      if (project.playMode === 'loop' && !goingForwards) clockHooks.start(frame);
      if (project.playMode === 'pingpong' && goingForwards !== forwards) {
        if (goingForwards) clockHooks.start(frame);
        else clockHooks.stop();
      }
      forwards = goingForwards;
      shown = frame;
    }
    if (frame !== useStudio.getState().frame) useStudio.setState({ frame });
    const picture = pictures.get(frameSignature(project, frame)) ?? null;
    if (picture !== engine.playbackPicture) {
      engine.playbackPicture = picture;
      engine.paintBelow();
    }
    requestAnimationFrame(step);
  };
  step();
}

export function togglePlaying(engine: AnimateEngine): void {
  if (useStudio.getState().playing) stopPlaying(engine);
  else void startPlaying(engine);
}
