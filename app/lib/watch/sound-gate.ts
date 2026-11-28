/**
 * Whether this page may start sound yet (ROOM-DEVICE-SYNC, Luke 2026-11-28: "the video not waking up automatically when clicked
 * play on another signed in device"; sound is tried first, muted only where the browser refuses).
 *
 * A browser refuses sound on a page nobody has pressed since it loaded (an installed app or an allowed site is let through). Such a
 * device still has to play with the others, so it starts MUTED and in step, and this says so until the next press of anything.
 * It has to be known BEFORE a mute is lifted from another device: a browser pauses a video that a script unmutes on an unpressed
 * page, and that pause read like a press here and paused the whole room.
 *
 * `open`: sound may start. `waiting`: refused; the next press opens it. `unknown`: not asked yet.
 */
type SoundState = 'unknown' | 'open' | 'waiting';

/** A press that opened the gate counts as only that for this long: the same press's click must not also turn a mute. */
const UNLOCK_PRESS_MS = 600;

/** Events the browser counts as a press once they are through (a mouse's has counted since its button went down). */
const PRESS_EVENTS = ['pointerup', 'touchend', 'keydown'] as const;

let state: SoundState = 'unknown';
let openedAt = Number.NEGATIVE_INFINITY;
let asked = false;
let unhook: (() => void) | null = null;
const listeners = new Set<() => void>();

function set(next: SoundState): void {
  if (state === next) return;
  state = next;
  for (const listener of listeners) listener();
}

export function soundWaiting(): boolean {
  return state === 'waiting';
}

/** The browser has already said this page may start sound. */
export function soundAllowed(): boolean {
  return state === 'open';
}

export function subscribeSoundGate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The page has been pressed since it loaded. A browser that cannot say is taken as pressed (today's behaviour there). */
export function everPressed(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.userActivation?.hasBeenActive ?? true;
}

/** The press just now was the one that brought the sound: it is not also a press on whatever it landed on. */
export function soundJustCame(): boolean {
  return performance.now() - openedAt < UNLOCK_PRESS_MS;
}

function open(): void {
  unhook?.();
  unhook = null;
  if (state === 'waiting') openedAt = performance.now();
  set('open');
}

/** A start was turned down on an unpressed page: hold the sound until the next press of anything. */
export function soundRefused(): void {
  if (typeof window === 'undefined' || state === 'waiting' || everPressed()) return;
  const pressed = (event: Event) => {
    if (event instanceof KeyboardEvent && event.key === 'Escape') return;
    if (navigator.userActivation && !navigator.userActivation.isActive) return;
    open();
  };
  for (const type of PRESS_EVENTS) window.addEventListener(type, pressed, true);
  unhook = () => {
    for (const type of PRESS_EVENTS) window.removeEventListener(type, pressed, true);
  };
  set('waiting');
}

/** A press inside an outside player's own frame never reaches this page's listeners, but the browser counts it: ask it. */
export function noticePress(): void {
  if (state === 'waiting' && typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive) open();
}

/** A hundredth of a second of silence (8 kHz, 8-bit mono WAV). */
function silence(): string {
  const samples = 80;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const word = (at: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) bytes[at + i] = text.charCodeAt(i);
  };
  word(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  word(8, 'WAVE');
  word(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  word(36, 'data');
  view.setUint32(40, samples, true);
  bytes.fill(128, 44);
  return `data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`;
}

/**
 * Asks the browser, once, whether this page may start sound: a moment of silence on an element of its own. No room player is
 * touched and no press is made up. A page already pressed is not asked.
 */
export function askForSound(): void {
  if (typeof window === 'undefined' || asked || state !== 'unknown') return;
  asked = true;
  if (everPressed()) {
    set('open');
    return;
  }
  const probe = new Audio(silence());
  void probe.play().then(
    () => {
      probe.pause();
      if (state === 'unknown') set('open');
    },
    (error: unknown) => {
      if (error instanceof Error && error.name === 'NotAllowedError') soundRefused();
    },
  );
}
