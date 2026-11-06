/**
 * The audio track. The file stays in this browser and in project files. It plays in step with the picture, and stepping a frame plays that frame's
 * slice of sound, for lip sync. Nothing here ever goes to the site.
 */
import { addActions } from './actions';
import { getEngine } from './engine';
import { clockHooks } from './playback';
import { readFile, writeFile } from './storage';
import { useStudio } from './store';
import type { AudioTrack, Project } from './types';

const SCRUB_SECONDS = 0.09;

const decoded = new Map<string, AudioBuffer>();
const peakCache = new Map<string, Float32Array>();
let context: AudioContext | null = null;
let playing: AudioBufferSourceNode | null = null;
let scrubbing: AudioBufferSourceNode | null = null;

function audio(): AudioContext {
  if (context === null) context = new AudioContext();
  // A browser keeps sound asleep until a person has pressed something; by now they have.
  if (context.state === 'suspended') void context.resume();
  return context;
}

export function soundBuffer(track: AudioTrack | null): AudioBuffer | null {
  return track === null ? null : (decoded.get(track.assetId) ?? null);
}

/** An asset's name, unique for good, so two projects (or an undo and a new file) can never share one. */
export function newAssetId(): string {
  return `a_${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
}

/** The sound decoded, however long that takes: an export waits for it rather than leaving it out. */
export function ensureSound(projectId: string, track: AudioTrack): Promise<AudioBuffer | null> {
  return decode(projectId, track.assetId);
}

async function decode(projectId: string, assetId: string): Promise<AudioBuffer | null> {
  const known = decoded.get(assetId);
  if (known !== undefined) return known;
  const blob = await readFile(projectId, `assets/${assetId}`);
  if (blob === null) return null;
  try {
    const buffer = await audio().decodeAudioData(await blob.arrayBuffer());
    decoded.set(assetId, buffer);
    useStudio.setState({ soundReady: useStudio.getState().soundReady + 1 });
    return buffer;
  } catch {
    return null;
  }
}

/** A sound file added to the project: it replaces any sound already there, as one undo step. */
export async function loadSound(file: File): Promise<void> {
  const engine = getEngine();
  const { project } = engine;
  const swap = engine.swapCount;
  const assetId = newAssetId();
  try {
    const buffer = await audio().decodeAudioData(await file.arrayBuffer());
    decoded.set(assetId, buffer);
  } catch {
    engine.notify('THIS BROWSER CANNOT READ THAT SOUND FILE', true);
    return;
  }
  await writeFile(project.id, `assets/${assetId}`, file);
  // The person may have moved to another project while the file was read.
  if (engine.swapCount !== swap) return;
  engine.edit('SOUND', (p) => ({ ...p, audio: { assetId, name: file.name.slice(0, 60), frame: 0, volume: 1 } }));
  useStudio.setState({ soundReady: useStudio.getState().soundReady + 1 });
  engine.notify('SOUND ADDED');
}

export function changeSound(change: Partial<AudioTrack>): void {
  getEngine().tweak((project) => (project.audio === null ? project : { ...project, audio: { ...project.audio, ...change } }));
}

export function removeSound(): void {
  getEngine().edit('REMOVE SOUND', (project) => ({ ...project, audio: null }));
  stopSound();
}

/** The loudest moment of each frame, 0 to 1, for the picture of the sound on the timeline. */
export function soundPeaks(track: AudioTrack, fps: number): Float32Array | null {
  const buffer = decoded.get(track.assetId);
  if (buffer === undefined) return null;
  const key = `${track.assetId}@${fps}`;
  const cached = peakCache.get(key);
  if (cached !== undefined) return cached;
  const count = Math.ceil(buffer.duration * fps);
  const peaks = new Float32Array(count);
  const data = buffer.getChannelData(0);
  const perFrame = buffer.sampleRate / fps;
  // Every sample isn't needed to see the shape, and a long song has millions.
  const stride = Math.max(1, Math.floor(perFrame / 400));
  for (let f = 0; f < count; f += 1) {
    const from = Math.floor(f * perFrame);
    const to = Math.min(data.length, Math.floor((f + 1) * perFrame));
    let peak = 0;
    for (let i = from; i < to; i += stride) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
    peaks[f] = peak;
  }
  peakCache.set(key, peaks);
  return peaks;
}

function playFrom(project: Project, track: AudioTrack, buffer: AudioBuffer, frame: number, duration?: number): AudioBufferSourceNode | null {
  const offset = (frame - track.frame) / project.fps;
  if (offset >= buffer.duration) return null;
  const ctx = audio();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = track.volume;
  source.connect(gain).connect(ctx.destination);
  const wait = Math.max(0, -offset);
  source.start(ctx.currentTime + wait, Math.max(0, offset), duration);
  return source;
}

function stopNode(node: AudioBufferSourceNode | null): void {
  if (node === null) return;
  try {
    node.stop();
    node.disconnect();
  } catch {
    // Already finished.
  }
}

export function stopSound(): void {
  stopNode(playing);
  playing = null;
  stopNode(scrubbing);
  scrubbing = null;
}

let installed = false;

/** Tell playback about sound: called once when the studio opens. */
export function installSound(): void {
  if (installed) return;
  installed = true;
  const engine = getEngine();

  clockHooks.start = (frame) => {
    stopSound();
    const { project } = useStudio.getState();
    const buffer = soundBuffer(project.audio);
    if (project.audio !== null && buffer !== null) playing = playFrom(project, project.audio, buffer, frame);
  };
  clockHooks.stop = stopSound;

  const loadForProject = (project: Project) => {
    if (project.audio !== null) void decode(project.id, project.audio.assetId);
  };
  engine.onProjectSwap.push(() => {
    stopSound();
    loadForProject(useStudio.getState().project);
  });
  loadForProject(useStudio.getState().project);

  useStudio.subscribe((state, previous) => {
    if (state.project.audio !== previous.project.audio) {
      // Removed, undone or swapped for another: what's playing was the old one.
      if (state.project.audio?.assetId !== previous.project.audio?.assetId) stopSound();
      if (state.project.audio !== null) loadForProject(state.project);
    }
    // Stepping through frames plays each one's slice: this is what lip sync is timed by.
    if (state.frame === previous.frame || state.playing || !state.settings.scrubSound || state.project.audio === null) return;
    const buffer = soundBuffer(state.project.audio);
    if (buffer === null) return;
    stopNode(scrubbing);
    scrubbing = playFrom(state.project, state.project.audio, buffer, state.frame, Math.max(SCRUB_SECONDS, 1 / state.project.fps));
  });
}

addActions([{ id: 'sound.panel', label: 'SOUND', group: 'TIMELINE', key: 'shift+a', run: () => useStudio.setState({ panel: useStudio.getState().panel === 'sound' ? 'none' : 'sound' }) }]);
