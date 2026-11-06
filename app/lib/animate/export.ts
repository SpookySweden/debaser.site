/**
 * Exports: what the shot looks like, at a chosen size and range. `render` leaves out Skip-on-export layers, onions and dims.
 * All of this happens in the browser; nothing is uploaded.
 */
import { composite, frameSignature } from './composite';
import { getEngine, type AnimateEngine } from './engine';
import { loadFramePlanes } from './playback';
import { playRange } from './project';
import { safeFileName, saveBlobAs } from './project-file';
import { ensureSound } from './sound';
import { useStudio } from './store';
import type { Project } from './types';
import { startWorker } from './workers';
import { zipParts, type ZipEntry } from './zip';

export type ExportSettings = {
  /** 1 is full size. */
  scale: number;
  /** The in/out range, if set, rather than the whole shot. */
  rangeOnly: boolean;
  /** Keep the paper out of a PNG. */
  transparent: boolean;
  /** Stops an export: read between frames. */
  cancelled?: () => boolean;
  onProgress?: (done: number, total: number) => void;
};

export function exportSpan(project: Project, rangeOnly: boolean): { start: number; end: number } {
  if (rangeOnly) return playRange(project);
  return { start: 0, end: Math.max(0, project.frames - 1) };
}

export function exportSize(project: Project, scale: number, even = false): { w: number; h: number } {
  let w = Math.max(1, Math.round(project.width * scale));
  let h = Math.max(1, Math.round(project.height * scale));
  if (even) {
    // Video encoders want even sizes.
    w += w % 2;
    h += h % 2;
  }
  return { w, h };
}

/**
 * How long a GIF shows each picture, in milliseconds. A GIF counts in hundredths of a second, so at 24 fps a frame can't be exactly its
 * length; the running total is what's kept true, so the whole shot still takes the right time.
 */
export function gifDelays(frameCounts: number[], fps: number): number[] {
  const out: number[] = [];
  let sum = 0;
  let shown = 0;
  for (const count of frameCounts) {
    sum += count;
    const until = Math.round((sum * 100) / fps);
    out.push(Math.max(2, until - shown) * 10);
    shown = until;
  }
  return out;
}

/** The finished look of one frame. */
export async function renderFrame(engine: AnimateEngine, project: Project, frame: number, settings: Pick<ExportSettings, 'scale' | 'transparent'>, even = false): Promise<OffscreenCanvas> {
  await loadFramePlanes(engine, project, frame);
  const { w, h } = exportSize(project, settings.scale, even);
  const sheet = new OffscreenCanvas(w, h);
  const ctx = sheet.getContext('2d', { willReadFrequently: true });
  if (ctx === null) throw new Error('no 2d context');
  ctx.scale(w / project.width, h / project.height);
  if (!settings.transparent) {
    ctx.fillStyle = project.background;
    ctx.fillRect(0, 0, project.width, project.height);
  }
  composite(ctx, { project, frame, planes: (key) => engine.planes.peek(key), exporting: true });
  return sheet;
}

/** Frames that look the same, joined: [{ frame, count }] in order. */
export function runsOf(project: Project, start: number, end: number): { frame: number; count: number }[] {
  const runs: { frame: number; count: number; signature: string }[] = [];
  for (let f = start; f <= end; f += 1) {
    const signature = frameSignature(project, f, true);
    const last = runs[runs.length - 1];
    if (last !== undefined && last.signature === signature) last.count += 1;
    else runs.push({ frame: f, count: 1, signature });
  }
  return runs.map(({ frame, count }) => ({ frame, count }));
}

export async function exportGif(settings: ExportSettings): Promise<Blob | null> {
  const engine = getEngine();
  const { project } = useStudio.getState();
  const { start, end } = exportSpan(project, settings.rangeOnly);
  const runs = runsOf(project, start, end);
  const delays = gifDelays(runs.map((run) => run.count), project.fps);
  const worker = startWorker('export');
  if (worker === null) throw new Error('no worker');
  const { w, h } = exportSize(project, settings.scale);

  const answer = (wanted: string): Promise<{ type: string; bytes?: Uint8Array; error?: string }> =>
    new Promise((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<{ type: string; bytes?: Uint8Array; error?: string }>) => {
        if (event.data.type === 'error') reject(new Error(event.data.error));
        else if (event.data.type === wanted) resolve(event.data);
      };
    });

  try {
    let reply = answer('ready');
    worker.postMessage({ type: 'begin', width: w, height: h });
    await reply;
    for (let i = 0; i < runs.length; i += 1) {
      if (settings.cancelled?.() === true) return null;
      const sheet = await renderFrame(engine, project, runs[i].frame, { scale: settings.scale, transparent: false });
      const pixels = sheet.getContext('2d')?.getImageData(0, 0, w, h).data.buffer;
      if (pixels === undefined) return null;
      reply = answer('wrote');
      worker.postMessage({ type: 'frame', pixels, delay: delays[i] }, [pixels]);
      await reply;
      settings.onProgress?.(i + 1, runs.length);
    }
    reply = answer('done');
    worker.postMessage({ type: 'finish' });
    const { bytes } = await reply;
    return bytes === undefined ? null : new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/gif' });
  } finally {
    worker.terminate();
  }
}

export async function exportPngSequence(settings: ExportSettings): Promise<Blob | null> {
  const engine = getEngine();
  const { project } = useStudio.getState();
  const { start, end } = exportSpan(project, settings.rangeOnly);
  const entries: ZipEntry[] = [];
  const total = end - start + 1;
  const base = safeFileName(project.name).replace(/\s+/g, '_');
  const reuse = new Map<string, Uint8Array>();
  for (let f = start; f <= end; f += 1) {
    if (settings.cancelled?.() === true) return null;
    const signature = frameSignature(project, f, true);
    let bytes = reuse.get(signature);
    if (bytes === undefined) {
      const sheet = await renderFrame(engine, project, f, settings);
      const blob = await sheet.convertToBlob({ type: 'image/png' });
      bytes = new Uint8Array(await blob.arrayBuffer());
      reuse.set(signature, bytes);
    }
    entries.push({ name: `${base}_${String(f - start + 1).padStart(4, '0')}.png`, bytes });
    settings.onProgress?.(f - start + 1, total);
  }
  return new Blob(zipParts(entries), { type: 'application/zip' });
}

/**
 * A video, through Mediabunny and the browser's own encoders (WebCodecs). MP4 for sharing, WebM as an open alternative. The sound goes in too, placed where
 * it sits on the timeline. Loaded only when asked for, since it's the biggest thing the studio uses.
 */
export async function exportVideo(settings: ExportSettings, kind: 'mp4' | 'webm'): Promise<{ blob: Blob | null; silent: boolean }> {
  const { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource, AudioBufferSource, QUALITY_HIGH, getFirstEncodableVideoCodec, getFirstEncodableAudioCodec } = await import('mediabunny');
  const engine = getEngine();
  const { project } = useStudio.getState();
  const { start, end } = exportSpan(project, settings.rangeOnly);
  const { w, h } = exportSize(project, settings.scale, true);

  const videoCodec = await getFirstEncodableVideoCodec(kind === 'mp4' ? ['avc', 'hevc', 'av1'] : ['vp9', 'av1', 'vp8'], { width: w, height: h });
  if (videoCodec === null) throw new Error(`no ${kind} encoder in this browser`);

  const output = new Output({ format: kind === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat(), target: new BufferTarget() });
  const sheet = new OffscreenCanvas(w, h);
  const sheetCtx = sheet.getContext('2d');
  if (sheetCtx === null) throw new Error('no 2d context');
  const video = new CanvasSource(sheet, { codec: videoCodec, bitrate: QUALITY_HIGH });
  output.addVideoTrack(video, { frameRate: project.fps });

  let audioSource: InstanceType<typeof AudioBufferSource> | null = null;
  let silent = false;
  const track = project.audio;
  const buffer = track === null ? null : await ensureSound(project.id, track);
  // A sound that can't be read means a video that says it has none, not one that quietly doesn't.
  if (track !== null && buffer === null) silent = true;
  if (track !== null && buffer !== null) {
    const audioCodec = await getFirstEncodableAudioCodec(kind === 'mp4' ? ['aac', 'opus'] : ['opus', 'vorbis'], { numberOfChannels: 2, sampleRate: 48000 });
    if (audioCodec === null) {
      silent = true;
    } else {
      audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_HIGH });
      output.addAudioTrack(audioSource);
    }
  }

  await output.start();
  try {
    let lastSignature: string | null = null;
    const total = end - start + 1;
    for (let f = start; f <= end; f += 1) {
      if (settings.cancelled?.() === true) {
        await output.cancel();
        return { blob: null, silent };
      }
      const signature = frameSignature(project, f, true);
      if (signature !== lastSignature) {
        const rendered = await renderFrame(engine, project, f, { scale: settings.scale, transparent: false }, true);
        sheetCtx.drawImage(rendered, 0, 0);
        lastSignature = signature;
      }
      await video.add((f - start) / project.fps, 1 / project.fps);
      settings.onProgress?.(f - start + 1, total);
    }
    if (audioSource !== null && track !== null && buffer !== null) {
      // The sound as the shot hears it: placed on its frame, at its volume, cut to the length of the shot.
      const seconds = total / project.fps;
      const mix = new OfflineAudioContext(2, Math.ceil(seconds * 48000), 48000);
      const node = mix.createBufferSource();
      node.buffer = buffer;
      const gain = mix.createGain();
      gain.gain.value = track.volume;
      node.connect(gain).connect(mix.destination);
      const offset = (track.frame - start) / project.fps;
      node.start(Math.max(0, offset), Math.max(0, -offset));
      await audioSource.add(await mix.startRendering());
    }
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => undefined);
    throw error;
  }
  const bytes = output.target.buffer;
  return { blob: bytes === null ? null : new Blob([bytes], { type: kind === 'mp4' ? 'video/mp4' : 'video/webm' }), silent };
}

export type ExportKind = 'gif' | 'png' | 'mp4' | 'webm';

let stopRequested = false;

export function stopExport(): void {
  stopRequested = true;
}

/**
 * One export at a time, whatever the panel does: it can be closed and opened while this runs, and STOP still works. Leaving the project stops it. The pen
 * waits, because an export reads the same pictures.
 */
export async function startExport(kind: ExportKind, options: Pick<ExportSettings, 'scale' | 'rangeOnly' | 'transparent'>): Promise<void> {
  const state = useStudio.getState();
  if (state.exportProgress !== null) return;
  const engine = getEngine();
  const projectId = state.project.id;
  stopRequested = false;
  useStudio.setState({ exportProgress: 'STARTING...' });
  const label = kind.toUpperCase();
  const settings: ExportSettings = {
    ...options,
    cancelled: () => stopRequested || engine.project.id !== projectId,
    onProgress: (done, total) => useStudio.setState({ exportProgress: `${label} ${done} / ${total}` }),
  };
  const save = (blob: Blob, extension: string, description: string) => saveBlobAs(blob, `${safeFileName(useStudio.getState().project.name)}${extension}`, description, [extension]);
  try {
    let blob: Blob | null;
    let silent = false;
    if (kind === 'gif') blob = await exportGif(settings);
    else if (kind === 'png') blob = await exportPngSequence(settings);
    else ({ blob, silent } = await exportVideo(settings, kind));
    if (blob === null) {
      engine.notify('EXPORT STOPPED');
    } else {
      const saved = await save(blob, kind === 'png' ? '.png-frames.zip' : `.${kind}`, kind === 'png' ? 'PNG frames' : label);
      if (!saved) engine.notify('NOT SAVED');
      else if (silent) engine.notify('EXPORTED WITH NO SOUND: THIS BROWSER COULD NOT MAKE IT', true);
      else engine.notify('EXPORTED');
    }
  } catch {
    engine.notify(kind === 'mp4' || kind === 'webm' ? `THIS BROWSER CANNOT MAKE ${label}` : 'THE EXPORT FAILED', true);
  }
  useStudio.setState({ exportProgress: null });
  engine.onIdle?.();
}
