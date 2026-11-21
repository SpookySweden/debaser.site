/**
 * SCREENS' settings model (SPEC-screens.md, "Settings in the viewport"), ported from the engine's own viewer page
 * (`engine/web/viewer.html`, its BASICS and SETTINGS parts): what this device wishes for, what it remembers, what it
 * asks of the PC, and the words the panel says about what the PC answers. No page and no network here.
 *
 * The settings belong to the stream, not to a viewer: one encoder on the PC serves everyone watching, so the last
 * change wins, and the panel always shows what the PC says it is really sending.
 */

export const SHAPES = ['native', '16:9', '16:10', '21:9', '4:3'] as const;
export const LINES = [720, 1080, 1440, 'native'] as const;
export const RATES = ['auto', 30, 60, 120, 180] as const;
export const DRAWINGS = ['fast', 'normal'] as const;
export const UPSCALINGS = ['off', 'smooth', 'sharp', 'sharpened'] as const;
export const MICE = ['pointer', 'game'] as const;

export type Shape = (typeof SHAPES)[number];
export type Lines = (typeof LINES)[number];
export type Fps = (typeof RATES)[number];
export type Drawing = (typeof DRAWINGS)[number];
export type Upscaling = (typeof UPSCALINGS)[number];
export type Mouse = (typeof MICE)[number];

/** What this device last chose. */
export type Wishes = {
  match: boolean;
  shape: Shape;
  lines: Lines;
  fps: Fps;
  bitrateKbps: number;
  drawing: Drawing;
  upscaling: Upscaling;
  numbers: boolean;
  mouse: Mouse;
  /** The PC's sound, wanted on this device or not, and how loud this device plays it (0 to 1). */
  sound: boolean;
  volume: number;
};

export const DEFAULT_WISHES: Wishes = { match: false, shape: 'native', lines: 1080, fps: 'auto', bitrateKbps: 20000, drawing: 'fast', upscaling: 'smooth', numbers: true, mouse: 'pointer', sound: false, volume: 1 };

const among = <T>(list: readonly T[], value: unknown): value is T => list.includes(value as T);

/** Whatever was kept, made safe: each wish is taken only when it is one of the choices, the defaults otherwise. */
export function wishesFrom(kept: unknown): Wishes {
  const wishes = { ...DEFAULT_WISHES };
  if (typeof kept !== 'object' || kept === null) return wishes;
  const was = kept as Record<string, unknown>;
  if (typeof was.match === 'boolean') wishes.match = was.match;
  if (among(SHAPES, was.shape)) wishes.shape = was.shape;
  if (among(LINES, was.lines)) wishes.lines = was.lines;
  if (among(RATES, was.fps)) wishes.fps = was.fps;
  if (typeof was.bitrateKbps === 'number' && Number.isFinite(was.bitrateKbps) && was.bitrateKbps >= 1000) wishes.bitrateKbps = Math.round(was.bitrateKbps);
  if (among(DRAWINGS, was.drawing)) wishes.drawing = was.drawing;
  if (among(UPSCALINGS, was.upscaling)) wishes.upscaling = was.upscaling;
  if (typeof was.numbers === 'boolean') wishes.numbers = was.numbers;
  if (among(MICE, was.mouse)) wishes.mouse = was.mouse;
  if (typeof was.sound === 'boolean') wishes.sound = was.sound;
  if (typeof was.volume === 'number' && Number.isFinite(was.volume) && was.volume >= 0 && was.volume <= 1) wishes.volume = was.volume;
  return wishes;
}

/** Where this browser keeps them. Remembered per watching device, in that browser's own storage and nowhere else. */
// v2 (2026-11-21, Luke: "have it render normally to start with, not cropped either"): the picture starts as the PC's
// whole screen, and what a device remembered under v1 (where it started cut to this screen's shape) is left behind.
export const WISHES_STORE = 'debaser.screens.viewer.v2';

/** The page works the same when the browser refuses to remember (private windows, blocked storage): the defaults, every time. */
export function readWishes(): Wishes {
  try {
    return wishesFrom(JSON.parse(window.localStorage.getItem(WISHES_STORE) ?? 'null'));
  } catch {
    return { ...DEFAULT_WISHES };
  }
}

export function rememberWishes(wishes: Wishes): void {
  try {
    window.localStorage.setItem(WISHES_STORE, JSON.stringify(wishes));
  } catch {
    /* not allowed to remember: carry on */
  }
}

/* --- asking the PC ------------------------------------------------------------------------------- */

/** A change asked of the PC: only what it names changes. */
export type SettingsRequest = {
  shape?: Shape | 'match';
  lines?: Lines;
  fps?: Fps;
  bitrateKbps?: number;
  /** This screen in real pixels, for `match`. */
  viewWidth?: number;
  viewHeight?: number;
  /** How many frames a second this screen shows, for `auto`. */
  viewHz?: number;
};

export type ThisScreen = { viewWidth: number; viewHeight: number };

/** Everything this device wants of the PC, from what it remembers. */
export function wishesForThePc(wishes: Wishes): SettingsRequest {
  return { shape: wishes.match ? 'match' : wishes.shape, lines: wishes.lines, fps: wishes.fps, bitrateKbps: wishes.bitrateKbps };
}

/**
 * The request as it is sent: MATCH goes with this screen's size, and AUTO with this screen's own rate (60 until it
 * has been measured), unless the caller names another.
 */
export function requestFor(partial: SettingsRequest, here: ThisScreen, screenHz: number | null): SettingsRequest {
  const request = { ...partial };
  if (request.shape === 'match') {
    if (!request.viewWidth) request.viewWidth = here.viewWidth;
    if (!request.viewHeight) request.viewHeight = here.viewHeight;
  }
  if (request.fps === 'auto' && !request.viewHz) request.viewHz = screenHz || 60;
  return request;
}

/** What this device wishes for once it has asked for `request`. */
export function wishesAfter(wishes: Wishes, request: SettingsRequest): Wishes {
  const next = { ...wishes };
  if (request.shape !== undefined) {
    next.match = request.shape === 'match';
    if (request.shape !== 'match') next.shape = request.shape;
  }
  if (request.lines !== undefined) next.lines = request.lines;
  if (request.fps !== undefined) next.fps = request.fps;
  if (request.bitrateKbps !== undefined) next.bitrateKbps = request.bitrateKbps;
  return next;
}

/* --- this screen's own rate ---------------------------------------------------------------------- */

/** A screen's rate is nearly always one of these, so a measurement within 1% of one is taken to be it. */
export const KNOWN_RATES: readonly number[] = [24, 25, 30, 48, 50, 60, 72, 75, 85, 90, 100, 120, 144, 165, 170, 175, 180, 200, 240, 280, 300, 360, 480, 500, 540];
/** How many gaps between screen refreshes one measurement takes. */
export const RATE_GAPS = 60;

/**
 * How many frames a second a screen shows, from the gaps (in milliseconds) between a few dozen of its refreshes: the
 * middle gap is found, and the gaps near it averaged (a browser's clock is coarse, and one late call must not
 * count). Null when the gaps say nothing.
 */
export function rateFromGaps(gaps: readonly number[]): number | null {
  if (gaps.length === 0) return null;
  const sorted = [...gaps].sort((a, b) => a - b);
  const middle = sorted[sorted.length >> 1];
  const near = sorted.filter((gap) => Math.abs(gap - middle) <= middle * 0.2);
  if (!(middle > 0) || near.length === 0) return null;
  const rate = 1000 / (near.reduce((sum, gap) => sum + gap, 0) / near.length);
  const known = KNOWN_RATES.find((one) => Math.abs(rate - one) <= one * 0.01);
  return Math.max(24, Math.round(known ?? rate));
}

/* --- what the PC answers ------------------------------------------------------------------------- */

export type HostLimits = { maxLines: number; maxFps: number; maxBitrateKbps: number };

/** The engine's `/settings` answer (engine/src/serve.rs, `settings_json`). */
export type HostSettings = {
  asked: { shape: string; viewWidth: number | null; viewHeight: number | null; lines: number | 'native'; fps: number | 'auto'; viewHz: number | null; bitrateKbps: number };
  sending: { x: number; y: number; regionWidth: number; regionHeight: number; width: number; height: number; scaled: boolean; fps: number; bitrateKbps: number; codec: string } | null;
  measured: { framesPerSecond: number; newFramesPerSecond: number; kbitPerSecond: number; shownToEncodedMs: number | null } | null;
  screen: { width: number; height: number; hz: number };
  limits: HostLimits;
  hostLimits: HostLimits;
  cap: string | null;
  capWhy: string | null;
  applied: boolean;
  refused: string | null;
  viewers: number;
  /** How control stands for the viewer asking: "off", "free", "yours" or "another device". */
  control: string;
  controlWhy: string | null;
  controlDryRun: boolean;
  /** The pretend controller on the PC: "off" (control is not allowed), "none" or "plugged in"; and why not, when it could not be. */
  controller: string;
  controllerWhy: string | null;
  /** The PC's sound; null from an older engine that sends none. */
  sound: HostSound | null;
  /** The PC's own pointer; null from an older engine. */
  pointer: { shown: boolean; shape: number; width: number; height: number } | null;
};

/** What the PC says of its sound (`/settings`, "sound"). `heard` is "sound", "silence" or nothing yet. */
export type HostSound = { allowed: boolean; listeners: number; capturing: boolean; source: string | null; heard: string | null; packetsSent: number; problem: string | null };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function hostSoundFrom(value: unknown): HostSound | null {
  if (!isRecord(value)) return null;
  const text = (name: string): string | null => (typeof value[name] === 'string' ? (value[name] as string) : null);
  const count = (name: string): number => (typeof value[name] === 'number' ? (value[name] as number) : 0);
  return { allowed: value.allowed === true, listeners: count('listeners'), capturing: value.capturing === true, source: text('source'), heard: text('heard'), packetsSent: count('packetsSent'), problem: text('problem') };
}
const numbersIn = (value: unknown, names: readonly string[]): boolean => isRecord(value) && names.every((name) => typeof value[name] === 'number' && Number.isFinite(value[name] as number));
const LIMIT_NAMES = ['maxLines', 'maxFps', 'maxBitrateKbps'] as const;

/** The answer when it has the parts the panel reads, null when it is something else. */
export function hostSettingsFrom(value: unknown): HostSettings | null {
  if (!isRecord(value)) return null;
  const { asked, sending, measured } = value;
  if (!isRecord(asked) || typeof asked.shape !== 'string' || typeof asked.bitrateKbps !== 'number') return null;
  if (typeof asked.lines !== 'number' && asked.lines !== 'native') return null;
  if (typeof asked.fps !== 'number' && asked.fps !== 'auto') return null;
  if (!numbersIn(value.screen, ['width', 'height', 'hz']) || !numbersIn(value.limits, LIMIT_NAMES) || !numbersIn(value.hostLimits, LIMIT_NAMES)) return null;
  if (sending !== null && !(numbersIn(sending, ['x', 'y', 'regionWidth', 'regionHeight', 'width', 'height', 'fps', 'bitrateKbps']) && isRecord(sending) && typeof sending.codec === 'string')) return null;
  if (measured !== null && !numbersIn(measured, ['framesPerSecond', 'newFramesPerSecond', 'kbitPerSecond'])) return null;
  if (typeof value.control !== 'string') return null;
  const text = (name: string): string | null => (typeof value[name] === 'string' ? (value[name] as string) : null);
  return {
    asked: asked as HostSettings['asked'],
    sending: sending as HostSettings['sending'],
    measured: measured as HostSettings['measured'],
    screen: value.screen as HostSettings['screen'],
    limits: value.limits as HostLimits,
    hostLimits: value.hostLimits as HostLimits,
    cap: text('cap'),
    capWhy: text('capWhy'),
    applied: value.applied !== false,
    refused: text('refused'),
    viewers: typeof value.viewers === 'number' ? value.viewers : 0,
    control: value.control,
    controlWhy: text('controlWhy'),
    controlDryRun: value.controlDryRun === true,
    controller: typeof value.controller === 'string' ? value.controller : 'off',
    controllerWhy: text('controllerWhy'),
    sound: hostSoundFrom(value.sound),
    pointer: numbersIn(value.pointer, ['shape', 'width', 'height']) ? { ...(value.pointer as { shape: number; width: number; height: number }), shown: (value.pointer as { shown?: unknown }).shown !== false } : null,
  };
}

/** What is asked for now: what the PC says, or what this device remembers until it has said anything. */
export function askedNow(host: HostSettings | null, wishes: Wishes): { shape: string; lines: number | 'native'; fps: number | 'auto'; bitrateKbps: number } {
  if (host !== null) return host.asked;
  return { shape: wishes.match ? 'match' : wishes.shape, lines: wishes.lines, fps: wishes.fps, bitrateKbps: wishes.bitrateKbps };
}

/** Choices the PC could never give (more frames a second than its screen shows, more lines than it has) are not offered. AUTO and NATIVE always are. */
export function rateOffered(rate: Fps, host: HostSettings | null): boolean {
  return rate === 'auto' || host === null || rate <= host.hostLimits.maxFps;
}

export function linesOffered(lines: Lines, host: HostSettings | null): boolean {
  return lines === 'native' || host === null || lines <= host.hostLimits.maxLines;
}

/** The bitrate slider's range, in Mbit/s. */
export const BITRATE_MIN_MBIT = 2;
export function bitrateMaxMbit(host: HostSettings | null): number {
  return host === null ? 50 : Math.max(BITRATE_MIN_MBIT, Math.floor(host.hostLimits.maxBitrateKbps / 1000));
}

/* --- the panel's words --------------------------------------------------------------------------- */

export const megabits = (kbps: number): string => `${(kbps / 1000).toFixed(kbps % 1000 === 0 ? 0 : 1)} Mbit/s`;

export function matchSays(here: ThisScreen): string {
  return `The PC sends the middle of its screen in the shape of this screen (${here.viewWidth}x${here.viewHeight}), so on an ultrawide PC the two sides are cut off. Nothing on the PC itself changes: its own screen, and whatever is running on it, stay as they are.`;
}

export function rateSays(fps: number | 'auto', screenHz: number | null): string {
  const measured = screenHz ? `This screen shows ${screenHz} frames a second (measured here).` : "This screen's own rate is still being measured.";
  return fps === 'auto' ? `AUTO follows this screen. ${measured} The PC sends that many when its own screen and its limits allow.` : measured;
}

export const WAITING_FOR_THE_PC = 'Waiting for the PC to say what it is sending.';

export function reallySending(host: HostSettings | null): string {
  if (host === null || host.sending === null) return WAITING_FOR_THE_PC;
  const s = host.sending;
  const whole = s.regionWidth + 1 >= host.screen.width && s.regionHeight + 1 >= host.screen.height;
  return (
    `REALLY SENDING: ${s.width}x${s.height}, up to ${s.fps} frames a second, ${megabits(s.bitrateKbps)}, ${s.codec}\n` +
    (whole ? `All of the PC's ${host.screen.width}x${host.screen.height} screen` : `The middle ${s.regionWidth}x${s.regionHeight} of the PC's ${host.screen.width}x${host.screen.height} screen`) +
    (s.scaled ? ', made smaller on the PC.' : ', as it is.') +
    (host.measured ? `\nLast second: ${host.measured.framesPerSecond.toFixed(0)} frames (${host.measured.newFramesPerSecond.toFixed(0)} of them new), ${megabits(Math.round(host.measured.kbitPerSecond))}.` : '')
  );
}

/** Said when the PC has capped the stream (a League match); null when it has not. */
export function capSays(host: HostSettings | null): string | null {
  if (host === null || host.sending === null || host.cap === null) return null;
  return `CAPPED BY THE PC: ${host.cap}\n${host.capWhy ?? ''}. While it is, the PC sends at most ${host.limits.maxLines} lines, ${host.limits.maxFps} frames a second, ${megabits(host.limits.maxBitrateKbps)}. What was asked for comes back when it ends.`;
}

export function troubleLines(host: HostSettings | null, hostTrouble: string): string[] {
  const lines: string[] = [];
  if (hostTrouble) lines.push(hostTrouble);
  if (host !== null && host.refused) lines.push(`The PC's encoder refused the last change and carried on as before: ${host.refused}`);
  if (host !== null && !host.applied) lines.push('The PC has not made the last change yet.');
  return lines;
}

const ANOTHER_DEVICE = 'ANOTHER DEVICE HAS CONTROL';

/** The panel's line about how control stands. */
export function controlStateSays(host: HostSettings | null, mine: boolean, note: string): string {
  if (host === null) return 'Waiting for the PC to say whether it allows control.';
  if (host.control === 'off') return 'THIS PC IS NOT ALLOWING CONTROL\nIt allows it only when its engine is started with --allow-control.';
  if (mine) return `THIS DEVICE HAS CONTROL of the PC's mouse and keys.${host.controlDryRun ? '\nDRY RUN: the PC is only writing down what would be done.' : ''}`;
  if (host.controlWhy) return `${host.controlWhy}\nThe PC refuses control while a match runs.`;
  if (host.control === 'another device') return `${ANOTHER_DEVICE}\nOne device at a time; it is free again when that one lets go.`;
  return `Free. [ CONTROL ] at the top takes the PC's mouse and keys.${note ? `\n${note}` : ''}`;
}

/** The short line beside the CONTROL key: why it cannot be taken, or what last happened. Empty when there is nothing to say. */
export function controlKeySays(host: HostSettings | null, mine: boolean, note: string): string {
  if (host === null || host.control === 'off' || mine) return '';
  return note || host.controlWhy || (host.control === 'another device' ? ANOTHER_DEVICE : '');
}

/* --- SOUND and CONTROLLER, in words ---------------------------------------------------------------- */

export const SOUND_ON_THIS_PC = 'ON THIS PC THE SOUND WOULD FEED BACK INTO ITSELF';
export const SOUND_WANTS_A_PRESS = 'THIS BROWSER WANTS A PRESS BEFORE IT PLAYS SOUND: PRESS [ SOUND ]';
export const SOUND_NOT_SENT = 'THIS PC IS NOT SENDING SOUND';

/**
 * Whether SOUND can be offered on this device: only when the PC sends it, and never on the PC itself (it would
 * hear this page and send that too, round and round). `thisPc` is null until the connection has said which it is,
 * and nothing is offered until then.
 */
export function soundOffered(host: HostSettings | null, thisPc: boolean | null): boolean {
  return thisPc === false && host !== null && host.sound !== null && host.sound.allowed;
}

/** The panel's line about the PC's sound. */
export function soundStateSays(host: HostSettings | null, thisPc: boolean | null, on: boolean, note: string): string {
  if (thisPc === true) return 'Not offered here: this device is the PC itself.';
  if (host === null) return 'Waiting for the PC to say whether it sends sound.';
  if (host.sound === null) return `${SOUND_NOT_SENT}\nIts engine is an older one that cannot.`;
  if (!host.sound.allowed) return `${SOUND_NOT_SENT}\nIts engine was started with --no-sound.`;
  if (thisPc === null) return 'Waiting for the connection to say whether this device is the PC itself.';
  if (on) {
    if (host.sound.problem) return `ON.\nTHE PC COULD NOT READ ITS OWN SOUND: ${host.sound.problem}`;
    return `ON.${host.sound.heard === 'silence' ? ' The PC is playing nothing at the moment.' : host.sound.heard === 'sound' ? ' The PC is playing sound.' : ''}`;
  }
  return `OFF. [ SOUND ] at the top turns it on.${note ? `\n${note}` : ''}`;
}

/** What this device knows of its own game controller. */
export type PadSeen = {
  /** The browser gives controllers to pages at all. */
  supported: boolean;
  /** The one in use, by the name the browser gives it; '' when there is none. */
  name: string;
  /** One is connected, but in a layout the browser does not understand, so it is not used. */
  odd: boolean;
  /** The PC's word on its pretend controller: 1 plugged in, 2 no driver, 3 the driver refused; null before it has said. */
  pcSays: number | null;
};

/** The CONTROLLER line of the panel. */
export function padSays(pad: PadSeen, mine: boolean, host: HostSettings | null): string {
  if (!pad.supported) return 'THIS BROWSER GIVES NO CONTROLLERS TO THIS PAGE';
  if (pad.name === '') {
    return `${pad.odd ? 'A CONTROLLER IS CONNECTED, BUT THIS BROWSER DOES NOT KNOW ITS LAYOUT, SO IT IS NOT USED' : 'NO CONTROLLER ON THIS DEVICE'}\nIf one is plugged in, press a button on it: a browser only shows a controller to a page after that.`;
  }
  const first = `CONTROLLER CONNECTED: ${pad.name}\n`;
  if (!mine) return `${first}It drives a pretend Xbox 360 controller on the PC while this device holds control.`;
  if (pad.pcSays === 1) return `${first}IT IS DRIVING A PRETEND XBOX 360 CONTROLLER ON THE PC.`;
  if (pad.pcSays !== null && pad.pcSays >= 2) return `${first}${host?.controllerWhy ?? (pad.pcSays === 2 ? 'THE PC HAS NO CONTROLLER DRIVER' : "THE PC'S CONTROLLER DRIVER REFUSED")}`;
  return `${first}The PC is plugging its pretend controller in.`;
}

export function keysSay(keyboardLocked: boolean, canLock: boolean): string {
  if (keyboardLocked) return 'System keys (Alt+Tab, the Windows key, Esc) are going to the PC.';
  return canLock
    ? 'System keys (Alt+Tab, the Windows key, Esc) stay with this device unless the picture is fullscreen while controlling.'
    : 'System keys (Alt+Tab, the Windows key, Esc) stay with this device: this browser cannot hand them over.';
}
