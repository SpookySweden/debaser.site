'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  GRAPH_FPS,
  RELAY_DRIFT_SECONDS,
  SEGMENT,
  SEGMENT_GAP,
  BAR,
  GAP,
  bandEdges,
  bandLevel,
  barCount,
  colourFor,
  gentleLevel,
  graphPalette,
  litSegments,
  pickSource,
  relayPath,
  settle,
  youtubeIdFromPlayer,
  type GraphColour,
  type GraphSource,
} from '../lib/audio/sound-graph';
import { askToHearTab, subscribeToTabListen, tabListenServerState, tabListenState, tabSound } from '../lib/audio/tab-listen';
import { PLATE_ON_BLACK } from '../lib/ui/controls';
import { floatingClock, floatingState, subscribeToFloating, subscribeToFloatingClock } from '../lib/ui/floating-player';
import { soundTrack, tapSound } from '../lib/watch/audio-tap';
import { useMusicPlayer } from './MusicPlayerProvider';

/**
 * The sound graph: one small canvas behind the words on the music bar's black display (Luke, 2026-11-16). The rules it
 * draws by (colours, how see-through each may be so every word stays 4.5:1, the bars, which sound it listens to) are in
 * `app/lib/audio/sound-graph.ts`; this is the listening and the drawing.
 *
 * It hears, in order: the whole tab when the reader allowed it (`[ HEAR ]`, `app/lib/audio/tab-listen.ts`); the bar's own
 * song through the copy the visualiser already uses (`app/lib/watch/audio-tap.ts`); a YouTube video through the site's
 * relay of its sound (`app/lib/audio/youtube-relay.ts`), kept in step with YouTube's own player and never played aloud;
 * otherwise a slow even swell while something plays, which is not the sound and does not look like it. Nothing plays,
 * the tab is hidden, or the reader asked for less motion: nothing is drawn and the loop stops.
 *
 * Nothing is recorded, kept or sent: each frame's sound is measured and forgotten.
 */

const FRAME_MS = 1000 / GRAPH_FPS;
/** The analyser's size: 128 bins, plenty for a strip a few dozen bars wide. */
const FFT = 256;

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const query = window.matchMedia('(prefers-reduced-motion: reduce)');
      query.addEventListener('change', listener);
      return () => query.removeEventListener('change', listener);
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => true,
  );
}

function usePageHidden(): boolean {
  return useSyncExternalStore(
    (listener) => {
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
    () => document.hidden,
    () => true,
  );
}

/** The theme's colours as the page has them now, by job. */
function readPalette(): GraphColour[] {
  const style = getComputedStyle(document.documentElement);
  return graphPalette((job) => style.getPropertyValue(`--color-${job}`));
}

export default function SoundGraph() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const player = useMusicPlayer();
  const entry = useSyncExternalStore(subscribeToFloating, floatingState, () => null)?.entry ?? null;
  const clock = useSyncExternalStore(subscribeToFloatingClock, floatingClock, () => null);
  const tab = useSyncExternalStore(subscribeToTabListen, tabListenState, tabListenServerState) === 'allowed';
  const reduced = useReducedMotion();
  const hidden = usePageHidden();

  const barPlaying = player.playing && !player.barrMuted;
  const videoPlaying = entry !== null && entry.shape !== 'picture' && !(clock?.paused ?? false);
  const youtubeId = entry !== null && entry.player.kind === 'frame' && entry.player.timeFrom === 'youtube' ? youtubeIdFromPlayer(entry.player.src) : null;
  const active = (barPlaying || videoPlaying) && !reduced && !hidden;

  // What the loop reads each frame, without being restarted by every change.
  const live = useRef({ barPlaying, videoPlaying, youtubeId, tab, element: player.audioElement });
  useEffect(() => {
    live.current = { barPlaying, videoPlaying, youtubeId, tab, element: player.audioElement };
  }, [barPlaying, videoPlaying, youtubeId, tab, player.audioElement]);

  // The ears, made once on first need and kept for the visit: an audio context, an analyser, the relay's hidden player.
  const ears = useRef<{
    context: AudioContext;
    analyser: AnalyserNode;
    bytes: Uint8Array<ArrayBuffer>;
    node: AudioNode | null;
    /** What the node is: the tab's or the bar's track (by id), or the relay. */
    heard: string | null;
    relay: HTMLAudioElement | null;
    relayNode: MediaElementAudioSourceNode | null;
    relayId: string | null;
    relayFailed: string | null;
  } | null>(null);

  // The bar folded away, or a stream room's strip took its place: the ears go with it, so the relay stops fetching and the
  // audio context is closed (a remount makes new ones).
  useEffect(
    () => () => {
      const kept = ears.current;
      if (kept === null) return;
      kept.node?.disconnect();
      if (kept.relay !== null) {
        kept.relay.pause();
        kept.relay.removeAttribute('src');
        kept.relay.load();
      }
      void kept.context.close().catch(() => undefined);
      ears.current = null;
    },
    [],
  );

  // Keeping the relay in step with YouTube's own player: where it is, and paused when it is.
  useEffect(() => {
    const kept = ears.current;
    const relay = kept?.relay ?? null;
    if (relay === null || kept === null || kept.relayId !== youtubeId || clock === null) return;
    if (clock.paused) {
      relay.pause();
      return;
    }
    // A media element's position, not React state: moving it is the point.
    // eslint-disable-next-line react-hooks/immutability
    if (Math.abs(relay.currentTime - clock.seconds) > RELAY_DRIFT_SECONDS) relay.currentTime = clock.seconds;
  }, [clock, youtubeId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context2d = canvas.getContext('2d');
    if (context2d === null) return;
    const draw2d = context2d;
    const drawn = canvas;

    if (!active) {
      draw2d.clearRect(0, 0, drawn.width, drawn.height);
      drawn.dataset.soundGraph = 'off';
      ears.current?.relay?.pause();
      return;
    }

    let palette = readPalette();
    // The theme changed (the switcher writes on <html>): the colours and their limits are worked out again.
    const watcher = new MutationObserver(() => {
      palette = readPalette();
    });
    watcher.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });

    let bars = 0;
    let edges: [number, number][] = [];
    let levels: number[] = [];
    const fit = () => {
      const box = drawn.getBoundingClientRect();
      // One canvas pixel to a CSS pixel: the meter's blocks are meant to be square, and fewer pixels is cheaper.
      drawn.width = Math.max(1, Math.round(box.width));
      drawn.height = Math.max(1, Math.round(box.height));
      bars = barCount(drawn.width);
      edges = bandEdges(bars, FFT / 2);
      levels = new Array<number>(bars).fill(0);
    };
    fit();
    const sizer = new ResizeObserver(fit);
    sizer.observe(drawn);

    const makeEars = () => {
      if (ears.current !== null) return ears.current;
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = FFT;
      analyser.smoothingTimeConstant = 0.5;
      // Nothing here is connected to the speakers: what reaches the analyser is only ever measured.
      ears.current = { context, analyser, bytes: new Uint8Array(new ArrayBuffer(FFT / 2)), node: null, heard: null, relay: null, relayNode: null, relayId: null, relayFailed: null };
      return ears.current;
    };

    const listenTo = (kept: NonNullable<typeof ears.current>, node: AudioNode | null, heard: string | null) => {
      if (kept.heard === heard) return;
      kept.node?.disconnect();
      kept.node = node;
      kept.heard = heard;
      node?.connect(kept.analyser);
      if (kept.context.state === 'suspended') void kept.context.resume().catch(() => undefined);
    };

    const relayFor = (kept: NonNullable<typeof ears.current>, id: string): HTMLAudioElement => {
      if (kept.relay === null) {
        const relay = new Audio();
        relay.preload = 'auto';
        relay.addEventListener('error', () => {
          if (kept.relayId !== null) kept.relayFailed = kept.relayId;
        });
        kept.relay = relay;
        // Taken into the graph: from now on this player's sound goes to the analyser and nowhere else.
        kept.relayNode = kept.context.createMediaElementSource(relay);
      }
      if (kept.relayId !== id) {
        kept.relayId = id;
        kept.relay.src = relayPath(id);
        const at = floatingClock();
        if (at !== null) kept.relay.currentTime = at.seconds;
      }
      return kept.relay;
    };

    const stopRelay = (kept: NonNullable<typeof ears.current> | null) => {
      const relay = kept?.relay;
      if (!kept || !relay || kept.relayId === null) return;
      relay.pause();
      relay.removeAttribute('src');
      relay.load();
      kept.relayId = null;
    };

    /** Which sound to listen to now, connected; the source it settled on. */
    const choose = (): GraphSource => {
      const now = live.current;
      const element = now.element();
      const barTrack = soundTrack(tapSound(element));
      const tabStream = tabSound();
      const source = pickSource({
        tab: tabStream !== null,
        barPlaying: now.barPlaying,
        barHeard: barTrack !== null,
        videoPlaying: now.videoPlaying,
        relayable: now.youtubeId !== null,
        relayFailed: now.youtubeId !== null && ears.current?.relayFailed === now.youtubeId,
      });
      if (source !== 'relay') stopRelay(ears.current);
      if (source === 'gentle' || source === 'off') {
        if (ears.current) listenTo(ears.current, null, null);
        return source;
      }
      const kept = makeEars();
      if (source === 'tab' && tabStream !== null) {
        const track = tabStream.getAudioTracks()[0];
        if (kept.heard !== `tab:${track.id}`) listenTo(kept, kept.context.createMediaStreamSource(new MediaStream([track])), `tab:${track.id}`);
      } else if (source === 'bar' && barTrack !== null) {
        if (kept.heard !== `bar:${barTrack.id}`) listenTo(kept, kept.context.createMediaStreamSource(new MediaStream([barTrack])), `bar:${barTrack.id}`);
      } else if (source === 'relay' && now.youtubeId !== null) {
        const relay = relayFor(kept, now.youtubeId);
        if (relay.paused && !(floatingClock()?.paused ?? false)) void relay.play().catch(() => undefined);
        listenTo(kept, kept.relayNode, 'relay');
      }
      return source;
    };

    let frame = 0;
    let last = 0;
    let source: GraphSource = choose();
    let chosenAt = performance.now();
    // Reported on the canvas about once a second, for a check to read: what it hears, how loud, what a frame costs.
    let spent = 0;
    let frames = 0;
    let loud = 0;
    let reportedAt = performance.now();

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < FRAME_MS) return;
      last = now;
      const began = performance.now();
      // Sources come and go (a song loads its copy, the reader allows the tab): asked again twice a second.
      if (began - chosenAt > 500) {
        source = choose();
        chosenAt = began;
      }
      const kept = ears.current;
      const hears = (source === 'tab' || source === 'bar' || source === 'relay') && kept !== null && kept.node !== null;
      if (hears) kept.analyser.getByteFrequencyData(kept.bytes);
      const seconds = now / 1000;
      const { width, height } = drawn;
      draw2d.clearRect(0, 0, width, height);
      const per = SEGMENT + SEGMENT_GAP;
      for (let i = 0; i < bars; i += 1) {
        const target = hears ? bandLevel(kept.bytes, edges[i][0], edges[i][1]) : source === 'gentle' ? gentleLevel(i, seconds) : 0;
        levels[i] = settle(levels[i], target);
        loud += levels[i];
        const colour = colourFor(i, bars, palette);
        const lit = litSegments(levels[i], height);
        if (colour === null || lit === 0) continue;
        draw2d.globalAlpha = colour.alpha;
        draw2d.fillStyle = colour.css;
        const x = i * (BAR + GAP);
        for (let s = 0; s < lit; s += 1) draw2d.fillRect(x, height - (s + 1) * per + SEGMENT_GAP, BAR, SEGMENT);
      }
      draw2d.globalAlpha = 1;
      spent += performance.now() - began;
      frames += 1;
      if (now - reportedAt > 1000) {
        drawn.dataset.soundGraph = source;
        drawn.dataset.soundGraphMs = (spent / Math.max(1, frames)).toFixed(3);
        drawn.dataset.soundGraphLevel = (loud / Math.max(1, frames * bars)).toFixed(3);
        drawn.dataset.soundGraphFps = String(Math.round((frames * 1000) / (now - reportedAt)));
        spent = 0;
        frames = 0;
        loud = 0;
        reportedAt = now;
      }
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      watcher.disconnect();
      sizer.disconnect();
      draw2d.clearRect(0, 0, drawn.width, drawn.height);
    };
  }, [active]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ imageRendering: 'pixelated' }}
      data-sound-graph="off"
    />
  );
}

/**
 * `[ HEAR ]`: lets the graph hear this tab, through the browser's own share prompt. Small, at the right inside the black
 * display, and only while it is not yet allowed (Luke's words: "the button to allow it, if not initially allowed, is small
 * and to the right inside the black of the bar at the bottom"). Not drawn where the browser cannot share a tab's sound.
 */
export function TabListenKey() {
  const status = useSyncExternalStore(subscribeToTabListen, tabListenState, tabListenServerState);
  if (status === 'allowed' || status === 'unsupported') return null;
  const tip =
    'Let the sound graph hear this tab, so it moves to YouTube and other players too. Your browser will ask to share this tab: ' +
    'pick this tab, keep "Also share tab audio" on, and press Share. Only the sound is measured, here on this page; nothing is recorded or sent. ' +
    "The browser's STOP SHARING ends it.";
  return (
    <button
      type="button"
      onClick={() => void askToHearTab()}
      disabled={status === 'asking'}
      title={tip}
      aria-label={tip}
      className={`${PLATE_ON_BLACK} relative shrink-0 self-start`}
      data-tab-listen={status}
    >
      [ HEAR ]
    </button>
  );
}
