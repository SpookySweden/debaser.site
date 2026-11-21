'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useScreenHost } from '../lib/screens/host-client';
import { ScreenSession } from '../lib/screens/session';
import {
  BITRATE_MIN_MBIT,
  DRAWINGS,
  LINES,
  MICE,
  RATES,
  SHAPES,
  SOUND_ON_THIS_PC,
  UPSCALINGS,
  askedNow,
  bitrateMaxMbit,
  capSays,
  controlKeySays,
  controlStateSays,
  keysSay,
  linesOffered,
  matchSays,
  megabits,
  padSays,
  rateOffered,
  rateSays,
  reallySending,
  soundOffered,
  soundStateSays,
  troubleLines,
  type HostPcScreen,
} from '../lib/screens/wishes';
import { PLATE_ON_BLACK, PLATE_ON_BLACK_PRESSED } from '../lib/ui/controls';
import { chooseScreen } from '../lib/watch/canvas-view';

/**
 * The PC's screen on a room's screen (SPEC-screens.md, phase 3, first slice), in the place the room's canvas takes:
 * for the PC's owner only, and only while the room's `[ SCREEN ]` key is on. The room's queue and players carry on
 * underneath, untouched; nothing here is synced or stored.
 *
 * It is the engine's own viewer page (`engine/web/viewer.html`) in the site's dress: the picture, the small readout in
 * its corner, `[ CONTROL ]` and `[ SETTINGS ]`, and the settings panel over it, with the engine's own labels. The work
 * is in `app/lib/screens/`; this file only draws how things stand and passes presses on.
 *
 * It connects when it is drawn and lets go of everything (the connection, control, every listener) when it is not:
 * the room draws it only while the screen is the chosen view. The picture's box sits on Black in every theme, so its
 * keys and words take the bar's inks (the canvas's tools and the visualiser's sliders do the same).
 */
export default function RoomScreen({ roomId, audio }: { roomId: string; /** As the room's screen keys': what kind of thing plays. */ audio: boolean }) {
  const host = useScreenHost();
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const fastCanvas = useRef<HTMLCanvasElement>(null);
  const sharpCanvas = useRef<HTMLCanvasElement>(null);
  const sound = useRef<HTMLAudioElement>(null);
  const [session] = useState(() => new ScreenSession());
  const view = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const [panelOpen, setPanelOpen] = useState(false);
  /** The bitrate slider says its number while it moves and asks the PC once, when it is let go. */
  const [sliding, setSliding] = useState<number | null>(null);
  const panelId = useId();
  const bitrateId = useId();
  const volumeId = useId();

  useEffect(() => {
    if (root.current === null || stage.current === null || video.current === null || fastCanvas.current === null || sharpCanvas.current === null || sound.current === null) return;
    session.attach({ root: root.current, stage: stage.current, video: video.current, audio: sound.current, fastCanvas: fastCanvas.current, sharpCanvas: sharpCanvas.current });
    return () => session.detach();
  }, [session]);

  // The PC's screen is no longer there for this reader (signed out, say): back to the room's own picture.
  useEffect(() => {
    if (!host.available) chooseScreen(roomId, 'picture', audio);
  }, [host.available, roomId, audio]);

  // Esc closes the panel, except while the PC has the keyboard: then Esc, like every key, never reaches here.
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanelOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen]);

  const { wishes, control } = view;
  const asked = askedNow(view.host, wishes);
  const matching = asked.shape === 'match';
  const standing = view.host === null ? 'off' : view.host.control;
  const controlAllowed = standing !== 'off';
  const controlSays = controlKeySays(view.host, control.mine, control.note);
  const cap = capSays(view.host);
  const trouble = troubleLines(view.host, view.hostTrouble);
  const soundKey = soundOffered(view.host, view.thisPc);
  const volume = Math.round(wishes.volume * 100);
  const mbit = sliding ?? Math.round(asked.bitrateKbps / 1000);
  const letGoOfSlider = () => {
    if (sliding === null) return;
    session.change({ bitrateKbps: sliding * 1000 });
    setSliding(null);
  };
  const openPanel = (open: boolean) => {
    setPanelOpen(open);
    if (open) void session.readHost();
  };
  const key = (on: boolean) => (on ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK);

  return (
    <div ref={root} className="absolute inset-0 z-10 bg-ink-plate text-label text-ink-bar" data-room-screen={view.problem ? 'problem' : 'shown'} data-screen-drawing={view.drawingShown} data-screen-fit={view.upscalingShown}>
      {/* The picture. While this device controls the PC it holds the keyboard, and its own pointer is the pointer. */}
      <div
        ref={stage}
        tabIndex={-1}
        role="application"
        aria-label="Your PC's screen"
        className={`absolute inset-0 overflow-hidden bg-ink-plate outline-none ${control.mine ? 'touch-none select-none' : ''}`}
        data-screen-stage={control.mine ? 'controlling' : 'watching'}
      >
        {/* `max-w-none`: the site's base styles keep a video no wider than its box, and OFF shows the picture at its real size. */}
        <video ref={video} muted autoPlay playsInline className="absolute left-0 top-0 h-full w-full max-w-none bg-ink-plate object-contain" />
        <canvas ref={fastCanvas} hidden className="absolute left-0 top-0 h-full w-full bg-ink-plate object-contain" />
        <canvas ref={sharpCanvas} hidden className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-ink-plate" />
      </div>
      {/* The PC's sound has an element of its own: never the room's players, the music bar or the sound graph. Silent until [ SOUND ]. */}
      <audio ref={sound} data-screen-sound={view.sound.on ? 'on' : 'off'} />

      {wishes.numbers ? (
        // At the foot, clear of the keys in the top corner, and wrapping: a room's picture is often a narrow box.
        <pre className="pointer-events-none absolute bottom-1 left-1 z-20 max-w-[calc(100%-0.5rem)] whitespace-pre-wrap bg-ink-plate px-1 py-0.5 font-mono text-label text-ink-bar" data-screen-numbers>
          {view.numbers}
        </pre>
      ) : null}

      {/* Under the room's own corner keys (VIS, CANVAS, REMOTE). They stay where they are whether the panel is open or not; it opens under them. */}
      <div className="absolute right-1 top-8 z-30 flex flex-col items-end gap-1 max-sm:top-14" data-screen-keys>
        <div className="flex items-center gap-1">
          {view.problem ? (
            <span className="bg-ink-plate">
              <button type="button" className={PLATE_ON_BLACK} onClick={() => session.tryAgain()} data-screen-try-again>
                [ TRY AGAIN ]
              </button>
            </span>
          ) : null}
          {controlAllowed ? (
            <span className="bg-ink-plate">
              <button type="button" className={key(control.mine)} aria-pressed={control.mine} onClick={() => session.toggleControl()} data-screen-control-key={control.mine ? 'mine' : 'free'}>
                {control.mine ? '[ RELEASE ]' : '[ CONTROL ]'}
              </button>
            </span>
          ) : null}
          {/* Only when the PC sends sound, and never on the PC itself. */}
          {soundKey ? (
            <span className="bg-ink-plate">
              <button type="button" className={key(view.sound.on)} aria-pressed={view.sound.on} onClick={() => session.toggleSound()} data-screen-sound-key={view.sound.on ? 'on' : 'off'}>
                [ SOUND ]
              </button>
            </span>
          ) : null}
          <span className="bg-ink-plate">
            {/* Open, it is pressed in by the site's one "this is open" look, in this Black surface's own inks (globals.css). */}
            <button type="button" className={PLATE_ON_BLACK} aria-expanded={panelOpen} aria-controls={panelId} onClick={() => openPanel(!panelOpen)} data-screen-settings-key>
              [ SETTINGS ]
            </button>
          </span>
        </div>
        {/* While this device controls the PC, the way out is always in sight (Luke, 2026-11-21: "we need an easier way of
            ending control"): this bar with its own [ RELEASE ], and holding Esc for a second lets go too. It sits here,
            under the keys, because the top left of a narrow room picture belongs to the room's own corner keys. */}
        {control.mine ? (
          <div className="flex max-w-full flex-wrap items-center justify-end gap-1 bg-ink-plate px-1 font-mono text-label text-ink-bar" role="status" data-screen-control-bar>
            <span data-screen-control-bar-says>{controlBarSays(control.escHolding, wishes.mouse, control.pointerLocked)}</span>
            <button type="button" className={PLATE_ON_BLACK} onClick={() => session.toggleControl()} data-screen-control-bar-release>
              [ RELEASE ]
            </button>
          </div>
        ) : null}
        {controlAllowed && controlSays ? (
          <span className="w-fit bg-bubble-pale px-1 font-bold text-ink-bar" role="status" data-screen-control-says>
            {controlSays}
          </span>
        ) : null}
      </div>

      {panelOpen ? (
        <section
          id={panelId}
          aria-label="Stream settings"
          className="absolute bottom-0 right-0 top-16 z-30 flex w-[27rem] max-w-full flex-col gap-1 overflow-y-auto border border-ink-bar bg-ink-plate px-3 pb-3 pt-2 text-label text-ink-bar max-sm:top-24"
          data-screen-panel
        >
          <header className="flex items-start justify-between gap-2">
            <h2 className="text-sun">SETTINGS</h2>
            <button type="button" className={PLATE_ON_BLACK} aria-label="Close settings" onClick={() => openPanel(false)} autoFocus>
              [ × ]
            </button>
          </header>

          <Part title="PICTURE">
            {/* A separate switch, off at first (Luke, 2026-11-21: "have the display monitor resolution fit be a separate switch"). Only when the PC allows it. */}
            {view.host?.pcScreen?.allowed ? (
              <>
                <div className="flex flex-wrap items-start gap-1">
                  <button type="button" className={key(wishes.fit)} aria-pressed={wishes.fit} onClick={() => session.toggleFit()} data-screen-pc-fit={wishes.fit ? 'on' : 'off'}>
                    [ FIT THE PC TO THIS SCREEN ]
                  </button>
                </div>
                <p>
                  The PC changes its own screen to this screen&apos;s shape while you are connected, and changes it back when you leave. Its monitor goes black for a second or two each way, and windows on it may move.
                </p>
                <p className="whitespace-pre-wrap" role="status" data-screen-pc-fit-says>
                  {fitSays(view.host.pcScreen)}
                </p>
              </>
            ) : null}
            <div className="flex flex-wrap items-start gap-1">
              <button type="button" className={key(matching)} aria-pressed={matching} onClick={() => session.toggleMatch()} data-screen-match={matching ? 'on' : 'off'}>
                [ MATCH THIS SCREEN ]
              </button>
            </div>
            <Why topic="MATCH THIS SCREEN">{matchSays(view.here)}</Why>
            {matching ? null : (
              <>
                <Sub>SHAPE</Sub>
                <div className="flex flex-wrap items-start gap-1" role="group" aria-label="Shape">
                  {SHAPES.map((shape) => (
                    <button key={shape} type="button" className={key(asked.shape === shape)} aria-pressed={asked.shape === shape} onClick={() => session.change({ shape })} data-screen-shape={shape}>
                      {`[ ${shape.toUpperCase()} ]`}
                    </button>
                  ))}
                </div>
                <Why topic="SHAPE">A shape narrower than the PC&apos;s screen cuts its sides off. NATIVE shows all of it, with bars above and below on a narrower screen.</Why>
              </>
            )}
            <Sub>SIZE (LINES, AT MOST)</Sub>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Size, in lines at most">
              {LINES.filter((lines) => linesOffered(lines, view.host)).map((lines) => (
                <button key={lines} type="button" className={key(asked.lines === lines)} aria-pressed={asked.lines === lines} onClick={() => session.change({ lines })} data-screen-lines={lines}>
                  {`[ ${String(lines).toUpperCase()} ]`}
                </button>
              ))}
            </div>
            <Sub>FRAMES A SECOND</Sub>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Frames a second">
              {RATES.filter((rate) => rateOffered(rate, view.host)).map((rate) => (
                <button key={rate} type="button" className={key(asked.fps === rate)} aria-pressed={asked.fps === rate} onClick={() => session.change({ fps: rate })} data-screen-fps={rate}>
                  {`[ ${String(rate).toUpperCase()} ]`}
                </button>
              ))}
            </div>
            <p>{rateSays(asked.fps, view.screenHz)}</p>
            <Sub>
              <label htmlFor={bitrateId}>BITRATE</label>
            </Sub>
            <div className="flex items-center gap-2">
              <input
                id={bitrateId}
                type="range"
                className="vis-slider min-w-0 flex-1"
                min={BITRATE_MIN_MBIT}
                max={bitrateMaxMbit(view.host)}
                step={1}
                value={mbit}
                aria-valuetext={megabits(mbit * 1000)}
                onChange={(event) => setSliding(Number(event.target.value))}
                onPointerUp={letGoOfSlider}
                onKeyUp={letGoOfSlider}
                onBlur={letGoOfSlider}
                data-screen-bitrate
              />
              <span className="w-24 shrink-0 text-right">{megabits(mbit * 1000)}</span>
            </div>
            <p className="whitespace-pre-wrap" data-screen-really>
              {reallySending(view.host)}
            </p>
            {cap === null ? null : (
              <p className="whitespace-pre-wrap text-sun" data-screen-cap>
                {cap}
              </p>
            )}
            {trouble.length === 0 ? null : <Fault>{trouble.join('\n')}</Fault>}
          </Part>

          <Part title="DRAWING">
            <div className="flex flex-wrap items-start gap-1" role="group" aria-label="Drawing">
              {DRAWINGS.map((drawing) => (
                <button key={drawing} type="button" className={key(wishes.drawing === drawing)} aria-pressed={wishes.drawing === drawing} onClick={() => session.setDrawing(drawing)} data-screen-drawing-key={drawing}>
                  {`[ ${drawing.toUpperCase()} ]`}
                </button>
              ))}
            </div>
            <Why topic="DRAWING">
              Only on this device. FAST takes each frame straight off the stream and puts it on a canvas that skips the browser&apos;s own drawing queue, so it reaches the screen sooner. NORMAL is the browser&apos;s own video player.
            </Why>
            {view.drawingNote ? <Fault>{view.drawingNote}</Fault> : null}
          </Part>

          <Part title="UPSCALING">
            <div className="flex flex-wrap items-start gap-1" role="group" aria-label="Upscaling">
              {UPSCALINGS.map((upscaling) => (
                <button key={upscaling} type="button" className={key(wishes.upscaling === upscaling)} aria-pressed={wishes.upscaling === upscaling} onClick={() => session.setUpscaling(upscaling)} data-screen-upscaling={upscaling}>
                  {`[ ${upscaling.toUpperCase()} ]`}
                </button>
              ))}
            </div>
            <Why topic="UPSCALING">
              Only on this device: nothing here is sent to the PC. OFF shows the picture at its real size, not stretched. SMOOTH stretches it to fill, softly. SHARP stretches it in hard squares (for pixel art). SHARPENED adds a sharpening pass on
              this device&apos;s graphics to every frame, which may add delay: that has not been measured.
            </Why>
            {view.upscalingNote ? <Fault>{view.upscalingNote}</Fault> : null}
          </Part>

          <Part title="READOUT">
            <pre className="whitespace-pre-wrap font-mono" data-screen-readout>
              {view.readout}
            </pre>
            <div className="flex flex-wrap items-start gap-1">
              <button type="button" className={key(wishes.numbers)} aria-pressed={wishes.numbers} onClick={() => session.toggleNumbers()}>
                [ NUMBERS ]
              </button>
            </div>
            <Why topic="NUMBERS">NUMBERS keeps the small readout in the corner of the picture.</Why>
          </Part>

          <Part title="WINDOW">
            <div>
              <button type="button" className={key(view.fullscreen)} aria-pressed={view.fullscreen} onClick={() => session.toggleFullscreen()} data-screen-fullscreen>
                {view.fullscreen ? '[ LEAVE FULLSCREEN ]' : '[ FULLSCREEN ]'}
              </button>
            </div>
          </Part>

          <Part title="SOUND">
            <p className="whitespace-pre-wrap" data-screen-sound-state>
              {soundStateSays(view.host, view.thisPc, view.sound.on, view.sound.note)}
            </p>
            {view.thisPc === true ? <Fault>{SOUND_ON_THIS_PC}</Fault> : null}
            {soundKey ? (
              <>
                <div className="flex flex-wrap items-start gap-1" role="group" aria-label="Sound">
                  <button type="button" className={key(view.sound.on)} aria-pressed={view.sound.on} onClick={() => session.setSound(true)} data-screen-sound-choice="on">
                    [ SOUND ON ]
                  </button>
                  <button type="button" className={key(!view.sound.on)} aria-pressed={!view.sound.on} onClick={() => session.setSound(false)} data-screen-sound-choice="off">
                    [ SOUND OFF ]
                  </button>
                </div>
                <Sub>
                  <label htmlFor={volumeId}>VOLUME</label>
                </Sub>
                <div className="flex items-center gap-2">
                  <input
                    id={volumeId}
                    type="range"
                    className="vis-slider min-w-0 flex-1"
                    min={0}
                    max={100}
                    step={1}
                    value={volume}
                    aria-valuetext={`${volume}%`}
                    onChange={(event) => session.setVolume(Number(event.target.value) / 100)}
                    data-screen-volume
                  />
                  <span className="w-24 shrink-0 text-right">{`${volume}%`}</span>
                </div>
              </>
            ) : null}
            <Why topic="SOUND">
              This is everything the PC is playing, not one program: its Windows cannot leave one out. The PC does not read its sound at all until a viewer turns this on, and stops when the last one turns it off. It is apart from the
              room&apos;s own music, with its own volume here.
            </Why>
          </Part>

          <Part title="CONTROL">
            <p className="whitespace-pre-wrap" data-screen-control-state>
              {controlStateSays(view.host, control.mine, control.note)}
            </p>
            {controlAllowed ? (
              <>
                <Sub>MOUSE</Sub>
                <div className="flex flex-wrap items-start gap-1" role="group" aria-label="Mouse">
                  {MICE.map((mouse) => (
                    <button key={mouse} type="button" className={key(wishes.mouse === mouse)} aria-pressed={wishes.mouse === mouse} onClick={() => session.setMouse(mouse)} data-screen-mouse={mouse}>
                      {`[ ${MOUSE_NAMES[mouse] ?? mouse.toUpperCase()} ]`}
                    </button>
                  ))}
                </div>
                {/* In plain sight, not behind [ ? ]: Luke found the old names confusing. */}
                <p data-screen-mouse-says>
                  POINT AND CLICK: the PC&apos;s pointer goes where yours is. For the desktop and most games.
                  <br />
                  CAPTURED, FOR 3D GAMES: your pointer vanishes and every movement turns the view, like playing a first-person game at the PC itself. Esc gives your pointer back.
                </p>
                {view.pointerWhy ? <Fault>{`A PLAIN ARROW IS SHOWN: ${view.pointerWhy}.`}</Fault> : null}
                {control.mine && wishes.mouse === 'game' && !control.pointerLocked ? <Fault>CLICK THE PICTURE TO CAPTURE THE MOUSE.</Fault> : null}
                <p>{keysSay(control.keyboardLocked, control.canLockKeyboard)}</p>
                <Sub>CONTROLLER</Sub>
                <p className="whitespace-pre-wrap" data-screen-pad>
                  {padSays(view.pad, control.mine, view.host)}
                </p>
                <Why topic="CONTROLLER">
                  A game controller on this device drives a pretend Xbox 360 controller on the PC, for as long as this device holds control. The PC unplugs it the moment control ends. One controller, in the layout browsers call standard; no
                  vibration comes back.
                </Why>
                <p>
                  To let go: hold Esc for a second, or press [ RELEASE ] (in the bar under the keys, or here). A quick press of Esc is still an ordinary Esc for the PC. Ctrl+Alt+Shift+Q on this device lets go too, and on the PC itself
                  Ctrl+Alt+Shift+End stops it. Keys go to the PC while the picture is the last thing pressed; press anywhere else on the site to type there. If this tab loses focus, every key held is let go at once.
                </p>
              </>
            ) : null}
          </Part>

          <Part title="NOT BUILT YET">
            <ul className="list-disc pl-4">
              <li>Vibration from the PC back to this device&apos;s controller.</li>
              <li>HEVC and AV1 video (this PC&apos;s graphics card cannot encode AV1).</li>
              <li>A virtual screen made at exactly this screen&apos;s size (FIT changes the PC&apos;s real screen instead, where its engine allows it).</li>
            </ul>
          </Part>
        </section>
      ) : null}
    </div>
  );
}

/** One section of the panel: its title line, then what belongs to it. */
/** FIT's status line: the PC's own account of its screen, and why it is not fitted when it is not. */
function fitSays(pc: HostPcScreen): string {
  const mode = (m: HostPcScreen['own']) => `${m.width}x${m.height} AT ${m.hz}`;
  if (pc.fitted) return `THE PC'S SCREEN IS NOW ${mode(pc.now)} (ITS OWN: ${mode(pc.own)})${pc.why ? `\n${pc.why}` : ''}`;
  return `${pc.why ? `${pc.why}\n` : ''}THE PC'S SCREEN IS ITS OWN: ${mode(pc.own)}`;
}

/** The line in the bar under the keys while this device controls the PC. */
function controlBarSays(escHolding: boolean, mouse: string, pointerLocked: boolean): string {
  if (escHolding) return 'KEEP HOLDING ESC TO LET GO';
  if (mouse === 'game') {
    return pointerLocked
      ? 'CONTROLLING YOUR PC :: MOUSE CAPTURED, ESC GIVES IT BACK :: HOLD ESC TO LET GO'
      : 'CONTROLLING YOUR PC :: CLICK THE PICTURE TO CAPTURE THE MOUSE :: HOLD ESC TO LET GO';
  }
  return 'CONTROLLING YOUR PC :: HOLD ESC TO LET GO';
}

/** The two mouse choices, named for what they are for (Luke found "GAME" confusing, 2026-11-21). Stored names unchanged. */
const MOUSE_NAMES: Record<string, string> = { pointer: 'POINT AND CLICK', game: 'CAPTURED, FOR 3D GAMES' };

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-2 flex flex-col gap-1 border-t border-ink-bar pt-2">
      <h3 className="text-sun">{title}</h3>
      {children}
    </div>
  );
}

function Sub({ children }: { children: ReactNode }) {
  return <h4 className="mt-1 font-bold">{children}</h4>;
}

/** Something that could not be done as asked: a Rose chip, as faults are everywhere on the site. */
function Fault({ children }: { children: ReactNode }) {
  return (
    <p className="w-fit whitespace-pre-wrap bg-bubble-pale px-1 text-ink-bar" role="status">
      {children}
    </p>
  );
}

/** A sentence a reader may want, behind `[ ? ]` (as `InfoFold`, in the inks of a Black surface). */
function Why({ topic, children }: { topic: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className={`${PLATE_ON_BLACK} inline-block`} aria-label={`About ${topic}`}>
        <span className="group-open:hidden">[ ? ]</span>
        <span className="hidden group-open:inline">[ × ]</span>
      </summary>
      <p className="mt-1">{children}</p>
    </details>
  );
}
