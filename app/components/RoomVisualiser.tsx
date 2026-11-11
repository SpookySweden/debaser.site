'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ButterchurnVisualizer } from 'butterchurn';
import { tapSound } from '../lib/watch/audio-tap';
import { acceptWarning, BLEND_SECONDS, CYCLE_SECONDS, presetNames, setVisualiserOn, stepPreset, warningAccepted } from '../lib/watch/visualiser';
import { PLATE_ON_BLACK, PLATE_ON_BLACK_PRESSED } from '../lib/ui/controls';

type Hearing = 'starting' | 'listening' | 'own-rhythm' | 'unsupported';

/**
 * The stream room's music visualiser (Luke, 2026-11-11, from the research he pasted): Butterchurn (Milkdrop in WebGL 2,
 * MIT) over the room's screen, for this viewer only. It hears the sound the room plays itself (the music bar's songs, the
 * room's own player's files) through a copy of it (lib/watch/audio-tap.ts), where the host allows that; a YouTube, Vimeo
 * or PeerTube player never shares its sound, so then it moves on its own rhythm and says so.
 *
 * Calm looks to start, changing every 20 seconds with a soft blend; N next, P previous, R random, SPACE holds this one,
 * F fullscreen. The keys hide until the pointer moves or a key is pressed. A flashing-lights warning comes first, once per
 * browser. Slower under "reduce motion", stopped while the window is hidden. Butterchurn and its presets load only now.
 */
export default function RoomVisualiser({ roomId, element }: { roomId: string; element: HTMLMediaElement | null }) {
  const [warned, setWarned] = useState(() => warningAccepted());
  if (!warned) {
    return (
      <div className="absolute inset-0 z-20 flex items-center justify-center bg-chrome p-4">
        <div role="alertdialog" aria-label="Flashing lights" className="max-w-md border border-ink-plate bg-sun-pale p-3 text-label text-ink">
          <p className="font-bold">FLASHING LIGHTS</p>
          <p className="mt-1">THE VISUALISER MOVES AND CHANGES COLOUR WITH THE MUSIC, AND SOME LOOKS FLASH. IT STARTS WITH CALM ONES.</p>
          <p className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className={PLATE_ON_BLACK}
              onClick={() => {
                acceptWarning();
                setWarned(true);
              }}
            >
              [ I UNDERSTAND, SHOW IT ]
            </button>
            <button type="button" className={PLATE_ON_BLACK} onClick={() => setVisualiserOn(roomId, false)}>
              [ NOT NOW ]
            </button>
          </p>
        </div>
      </div>
    );
  }
  return <Visualiser element={element} />;
}

function Visualiser({ element }: { element: HTMLMediaElement | null }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const visualiserRef = useRef<ButterchurnVisualizer | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<{ node: MediaStreamAudioSourceNode; stream: MediaStream } | null>(null);
  const presetsRef = useRef<Record<string, object>>({});
  const [names, setNames] = useState<string[]>([]);
  const [wild, setWild] = useState(false);
  const [at, setAt] = useState(0);
  const [held, setHeld] = useState(false);
  const [hearing, setHearing] = useState<Hearing>('starting');
  const [keysShown, setKeysShown] = useState(true);
  const hideTimer = useRef<number | null>(null);

  // Butterchurn and the presets, loaded only when the visualiser is opened (a press: the audio context may start).
  useEffect(() => {
    let live = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!canvas.getContext('webgl2')) {
      setHearing('unsupported');
      return;
    }
    void (async () => {
      const [{ default: butterchurn }, { default: pack }] = await Promise.all([import('butterchurn'), import('butterchurn-presets')]);
      if (!live) return;
      const context = new AudioContext();
      contextRef.current = context;
      const box = canvas.getBoundingClientRect();
      const visualiser = butterchurn.createVisualizer(context, canvas, { width: Math.max(1, box.width), height: Math.max(1, box.height), pixelRatio: Math.min(window.devicePixelRatio || 1, 2) });
      visualiserRef.current = visualiser;
      presetsRef.current = pack.getPresets();
      setNames(presetNames(Object.keys(presetsRef.current), false));
    })().catch(() => live && setHearing('unsupported'));
    return () => {
      live = false;
      sourceRef.current?.node.disconnect();
      sourceRef.current = null;
      visualiserRef.current = null;
      void contextRef.current?.close().catch(() => undefined);
      contextRef.current = null;
    };
  }, []);

  // Listening: a copy of the playing element's sound, taken again when the element starts something new.
  useEffect(() => {
    const listen = () => {
      const visualiser = visualiserRef.current;
      const context = contextRef.current;
      if (!visualiser || !context) return;
      const stream = tapSound(element);
      const held = sourceRef.current;
      if (held && stream && held.stream.getAudioTracks()[0]?.id === stream.getAudioTracks()[0]?.id) return;
      if (held) {
        try {
          visualiser.disconnectAudio(held.node);
        } catch {
          // already gone
        }
        held.node.disconnect();
        sourceRef.current = null;
      }
      if (stream) {
        void context.resume().catch(() => undefined);
        const node = context.createMediaStreamSource(stream);
        visualiser.connectAudio(node);
        sourceRef.current = { node, stream };
        setHearing('listening');
      } else setHearing((was) => (was === 'unsupported' ? was : 'own-rhythm'));
    };
    listen();
    const timer = window.setInterval(listen, 2000);
    element?.addEventListener('playing', listen);
    return () => {
      window.clearInterval(timer);
      element?.removeEventListener('playing', listen);
    };
  }, [element, names.length]);

  // The look: the chosen preset, blended in.
  useEffect(() => {
    const visualiser = visualiserRef.current;
    const name = names[at];
    if (!visualiser || name === undefined) return;
    const preset = presetsRef.current[name];
    if (preset) visualiser.loadPreset(preset, BLEND_SECONDS);
  }, [names, at]);

  // Changing on its own every 20 seconds unless held.
  useEffect(() => {
    if (held || names.length < 2) return;
    const timer = window.setInterval(() => setAt((was) => stepPreset(was, names.length, 'next')), CYCLE_SECONDS * 1000);
    return () => window.clearInterval(timer);
  }, [held, names.length]);

  // Drawing: every frame, a quarter as often under "reduce motion", nothing while the window is hidden; and its size.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const slow = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let count = 0;
    const draw = () => {
      frame = window.requestAnimationFrame(draw);
      if (document.hidden) return;
      count += 1;
      if (slow && count % 4 !== 0) return;
      visualiserRef.current?.render();
    };
    frame = window.requestAnimationFrame(draw);
    const resize = new ResizeObserver(() => {
      const box = canvas.getBoundingClientRect();
      visualiserRef.current?.setRendererSize(Math.max(1, box.width), Math.max(1, box.height));
    });
    resize.observe(canvas);
    return () => {
      window.cancelAnimationFrame(frame);
      resize.disconnect();
    };
  }, []);

  const wake = useCallback(() => {
    setKeysShown(true);
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setKeysShown(false), 3000);
  }, []);
  useEffect(() => {
    // Shown to begin with (the state starts that way); they hide after three quiet seconds.
    hideTimer.current = window.setTimeout(() => setKeysShown(false), 3000);
    boxRef.current?.focus();
    return () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, [wake]);

  const go = (how: 'next' | 'previous' | 'random') => setAt((was) => stepPreset(was, names.length, how));
  const switchWild = () => {
    const next = !wild;
    setWild(next);
    setNames(presetNames(Object.keys(presetsRef.current), next));
    setAt(0);
  };
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void boxRef.current?.requestFullscreen().catch(() => undefined);
  };
  const keys = (event: KeyboardEvent) => {
    wake();
    const key = event.key.toLowerCase();
    if (key === 'n') go('next');
    else if (key === 'p') go('previous');
    else if (key === 'r') go('random');
    else if (key === 'f') fullscreen();
    else if (key === ' ') setHeld((was) => !was);
    else return;
    event.preventDefault();
  };

  const name = names[at] ?? '';
  const status =
    hearing === 'listening'
      ? 'LISTENING'
      : hearing === 'own-rhythm'
        ? "THIS PLAYER DOESN'T SHARE ITS SOUND: MOVING ON ITS OWN"
        : hearing === 'unsupported'
          ? "THIS BROWSER CAN'T DRAW THE VISUALISER"
          : 'STARTING...';

  return (
    <div
      ref={boxRef}
      tabIndex={0}
      aria-label="Music visualiser. N next, P previous, R random, space holds this one, F fullscreen."
      onKeyDown={keys}
      onPointerMove={wake}
      onPointerDown={wake}
      className="absolute inset-0 z-20 bg-chrome focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-ink"
      data-visualiser={hearing}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      {/* The keys: placed over the picture, so showing and hiding them moves nothing. */}
      <div className={`absolute inset-x-1 bottom-1 flex flex-wrap items-center gap-1 ${keysShown ? '' : 'pointer-events-none opacity-0'}`}>
        <button type="button" className={PLATE_ON_BLACK} onClick={() => go('previous')} aria-label="Previous look (P)">
          [ ◀ ]
        </button>
        <button type="button" className={PLATE_ON_BLACK} onClick={() => go('next')} aria-label="Next look (N)">
          [ ▶ ]
        </button>
        <button type="button" className={PLATE_ON_BLACK} onClick={() => go('random')} aria-label="A random look (R)">
          [ RANDOM ]
        </button>
        <button type="button" className={held ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK} aria-pressed={held} onClick={() => setHeld((was) => !was)} aria-label="Hold this look (space)">
          {held ? '[ HELD ]' : '[ HOLD ]'}
        </button>
        <button type="button" className={wild ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK} aria-pressed={wild} onClick={switchWild} aria-label={wild ? 'Back to the calm looks' : 'All looks, some of which flash'}>
          {wild ? '[ ALL ]' : '[ CALM ]'}
        </button>
        <button type="button" className={PLATE_ON_BLACK} onClick={fullscreen} aria-label="Fullscreen (F)">
          [ FULL ]
        </button>
        <span className="min-w-0 flex-1 truncate bg-chrome px-1 text-label text-ink-bar" role="status">
          {status}
          {name ? ` · ${name.toUpperCase()}` : ''}
        </span>
      </div>
    </div>
  );
}
