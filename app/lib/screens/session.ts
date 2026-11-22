import { ScreenConnection, type StreamStats } from './connection';
import { type NetRoute } from './net-route';
import { ScreenControl, canLockKeyboard } from './control';
import { ScreenDrawing } from './drawing';
import { pretendNotThisPc, screenHostNow, talkToSettings, type EngineId, type SettingsAnswer } from './host-client';
import { ScreenPointerShape } from './pointer-shape';
import { soundMessage } from './wire';
import {
  DEFAULT_WISHES,
  RATE_GAPS,
  rateFromGaps,
  readWishes,
  rememberWishes,
  requestFor,
  wishesAfter,
  wishesForThePc,
  askedNow,
  soundOffered,
  SOUND_NOT_SENT,
  SOUND_WANTS_A_PRESS,
  type Drawing,
  type HostSettings,
  type Mouse,
  type PadSeen,
  type SettingsRequest,
  type ThisScreen,
  type Upscaling,
  type Wishes,
} from './wishes';

/**
 * SCREENS in a room (SPEC-screens.md, phase 3): one viewing of the PC's screen, from the moment the room's SCREEN key
 * is pressed until it is pressed again. It ties the ported parts of the engine's own viewer page together (the
 * connection, the settings, the drawing, CONTROL, the readout: `engine/web/viewer.html`, whose START part this is)
 * and hands a component one plain picture of how things stand (`ScreenState`) to draw the keys and the panel from.
 *
 * `attach` connects and starts listening; `detach` lets go of everything: the connection, control (the PC is told),
 * every listener and timer. Nothing is kept anywhere but this browser's own storage (the wishes).
 */

/** The parts of the page a viewing works on. */
export type ScreenParts = {
  /** The whole view: what goes fullscreen. */
  root: HTMLElement;
  /** The picture's box: where it is fitted, where the pointer is read, what holds the keyboard while controlling. */
  stage: HTMLElement;
  video: HTMLVideoElement;
  /** The PC's sound: an element of its own, apart from the picture and from everything else the site plays. */
  audio: HTMLAudioElement;
  fastCanvas: HTMLCanvasElement;
  sharpCanvas: HTMLCanvasElement;
};

/** How things stand, for the component to draw. A new one is made whenever anything in it changes. */
export type ScreenState = {
  wishes: Wishes;
  /** The PC's last answer about its settings. */
  host: HostSettings | null;
  /** Why the PC could not be asked, when it could not. */
  hostTrouble: string;
  /** This device's screen in real pixels, which is what MATCH THIS SCREEN sends. */
  here: ThisScreen;
  /** How many frames a second this screen shows, once measured. */
  screenHz: number | null;
  /** What is really in use on this device, and why when that is not what was chosen. */
  drawingShown: Drawing;
  drawingNote: string;
  upscalingShown: Upscaling;
  upscalingNote: string;
  /** The small readout in the corner of the picture. */
  numbers: string;
  /** The panel's READOUT. */
  readout: string;
  /** Why there is no picture, when the connection has failed. */
  problem: string;
  fullscreen: boolean;
  control: { mine: boolean; note: string; pointerLocked: boolean; keyboardLocked: boolean; canLockKeyboard: boolean; escHolding: boolean };
  /** Whether this device is the PC itself (the engine was reached on its own machine). Null until the connection says. */
  thisPc: boolean | null;
  /** Which way the picture travels: this PC, the home network, the internet (net-route.ts). Null until chosen. */
  route: NetRoute | null;
  /** The PC's sound on this device: playing or not, and why not when it was wanted and could not be. */
  sound: { on: boolean; note: string };
  /** This device's game controller. */
  pad: PadSeen;
  /** Why the plain arrow is shown while controlling, when the PC's own pointer shape cannot be; '' otherwise. */
  pointerWhy: string;
};

/** How long a closing connection is kept for "I am letting go" of control to reach the PC. */
const LAST_WORDS_MS = 200;
const NO_SCREEN: ThisScreen = { viewWidth: 0, viewHeight: 0 };
const FIRST_STATE: ScreenState = {
  wishes: DEFAULT_WISHES,
  host: null,
  hostTrouble: '',
  here: NO_SCREEN,
  screenHz: null,
  drawingShown: 'normal',
  drawingNote: '',
  upscalingShown: 'smooth',
  upscalingNote: '',
  numbers: 'connecting',
  readout: 'No picture yet.',
  problem: '',
  fullscreen: false,
  control: { mine: false, note: '', pointerLocked: false, keyboardLocked: false, canLockKeyboard: false, escHolding: false },
  thisPc: null,
  route: null,
  sound: { on: false, note: '' },
  pad: { supported: false, name: '', odd: false, pcSays: null },
  pointerWhy: '',
};

function thisScreen(): ThisScreen {
  const ratio = window.devicePixelRatio || 1;
  return { viewWidth: Math.round(window.screen.width * ratio), viewHeight: Math.round(window.screen.height * ratio) };
}

/** Which screen the window is on, so that a window moved to another screen has its rate measured again. */
function whichScreen(): string {
  const screen = window.screen as Screen & { availLeft?: number; availTop?: number };
  return [screen.width, screen.height, screen.availLeft, screen.availTop, window.devicePixelRatio].join(' ');
}

/** Whether the view fills the screen: by its own FULLSCREEN key, or inside the room's own fullscreen (its FULL key, a double press). */
function inFullscreen(root: HTMLElement): boolean {
  const full = document.fullscreenElement;
  return full !== null && full.contains(root);
}

/** The browser's `screen` says when it changes, where it can (TypeScript's list does not know it as something that speaks). */
function screenEvents(): EventTarget | null {
  const screen: unknown = window.screen;
  return screen instanceof EventTarget ? screen : null;
}

const shown = (value: number | null, digits: number): string => (typeof value === 'number' ? value.toFixed(digits) : '-');
const quietly = (promise: Promise<unknown>): void => {
  promise.catch(() => {
    /* the reason is already shown in the panel */
  });
};

export class ScreenSession {
  /** Which machine's engine this session shows: THE PC's or THE SERVER's (2026-11-22). */
  constructor(readonly engine: EngineId = 'pc') {}

  private state: ScreenState = FIRST_STATE;
  private readonly listeners = new Set<() => void>();

  private parts: ScreenParts | null = null;
  /** Each `attach` is a new life: work begun in an earlier one is dropped when it comes back. */
  private life = 0;
  private wishes: Wishes = { ...DEFAULT_WISHES };
  private host: HostSettings | null = null;
  private hostTrouble = '';
  /** Changes of ours the PC has not answered yet, and when it last answered one. */
  private asking = 0;
  private lastAnswered = 0;
  private screenHz: number | null = null;
  private measuringHz: Promise<void> | null = null;
  private screenWas = '';
  private problem = '';
  private numbers = FIRST_STATE.numbers;
  private readout = FIRST_STATE.readout;

  private connection: ScreenConnection | null = null;
  private drawing: ScreenDrawing | null = null;
  private control: ScreenControl | null = null;
  private pointerShape: ScreenPointerShape | null = null;
  /** SOUND: the stream's sound line once it has arrived, whether it is playing here, and why not. */
  private soundTrack: MediaStreamTrack | null = null;
  private soundOn = false;
  private soundNote = '';
  /** Sound left on at the last visit is asked for again once, when the PC can be told and this device is known not to be the PC. */
  private soundResumed = false;
  private keysOpen = false;
  private thisPc: boolean | null = null;
  private route: NetRoute | null = null;
  private resizeWatch: ResizeObserver | null = null;
  private readoutTimer = 0;
  private hostTimer = 0;

  /* --- for the component ------------------------------------------------------------------------ */

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getState = (): ScreenState => this.state;

  private readonly emit = (): void => {
    const drawing = this.drawing;
    const control = this.control;
    this.state = {
      wishes: this.wishes,
      host: this.host,
      hostTrouble: this.hostTrouble,
      here: this.parts === null ? NO_SCREEN : thisScreen(),
      screenHz: this.screenHz,
      drawingShown: drawing?.shown ?? 'normal',
      drawingNote: drawing?.note ?? '',
      upscalingShown: drawing?.upscalingShown ?? 'smooth',
      upscalingNote: drawing?.upscalingNote ?? '',
      numbers: this.numbers,
      readout: this.readout,
      problem: this.problem,
      fullscreen: this.parts !== null && inFullscreen(this.parts.root),
      control: {
        mine: control?.mine ?? false,
        note: control?.note ?? '',
        pointerLocked: control?.pointerLocked ?? false,
        escHolding: control?.escHolding ?? false,
        keyboardLocked: control?.keyboardLocked ?? false,
        canLockKeyboard: this.parts !== null && canLockKeyboard(),
      },
      thisPc: this.thisPc,
      route: this.route,
      sound: { on: this.soundOn, note: this.soundNote },
      pad: control?.padSeen() ?? FIRST_STATE.pad,
      pointerWhy: this.pointerShape?.use === 'arrow' ? this.pointerShape.why : '',
    };
    for (const listener of this.listeners) listener();
  };

  private alive(life: number): boolean {
    return this.parts !== null && this.life === life;
  }

  /* --- START: draw from what is remembered, measure this screen, connect, keep the readouts fresh -- */

  attach(parts: ScreenParts): void {
    if (this.parts !== null) this.detach();
    this.life += 1;
    this.parts = parts;
    this.wishes = readWishes();
    // What the site said when it offered the SCREEN key, until the PC is asked again.
    this.host = screenHostNow(this.engine).settings;
    this.hostTrouble = '';
    this.problem = '';
    this.asking = 0;
    this.lastAnswered = 0;
    this.numbers = FIRST_STATE.numbers;
    this.readout = FIRST_STATE.readout;
    this.soundTrack = null;
    this.soundOn = false;
    this.soundNote = '';
    this.soundResumed = false;
    this.keysOpen = false;
    this.thisPc = null;
    this.route = null;

    // The PC's pointer is drawn at the picture's scale, so it is set again whenever the picture moves or changes size.
    this.drawing = new ScreenDrawing(
      parts,
      () => {
        this.pointerShape?.show();
        this.emit();
      },
      () => undefined,
    );
    this.pointerShape = new ScreenPointerShape({
      stage: parts.stage,
      pointing: () => (this.control?.mine ?? false) && this.wishes.mouse === 'pointer',
      pictureBox: () => this.drawing?.pictureBox() ?? null,
      regionWidth: () => this.host?.sending?.regionWidth ?? 0,
    });
    this.control = new ScreenControl({
      stage: parts.stage,
      sendKeys: (bytes) => this.connection?.sendKeys(bytes) ?? false,
      sendPointer: (bytes) => this.connection?.sendPointer(bytes) ?? false,
      pictureBox: () => this.drawing?.pictureBox() ?? null,
      mouse: () => this.wishes.mouse,
      onChange: this.emit,
      onStanding: () => void this.readHost(),
      onPointing: () => this.pointerShape?.show(),
      onPointerShown: (shown) => {
        this.pointerShape?.heardShown(shown);
        this.emit();
      },
      onPointerShape: (shape) => {
        this.pointerShape?.heardShape(shape);
        this.emit();
      },
      onSoundSays: (what) => this.pcSaysSound(what),
    });
    this.control.attach();
    this.drawing.show(this.wishes.drawing, this.wishes.upscaling);

    // The stream changes size when its settings change, and the picture's box can change size (the window, the
    // room's side column, fullscreen): each moves the picture.
    parts.video.addEventListener('resize', this.redraw);
    window.addEventListener('resize', this.redraw);
    this.resizeWatch = new ResizeObserver(this.redraw);
    this.resizeWatch.observe(parts.stage);
    // A different screen may show a different number of frames a second: measured again when the picture goes
    // fullscreen or comes back, when the browser says the screen changed, and (looked at every few seconds, with
    // the PC's settings) when the window has moved to another screen.
    document.addEventListener('fullscreenchange', this.onFullscreen);
    screenEvents()?.addEventListener('change', this.onScreenChange);

    void this.measureScreenHz();
    this.connect();
    this.readoutTimer = window.setInterval(() => void this.showReadout(), 1000);
    // What the PC is really sending can change under us (a cap coming on, another of the owner's devices), so it is
    // read again often.
    this.hostTimer = window.setInterval(() => {
      if (this.connection?.connected) void this.readHost();
      if (whichScreen() !== this.screenWas) void this.measureScreenHz();
    }, 3000);
    this.emit();
  }

  /** Lets go of everything: control (the PC is told), the connection, the drawing, every listener and timer. */
  detach(): void {
    const parts = this.parts;
    if (parts === null) return;
    this.life += 1;
    window.clearInterval(this.readoutTimer);
    window.clearInterval(this.hostTimer);
    parts.video.removeEventListener('resize', this.redraw);
    window.removeEventListener('resize', this.redraw);
    this.resizeWatch?.disconnect();
    this.resizeWatch = null;
    document.removeEventListener('fullscreenchange', this.onFullscreen);
    screenEvents()?.removeEventListener('change', this.onScreenChange);
    // Control first, while its channel is still open, so the PC hears "I am letting go" (and is given a moment to).
    const held = (this.control?.mine ?? false) || this.soundOn;
    // The PC stops reading its own sound when the last listener says it no longer wants it.
    if (this.soundOn) this.connection?.sendKeys(soundMessage(false));
    this.soundOn = false;
    parts.audio.pause();
    parts.audio.srcObject = null;
    this.soundTrack = null;
    this.pointerShape?.stop();
    this.pointerShape = null;
    this.control?.detach();
    this.connection?.stop(held ? LAST_WORDS_MS : 0);
    this.drawing?.stop();
    parts.video.srcObject = null;
    if (document.fullscreenElement === parts.root) void document.exitFullscreen().catch(() => undefined);
    this.control = null;
    this.connection = null;
    this.drawing = null;
    this.measuringHz = null;
    this.parts = null;
    this.emit();
  }

  private connect(): void {
    const parts = this.parts;
    if (parts === null) return;
    const life = this.life;
    this.problem = '';
    const connection = new ScreenConnection({
      engine: this.engine,
      onTrack: (track, stream) => {
        if (!this.alive(life)) return;
        parts.video.srcObject = stream;
        parts.video.play().catch(() => {
          /* muted autoplay is allowed; if a browser still refuses, a click starts it */
        });
        this.drawing?.setTrack(track);
      },
      onSound: (track, stream) => {
        if (!this.alive(life)) return;
        this.soundTrack = track;
        parts.audio.srcObject = stream;
        this.resumeSound();
      },
      onKeysOpen: () => {
        if (!this.alive(life)) return;
        this.keysOpen = true;
        this.resumeSound();
      },
      onConnected: () => {
        // Now that the picture is on its way, tell the PC what this device wants of it. AUTO needs this screen's
        // own rate, so a measuring of it that is still going is waited for first.
        void (this.measuringHz ?? Promise.resolve()).then(() => {
          if (!this.alive(life)) return;
          // FIT, left on at the last visit, is asked for on its own, once the PC has said it allows it, so a PC that
          // does not know of it is never sent it.
          quietly(this.ask(wishesForThePc(this.wishes)).then((host) => {
            if (this.alive(life) && this.wishes.fit && host?.pcScreen?.allowed && !host.pcScreen.yours) return this.ask({ pcScreen: 'fit' });
            return host;
          }));
        });
        // The connection has chosen its path: whether this device is the PC itself can be read from it now.
        void this.showReadout();
      },
      onProblem: (why) => {
        if (!this.alive(life)) return;
        this.problem = why;
        void this.showReadout();
      },
      onPcSays: (bytes) => this.control?.heard(bytes),
      onKeysClosed: () => this.control?.channelClosed(),
    });
    this.connection = connection;
    connection.start().catch((error: unknown) => {
      if (!this.alive(life) || this.connection !== connection) return;
      this.problem = `could not connect: ${error instanceof Error && error.message ? error.message : String(error)}`;
      void this.showReadout();
    });
  }

  /** `[ TRY AGAIN ]`, after the connection failed: everything is let go of and begun afresh. */
  tryAgain(): void {
    const parts = this.parts;
    if (parts === null) return;
    this.detach();
    this.attach(parts);
  }

  private readonly redraw = (): void => {
    this.drawing?.show(this.wishes.drawing, this.wishes.upscaling);
  };

  private readonly onFullscreen = (): void => {
    void this.measureScreenHz();
    this.emit();
  };

  private readonly onScreenChange = (): void => {
    void this.measureScreenHz();
  };

  /* --- SETTINGS: what the PC sends -------------------------------------------------------------- */

  /**
   * How many frames a second this device's own screen shows, which is what AUTO sends. A browser does not say, so
   * it is measured: the page asks to be called once per screen refresh a few dozen times (`rateFromGaps` does the sum).
   */
  private measureScreenHz(): Promise<void> {
    if (this.measuringHz !== null) return this.measuringHz;
    const life = this.life;
    this.screenWas = whichScreen();
    const measuring = new Promise<number | null>((resolve) => {
      const gaps: number[] = [];
      let before = 0;
      let over = false;
      // A hidden tab is not called at all: give up after a while and keep what was known.
      const giveUp = window.setTimeout(() => {
        over = true;
        resolve(null);
      }, 2500);
      const tick = (now: number) => {
        if (over) return;
        if (!this.alive(life)) {
          window.clearTimeout(giveUp);
          resolve(null);
          return;
        }
        if (before) gaps.push(now - before);
        before = now;
        if (gaps.length < RATE_GAPS) {
          window.requestAnimationFrame(tick);
          return;
        }
        window.clearTimeout(giveUp);
        resolve(rateFromGaps(gaps));
      };
      window.requestAnimationFrame(tick);
    }).then((hz) => {
      if (!this.alive(life)) return;
      this.measuringHz = null;
      const changed = hz !== null && hz !== this.screenHz;
      if (hz !== null) this.screenHz = hz;
      this.emit();
      // On AUTO, a screen with a different rate (the window moved to another screen) is a new request to the PC.
      if (changed && this.wishes.fps === 'auto' && this.connection?.connected) quietly(this.ask({ fps: 'auto' }));
    });
    this.measuringHz = measuring;
    return measuring;
  }

  private async talkToHost(change: SettingsRequest | null): Promise<HostSettings | null> {
    const life = this.life;
    const changing = change !== null;
    const began = performance.now();
    if (changing) this.asking += 1;
    let answer: SettingsAnswer;
    try {
      answer = await talkToSettings(this.connection?.viewer ?? null, change, this.engine);
    } catch {
      if (!this.alive(life)) return null;
      this.hostTrouble = 'The PC could not be reached for its settings.';
      this.emit();
      throw new Error(this.hostTrouble);
    } finally {
      if (changing && this.alive(life)) {
        this.asking -= 1;
        this.lastAnswered = performance.now();
      }
    }
    if (!this.alive(life)) return null;
    // A plain reading that set off before a change of ours was answered is old news by now: it is dropped, so the
    // panel never steps back to what was being sent before the change.
    if (!changing && (this.asking > 0 || began < this.lastAnswered)) return this.host;
    if (!answer.ok) {
      this.hostTrouble = `The PC would not take that: ${answer.why}`;
      this.emit();
      throw new Error(this.hostTrouble);
    }
    this.hostTrouble = '';
    this.host = answer.settings;
    // The PC put its own screen back from its keyboard and forgot every wish for a fit: so does this device, or the
    // next press of the switch would take the wish away instead of asking again.
    const pc = this.host.pcScreen;
    if (pc && !pc.yours && this.wishes.fit && (pc.why ?? '').includes('PUT BACK AT THE PC')) this.keep({ ...this.wishes, fit: false });
    // The piece of the PC's screen being sent may have changed, and with it the scale its pointer is drawn at.
    this.pointerShape?.show();
    this.resumeSound();
    this.emit();
    return this.host;
  }

  /** Reads what the PC is sending now (also done every few seconds, so a change made elsewhere shows here). */
  readHost(): Promise<HostSettings | null> {
    return this.talkToHost(null).catch(() => null);
  }

  /**
   * Asks the PC for a change. `partial` names only what changes. Every key in the panel goes through here. It
   * answers with what the PC says it is really sending afterwards.
   */
  private ask(partial: SettingsRequest): Promise<HostSettings | null> {
    const request = requestFor(partial, thisScreen(), this.screenHz);
    this.wishes = wishesAfter(this.wishes, request);
    rememberWishes(this.wishes);
    this.emit();
    return this.talkToHost(request);
  }

  /** A key in the panel: a change asked of the PC. Why it could not be made, when it could not, shows in the panel. */
  change(partial: SettingsRequest): void {
    if (this.parts !== null) quietly(this.ask(partial));
  }

  /** `[ FIT THE PC TO THIS SCREEN ]`: this device's own wish decides (the PC's last answer may be seconds old). */
  toggleFit(): void {
    this.change({ pcScreen: this.wishes.fit ? 'own' : 'fit' });
  }

  /** `[ MATCH THIS SCREEN ]`: on, the PC sends this screen's shape; off, the shape last chosen by hand. */
  toggleMatch(): void {
    this.change({ shape: askedNow(this.host, this.wishes).shape === 'match' ? this.wishes.shape : 'match' });
  }

  /* --- DRAWING, READOUT, WINDOW: only on this device -------------------------------------------- */

  private keep(next: Wishes): void {
    this.wishes = next;
    rememberWishes(next);
  }

  setDrawing(drawing: Drawing): void {
    this.keep({ ...this.wishes, drawing });
    this.redraw();
    this.emit();
  }

  setUpscaling(upscaling: Upscaling): void {
    this.keep({ ...this.wishes, upscaling });
    this.redraw();
    this.emit();
  }

  toggleNumbers(): void {
    this.keep({ ...this.wishes, numbers: !this.wishes.numbers });
    this.emit();
  }

  toggleFullscreen(): void {
    const parts = this.parts;
    if (parts === null) return;
    // The key press is the "user gesture" a browser wants before it will go fullscreen.
    const going = inFullscreen(parts.root) ? document.exitFullscreen() : parts.root.requestFullscreen();
    going.catch(() => {
      /* refused by the browser: the key simply stays unpressed */
    });
  }

  // Once a second.
  private async showReadout(): Promise<void> {
    const life = this.life;
    const control = this.control;
    const connection = this.connection;
    if (control === null || connection === null) return;
    control.tick();
    if (this.problem) {
      this.numbers = this.problem;
      this.readout = this.problem;
      this.emit();
      return;
    }
    let s: StreamStats;
    try {
      s = await connection.stats();
    } catch {
      return; /* the next second tries again */
    }
    if (!this.alive(life)) return;
    this.learnWhetherThisIsThePc(s.reachedOnThisMachine);
    if (s.route !== null && s.route !== this.route) {
      this.route = s.route;
      this.emit();
    }
    const drawing = this.drawing;
    const way = (drawing?.shown ?? 'normal').toUpperCase();
    if (!s.framesDecoded) {
      this.numbers = `connecting (${s.connectionState})`;
      this.readout = `No picture yet (${s.connectionState}).`;
      this.emit();
      return;
    }
    this.numbers =
      `${s.frameWidth}x${s.frameHeight}  ${shown(s.framesPerSecond, 0)} frames/s  ${s.mimeType ?? ''}\n` +
      `wait in buffer ${shown(s.jitterBufferDelayMsPerFrame, 1)} ms  decode ${shown(s.decodeMsPerFrame, 1)} ms  arrival to ready ${shown(s.processingDelayMsPerFrame, 1)} ms\n` +
      `frames ${s.framesDecoded}  dropped ${s.framesDropped}  packets lost ${s.packetsLost}  resends asked ${s.nackCount}  full pictures asked ${s.pliCount}\n` +
      `decoder ${s.decoderImplementation ?? '-'}  drawn ${way}`;
    const measured = this.host?.measured ?? null;
    const pc = measured !== null && typeof measured.shownToEncodedMs === 'number' ? `${measured.shownToEncodedMs.toFixed(1)} ms` : 'not known (a still screen, or no answer yet)';
    this.readout =
      `The stream            ${s.frameWidth}x${s.frameHeight}, ${shown(s.framesPerSecond, 0)} frames a second\n` +
      `In this browser's queue ${shown(s.jitterBufferDelayMsPerFrame, 1)} ms a frame\n` +
      `Decoding              ${shown(s.decodeMsPerFrame, 1)} ms a frame\n` +
      `Lost packets          ${s.packetsLost}\n` +
      `Drawn                 ${way}${drawing?.shown === 'fast' ? (drawing.lowLatency ? ", skipping the browser's drawing queue" : ', but this browser kept its drawing queue') : ''}\n` +
      `On the PC, shown to encoded ${pc}` +
      (this.soundOn ? `\nSound                 ${s.sound.mimeType ?? 'on'}, ${shown(s.sound.jitterBufferDelayMsPerSample, 0)} ms in this browser's queue, ${s.sound.packetsLost} packets lost` : '') +
      (control.mine ? `\nInput sent            ${control.sentRate} messages a second` : '');
    this.emit();
  }

  /* --- SOUND: what the PC is playing -------------------------------------------------------------- */
  //
  // Off until this device asks: the PC does not even read its own sound until a viewer wants it. The sound is
  // everything the PC plays (its Windows cannot leave one program out). It has an element and a volume of its own:
  // it is never joined to the room's own players, the music bar or the sound graph, which carry on untouched.
  // On the PC itself it is not offered, because the PC would hear this page and send that too, round and round.

  /**
   * Whether this device is the PC itself. The engine's own page reads its address for this; in a room the browser
   * never has the engine's address, so the connection says: when its far end is on this very machine, this is the PC.
   * (`pretendNotThisPc` is the local drive's one way round it, and does nothing on a real server.)
   */
  private learnWhetherThisIsThePc(reachedOnThisMachine: boolean | null): void {
    const now = reachedOnThisMachine === null ? null : reachedOnThisMachine && !pretendNotThisPc();
    if (now === null || now === this.thisPc) return;
    this.thisPc = now;
    if (now && this.soundOn) this.turnSound(false, false);
    this.resumeSound();
  }

  /** Sound that was left on at the last visit is asked for again, once, as soon as the PC can be told. */
  private resumeSound(): void {
    if (this.soundResumed || !this.wishes.sound || !this.keysOpen || this.soundTrack === null) return;
    if (!soundOffered(this.host, this.thisPc)) return;
    this.soundResumed = true;
    this.turnSound(true, false);
  }

  private tellPcSound(on: boolean): void {
    this.connection?.sendKeys(soundMessage(on));
  }

  /**
   * Turns the sound on or off. `byPress` is true when a person pressed a key for it: that is remembered on this
   * device, and it is also what a browser wants before it will play anything.
   */
  private turnSound(on: boolean, byPress: boolean): void {
    const parts = this.parts;
    if (parts === null) return;
    if (on && !soundOffered(this.host, this.thisPc)) return;
    if (byPress) {
      this.keep({ ...this.wishes, sound: on });
      this.soundResumed = true;
    }
    this.soundNote = '';
    if (!on) {
      this.soundOn = false;
      parts.audio.pause();
      this.tellPcSound(false);
      this.emit();
      return;
    }
    if (this.soundTrack === null) {
      this.soundNote = 'NOT CONNECTED YET';
      this.emit();
      return;
    }
    const life = this.life;
    parts.audio.volume = this.wishes.volume;
    this.soundOn = true;
    this.tellPcSound(true);
    this.emit();
    parts.audio.play().catch(() => {
      if (!this.alive(life) || !this.soundOn) return;
      // The browser will not play sound that nobody pressed a key for (sound left on at the last visit): the PC
      // is told to stop, and the key waits to be pressed.
      this.soundOn = false;
      this.soundNote = SOUND_WANTS_A_PRESS;
      this.tellPcSound(false);
      this.emit();
    });
  }

  /** The PC's answer to being asked: 0 off, 1 on its way, 2 it is not sending sound. */
  private pcSaysSound(what: number): void {
    if (what !== 2) return;
    this.soundOn = false;
    this.parts?.audio.pause();
    this.soundNote = SOUND_NOT_SENT;
    this.emit();
  }

  /** `[ SOUND ]`, `[ SOUND ON ]`, `[ SOUND OFF ]`. */
  setSound(on: boolean): void {
    this.turnSound(on, true);
  }

  toggleSound(): void {
    this.turnSound(!this.soundOn, true);
  }

  /** The volume is this device's own: it changes how loud the sound's element plays, and nothing on the PC. */
  setVolume(volume: number): void {
    const to = Math.min(1, Math.max(0, volume));
    this.keep({ ...this.wishes, volume: to });
    if (this.parts !== null) this.parts.audio.volume = to;
    this.emit();
  }

  /* --- CONTROL ----------------------------------------------------------------------------------- */

  /** `[ CONTROL ]` / `[ RELEASE ]`. */
  toggleControl(): void {
    const control = this.control;
    if (control === null) return;
    if (control.mine) control.release();
    else control.take();
  }

  setMouse(mouse: Mouse): void {
    this.keep({ ...this.wishes, mouse });
    this.control?.mouseChanged();
    this.pointerShape?.show();
    this.emit();
  }
}
