'use client';

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { ButterchurnVisualizer } from 'butterchurn';
import { soundTrack, tapSound, whyDeaf } from '../lib/watch/audio-tap';
import {
  acceptWarning,
  BLEND_SECONDS,
  DEFAULT_SETTINGS,
  hearingNote,
  levelMeter,
  loudness,
  pictureScale,
  presetNames,
  reactGain,
  readSettings,
  saveSettings,
  setVisualiserOn,
  shapeSound,
  SILENCE,
  SLIDERS,
  stepPreset,
  usualLoudness,
  warningAccepted,
  type SliderKey,
  type VisualiserSettings,
} from '../lib/watch/visualiser';
import { PLATE_ON_BLACK, PLATE_ON_BLACK_PRESSED } from '../lib/ui/controls';

type Hearing = 'starting' | 'listening' | 'own-rhythm' | 'unsupported';
type Deaf = ReturnType<typeof whyDeaf>;

/** A frame of sound as Butterchurn reads it: 1024 bytes resting at 128, for both channels together, left and right. */
const FRAME = 1024;
type Frame = { both: Uint8Array<ArrayBuffer>; left: Uint8Array<ArrayBuffer>; right: Uint8Array<ArrayBuffer> };
const emptyFrame = (): Frame => ({ both: new Uint8Array(FRAME).fill(128), left: new Uint8Array(FRAME).fill(128), right: new Uint8Array(FRAME).fill(128) });

/** Under "reduce motion" a look is drawn this many frames at once, out of sight, so the still that shows has settled. */
const STILL_FRAMES = 40;

/**
 * The stream room's music visualiser (Luke, 2026-11-11, from the research he pasted): Butterchurn (Milkdrop in WebGL 2,
 * MIT) over the room's screen, for this viewer only.
 *
 * **It follows the sound** (Luke, 2026-11-14: "needs to react properly to the audio playing"). It hears what the room
 * plays itself (the music bar's songs, the room's own player's files) through one kept copy of the sound
 * (lib/watch/audio-tap.ts), measures each frame here, and hands Butterchurn that frame: so REACT can stretch the swing
 * between a quiet and a loud moment, and the line at the foot shows the level it hears as squares. A YouTube, Vimeo or
 * PeerTube player never shares its sound, Firefox and Safari can't lend a copy, and most podcast hosts don't allow one:
 * then it is fed silence, moves on its own, and says which of those it is. Nothing is faked, and no sound is recorded,
 * kept or sent anywhere: a frame is read, drawn from and overwritten by the next.
 *
 * **Sliders** ([ SLIDERS ], kept in this browser, RESET for the defaults): REACT, SPEED, BRIGHTNESS and how often the
 * look changes. Real range inputs: arrow keys step them, HOME and END jump to the ends, each says its value.
 *
 * Calm looks to start, changing with a soft blend; N next, P previous, R random, SPACE holds this one, F fullscreen. The
 * keys hide until the pointer moves or a key is pressed. A flashing-lights warning comes first, once per browser. Under
 * "reduce motion" nothing moves: each look is one still picture, changed only by the reader. Stopped while the window is
 * hidden. Butterchurn and its presets load only now.
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

/** Whether the reader asked their device for less motion; followed while the visualiser is open. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const follow = () => setReduced(query.matches);
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, []);
  return reduced;
}

function Visualiser({ element }: { element: HTMLMediaElement | null }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const meterRef = useRef<HTMLSpanElement | null>(null);
  const visualiserRef = useRef<ButterchurnVisualizer | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  /** Where the copy of the sound is measured: both channels together, and each by itself. */
  const earsRef = useRef<{ both: AnalyserNode; left: AnalyserNode; right: AnalyserNode; splitter: ChannelSplitterNode } | null>(null);
  /** The track being listened to now, and the node made from it. */
  const listeningRef = useRef<{ node: MediaStreamAudioSourceNode; trackId: string } | null>(null);
  const presetsRef = useRef<Record<string, object>>({});
  const [names, setNames] = useState<string[]>([]);
  const [wild, setWild] = useState(false);
  const [at, setAt] = useState(0);
  const [held, setHeld] = useState(false);
  const [hearing, setHearing] = useState<Hearing>('starting');
  const [deaf, setDeaf] = useState<Deaf>(null);
  const [keysShown, setKeysShown] = useState(true);
  const [slidersOpen, setSlidersOpen] = useState(false);
  const [settings, setSettings] = useState<VisualiserSettings>(() => readSettings());
  const still = useReducedMotion();
  const hideTimer = useRef<number | null>(null);
  const slidersId = useId();
  // What the drawing loop reads each frame, without being restarted by a slider.
  const settingsRef = useRef(settings);
  const stillRef = useRef(still);
  /** Frames a still picture is owed: set when the look changes under "reduce motion". */
  const owedRef = useRef(STILL_FRAMES);
  useEffect(() => {
    settingsRef.current = settings;
    stillRef.current = still;
    // A slider moved, or motion was switched: a still picture is drawn again so the change shows.
    owedRef.current = STILL_FRAMES;
  }, [settings, still]);

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
      // The ears: nothing here is connected to the speakers, so the copy is only ever measured.
      const analyser = () => {
        const made = context.createAnalyser();
        made.fftSize = FRAME;
        made.smoothingTimeConstant = 0;
        return made;
      };
      const ears = { both: analyser(), left: analyser(), right: analyser(), splitter: context.createChannelSplitter(2) };
      ears.splitter.connect(ears.left, 0);
      ears.splitter.connect(ears.right, 1);
      earsRef.current = ears;
      const box = canvas.getBoundingClientRect();
      const visualiser = butterchurn.createVisualizer(context, canvas, { width: Math.max(1, box.width), height: Math.max(1, box.height), pixelRatio: pictureScale(window.devicePixelRatio, window.screen.width, window.innerWidth) });
      visualiserRef.current = visualiser;
      presetsRef.current = pack.getPresets();
      setNames(presetNames(Object.keys(presetsRef.current), false));
    })().catch(() => live && setHearing('unsupported'));
    return () => {
      live = false;
      listeningRef.current?.node.disconnect();
      listeningRef.current = null;
      earsRef.current = null;
      visualiserRef.current = null;
      void contextRef.current?.close().catch(() => undefined);
      contextRef.current = null;
    };
  }, []);

  // Listening: the element's one kept copy, followed to its newest track when the element starts something new.
  useEffect(() => {
    const listen = () => {
      const context = contextRef.current;
      const ears = earsRef.current;
      if (!context || !ears) return;
      const track = soundTrack(tapSound(element));
      const was = listeningRef.current;
      if (was && track && was.trackId === track.id) return;
      if (was) {
        was.node.disconnect();
        listeningRef.current = null;
      }
      if (track) {
        void context.resume().catch(() => undefined);
        // The track by itself: a node made from the whole copy would keep to its first, silent, track.
        const node = context.createMediaStreamSource(new MediaStream([track]));
        node.connect(ears.both);
        node.connect(ears.splitter);
        listeningRef.current = { node, trackId: track.id };
        setHearing('listening');
        setDeaf(null);
      } else {
        setHearing((before) => (before === 'unsupported' ? before : 'own-rhythm'));
        setDeaf(whyDeaf(element));
      }
    };
    listen();
    const timer = window.setInterval(listen, 2000);
    const copy = tapSound(element);
    copy?.addEventListener('addtrack', listen);
    element?.addEventListener('playing', listen);
    element?.addEventListener('loadedmetadata', listen);
    return () => {
      window.clearInterval(timer);
      copy?.removeEventListener('addtrack', listen);
      element?.removeEventListener('playing', listen);
      element?.removeEventListener('loadedmetadata', listen);
    };
  }, [element, names.length]);

  // The look: the chosen preset, blended in (or at once, for a still picture).
  useEffect(() => {
    const visualiser = visualiserRef.current;
    const name = names[at];
    if (!visualiser || name === undefined) return;
    const preset = presetsRef.current[name];
    if (preset) visualiser.loadPreset(preset, still ? 0 : BLEND_SECONDS);
    owedRef.current = STILL_FRAMES;
  }, [names, at, still]);

  // Changing on its own as often as CHANGE EVERY says, unless held; never by itself under "reduce motion".
  useEffect(() => {
    if (held || still || names.length < 2) return;
    const timer = window.setInterval(() => setAt((was) => stepPreset(was, names.length, 'next')), settings.change * 1000);
    return () => window.clearInterval(timer);
  }, [held, still, names.length, settings.change]);

  // Drawing: every frame the sound is read, shaped by REACT and handed to the picture with a clock run by SPEED.
  // Nothing while the window is hidden; under "reduce motion" only the still pictures owed.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const heard = emptyFrame();
    const fed = emptyFrame();
    let frame = 0;
    let last = performance.now();
    let usual = 0;
    let told = 0;
    const draw = (now: number) => {
      frame = window.requestAnimationFrame(draw);
      const seconds = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
      last = now;
      const visualiser = visualiserRef.current;
      if (document.hidden || !visualiser) return;
      const current = settingsRef.current;
      const ears = earsRef.current;
      let level = 0;
      let fedLevel = 0;
      if (ears && listeningRef.current) {
        ears.both.getByteTimeDomainData(heard.both);
        ears.left.getByteTimeDomainData(heard.left);
        ears.right.getByteTimeDomainData(heard.right);
        level = loudness(heard.both);
        if (level > SILENCE) usual = usualLoudness(usual, level);
        const gain = reactGain(current.react, level, usual);
        shapeSound(heard.both, fed.both, gain);
        shapeSound(heard.left, fed.left, gain);
        // A song in one channel only leaves the other flat: both sides then draw from the one that has sound.
        shapeSound(loudness(heard.right) > SILENCE ? heard.right : heard.left, fed.right, gain);
        fedLevel = Math.min(1, level * gain);
      } else {
        fed.both.fill(128);
        fed.left.fill(128);
        fed.right.fill(128);
      }
      if (now - told >= 120) {
        // What it hears, for the reader (the squares) and for a check (the numbers): a few times a second, by the
        // clock and not by counting frames, so a slow device's squares are never seconds behind the song.
        told = now;
        const box = boxRef.current;
        box?.setAttribute('data-visualiser-level', level.toFixed(3));
        box?.setAttribute('data-visualiser-fed', fedLevel.toFixed(3));
        if (meterRef.current) meterRef.current.textContent = listeningRef.current ? `${levelMeter(level)} ` : '';
      }
      const sound = { timeByteArray: fed.both, timeByteArrayL: fed.left, timeByteArrayR: fed.right };
      if (stillRef.current) {
        // One settled picture: its frames are drawn in this one tick, so nothing is seen to move.
        if (owedRef.current <= 0) return;
        for (let i = 0; i < owedRef.current; i += 1) visualiser.render({ audioLevels: sound, elapsedTime: 1 / 30 });
        owedRef.current = 0;
        return;
      }
      visualiser.render({ audioLevels: sound, elapsedTime: (seconds * current.speed) / 100 });
    };
    frame = window.requestAnimationFrame(draw);
    const resize = new ResizeObserver(() => {
      const box = canvas.getBoundingClientRect();
      visualiserRef.current?.setRendererSize(Math.max(1, box.width), Math.max(1, box.height));
      owedRef.current = STILL_FRAMES;
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
    // SPACE holds the look only from the picture itself: on a key or a slider it is that control's own press.
    if (key === ' ' && event.target !== event.currentTarget) return;
    if (key === 'n') go('next');
    else if (key === 'p') go('previous');
    else if (key === 'r') go('random');
    else if (key === 'f') fullscreen();
    else if (key === ' ') setHeld((was) => !was);
    else return;
    event.preventDefault();
  };
  const turn = (key: SliderKey, value: number) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    saveSettings(next);
  };
  const reset = () => {
    setSettings({ ...DEFAULT_SETTINGS });
    saveSettings(DEFAULT_SETTINGS);
  };

  const name = names[at] ?? '';
  const shown = keysShown || slidersOpen;

  return (
    <div
      ref={boxRef}
      tabIndex={0}
      aria-label="Music visualiser. N next, P previous, R random, space holds this one, F fullscreen."
      onKeyDown={keys}
      onPointerMove={wake}
      onPointerDown={wake}
      onFocus={wake}
      className="absolute inset-0 z-20 overflow-hidden bg-chrome focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-ink"
      data-visualiser={hearing}
      data-visualiser-still={still ? 'yes' : 'no'}
    >
      <canvas ref={canvasRef} className="block h-full w-full" style={settings.brightness < 100 ? { filter: `brightness(${settings.brightness / 100})` } : undefined} />
      {/* The keys and the sliders: placed over the picture and growing upward from its foot, so showing, hiding or
          opening them moves nothing: the keys stay where the pointer is. */}
      <div className={`absolute inset-x-1 bottom-1 flex flex-col gap-1 ${shown ? '' : 'pointer-events-none opacity-0'}`}>
        {slidersOpen ? (
          <div id={slidersId} role="group" aria-label="Visualiser sliders" className="flex w-full max-w-xl flex-col bg-chrome px-2 py-1 text-key text-ink-bar" data-visualiser-sliders>
            {SLIDERS.map((slider) => (
              <label key={slider.key} className="flex items-center gap-2">
                <span className="w-32 shrink-0">{slider.label}</span>
                <input
                  type="range"
                  className="vis-slider min-w-0 flex-1"
                  min={slider.min}
                  max={slider.max}
                  step={slider.step}
                  value={settings[slider.key]}
                  onChange={(event) => turn(slider.key, Number(event.target.value))}
                  aria-label={slider.name}
                  aria-valuetext={slider.say(settings[slider.key])}
                  data-visualiser-slider={slider.key}
                />
                <span className="w-28 shrink-0 text-right" aria-hidden="true">
                  {slider.say(settings[slider.key])}
                </span>
              </label>
            ))}
            <p>
              <button type="button" className={PLATE_ON_BLACK} onClick={reset} aria-label="Put every slider back to where it started" data-visualiser-reset>
                [ RESET ]
              </button>
            </p>
          </div>
        ) : null}
        {/* On a Black strip: the keys' Daffodil words would be lost on a bright picture. */}
        <div className="flex flex-wrap items-center gap-1 bg-chrome">
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
          <button
            type="button"
            className={slidersOpen ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK}
            aria-expanded={slidersOpen}
            aria-controls={slidersId}
            onClick={() => setSlidersOpen((was) => !was)}
            data-visualiser-sliders-key
          >
            [ SLIDERS ]
          </button>
          <button type="button" className={PLATE_ON_BLACK} onClick={fullscreen} aria-label="Fullscreen (F)">
            [ FULL ]
          </button>
          <span className="min-w-0 flex-1 truncate bg-chrome px-1 text-label text-ink-bar">
            {/* The level it hears, as squares: written straight into the page a few times a second, and kept from a
                screen reader, which would otherwise read every change aloud. Empty when it hears nothing. */}
            <span ref={meterRef} aria-hidden="true" data-visualiser-meter />
            <span role="status">
              {hearingNote(hearing, deaf, still)}
              {name ? ` · ${name.toUpperCase()}` : ''}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
