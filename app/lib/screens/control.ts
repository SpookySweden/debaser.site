import {
  BUTTONS,
  allUpMessage,
  buttonMessage,
  isLetGoChord,
  keyMessage,
  pcMessage,
  placeOnPicture,
  pointerAtMessage,
  pointerByMessage,
  releaseMessage,
  stillHereMessage,
  takeMessage,
  wheelMessage,
  wheelTurns,
  wholeMove,
  type PictureBox,
} from './wire';
import { leaveKeys, takeKeys, type KeyTaker } from './key-gate';
import { ScreenPad } from './pad';
import type { Mouse, PadSeen } from './wishes';
import type { PointerShape } from './wire';

/**
 * SCREENS' CONTROL (SPEC-screens.md, phase 2): this device's mouse, keys and wheel driving the PC, ported from the
 * engine's own viewer page (`engine/web/viewer.html`, its CONTROL part). Only when the PC was started allowing it,
 * only one device at a time, and never during a League match (the PC refuses).
 *
 * What is different in a room: the picture is one part of a page that has keys and shortcuts of its own. So while
 * this device holds control, the pointer on the picture and the keys typed while the picture is the thing last
 * pressed go to the PC and are stopped there, so that the site's shortcuts and the room's keys do not also answer
 * them. A press anywhere else on the site gives the keyboard back to the site (and lets go, on the PC, of every key
 * held). Ctrl+Alt+Shift+Q lets go of control from anywhere, and is never sent to the PC.
 */

export type ControlLinks = {
  /** The picture's box: where the pointer is read, and what holds the keyboard while controlling. */
  stage: HTMLElement;
  sendKeys: (bytes: Uint8Array<ArrayBuffer>) => boolean;
  sendPointer: (bytes: Uint8Array<ArrayBuffer>) => boolean;
  /** Where the picture really is on the page. */
  pictureBox: () => PictureBox | null;
  /** POINTER or GAME, as chosen now. */
  mouse: () => Mouse;
  /** Something the panel shows has changed. */
  onChange: () => void;
  /** Control ended or was refused: the PC's settings are worth reading again. */
  onStanding: () => void;
  /** Control began or ended, or the kind of mouse changed: the picture's pointer is to be set again. */
  onPointing: () => void;
  /** What else the PC says on the keys channel: its pointer showing or hidden, a new pointer shape, its word on sound. */
  onPointerShown: (shown: boolean) => void;
  onPointerShape: (shape: PointerShape) => void;
  onSoundSays: (what: number) => void;
};

/** `navigator.keyboard` (Chrome and Edge), which hands a fullscreen page the system keys. Not in TypeScript's list. */
type KeyboardLock = { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void };
const keyboardLock = (): KeyboardLock | undefined => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
export const canLockKeyboard = (): boolean => typeof keyboardLock()?.lock === 'function';

/** How long Esc is held on this device to let go of control. */
export const LET_GO_HOLD_MS = 1000;

/** The kinds of press the browser would answer itself (menus, back, forward, the room's own double press): held off while controlling. */
const HELD_OFF = ['contextmenu', 'auxclick', 'mouseup', 'mousedown', 'click', 'dblclick'] as const;

export class ScreenControl {
  /** This device holds control. */
  mine = false;
  /** The last thing worth saying about it. */
  note = '';
  pointerLocked = false;
  keyboardLocked = false;
  /** Esc is being held down on this device: held for LET_GO_HOLD_MS, control is let go (the room shows a line while it is). */
  escHolding = false;
  /** Input messages sent in the last whole second. */
  sentRate = 0;
  private escTimer = 0;

  private readonly heldKeys = new Set<string>();
  private readonly heldButtons = new Set<number>();
  private sent = 0;
  private sentBefore = 0;
  /** POINTER: the newest place not yet sent. */
  private newestAt: [number, number] | null = null;
  /** GAME: movement not yet sent. */
  private owedBy: [number, number] = [0, 0];
  private lastFlush = 0;
  private flushTimer = 0;
  private stillHereTimer = 0;
  private attached = false;
  private readonly moveEvent: string = 'onpointerrawupdate' in window ? 'pointerrawupdate' : 'pointermove';

  /** This device's game controller, driving a pretend one on the PC while control is held. */
  private readonly pad: ScreenPad;

  constructor(private readonly links: ControlLinks) {
    this.pad = new ScreenPad({
      sendKeys: (bytes) => this.sendKeys(bytes),
      sendPointer: (bytes) => {
        const went = links.sendPointer(bytes);
        if (went) this.sent += 1;
        return went;
      },
      mine: () => this.mine,
      onChange: links.onChange,
      onStanding: links.onStanding,
    });
  }

  /** What this device knows of its game controller, for the panel. */
  padSeen(): PadSeen {
    return this.pad.seen();
  }

  /* --- listening ------------------------------------------------------------------------------- */

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    const { stage } = this.links;
    // The mouse's own reports where the browser gives them (up to a thousand a second), the ordinary ones elsewhere.
    stage.addEventListener(this.moveEvent, this.onPointerMove);
    stage.addEventListener('pointerdown', this.onPointerDown);
    stage.addEventListener('pointerup', this.onPointerUp);
    stage.addEventListener('wheel', this.onWheel, { passive: false });
    for (const kind of HELD_OFF) stage.addEventListener(kind, this.holdOff);
    stage.addEventListener('blur', this.allUp);
    // The keyboard's first listener (key-gate.ts), so that a key typed to the PC is stopped before any window of the
    // site hears it, whenever that window was opened.
    takeKeys(this.onKey);
    this.pad.attach();
    window.addEventListener('blur', this.allUp);
    window.addEventListener('pagehide', this.onPageHide);
    document.addEventListener('visibilitychange', this.onVisibility);
    document.addEventListener('pointerlockchange', this.onPointerLock);
    document.addEventListener('fullscreenchange', this.lockKeyboard);
  }

  /** Lets go of control and of every listener and timer. */
  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    if (this.mine) {
      // The PC lets go of everything held when it hears this.
      this.links.sendKeys(releaseMessage());
      this.over('', false);
    }
    const { stage } = this.links;
    stage.removeEventListener(this.moveEvent, this.onPointerMove);
    stage.removeEventListener('pointerdown', this.onPointerDown);
    stage.removeEventListener('pointerup', this.onPointerUp);
    stage.removeEventListener('wheel', this.onWheel);
    for (const kind of HELD_OFF) stage.removeEventListener(kind, this.holdOff);
    stage.removeEventListener('blur', this.allUp);
    leaveKeys(this.onKey);
    this.pad.detach();
    window.removeEventListener('blur', this.allUp);
    window.removeEventListener('pagehide', this.onPageHide);
    document.removeEventListener('visibilitychange', this.onVisibility);
    document.removeEventListener('pointerlockchange', this.onPointerLock);
    document.removeEventListener('fullscreenchange', this.lockKeyboard);
    window.clearTimeout(this.flushTimer);
    window.clearInterval(this.stillHereTimer);
    this.flushTimer = 0;
    this.stillHereTimer = 0;
  }

  /** Once a second, for "input sent ... a second" in the readout. */
  tick(): void {
    this.sentRate = this.sent - this.sentBefore;
    this.sentBefore = this.sent;
  }

  /* --- sending --------------------------------------------------------------------------------- */

  private sendKeys(bytes: Uint8Array<ArrayBuffer>): boolean {
    const went = this.links.sendKeys(bytes);
    if (went) this.sent += 1;
    return went;
  }

  private place(clientX: number, clientY: number): [number, number] | null {
    return placeOnPicture(this.links.pictureBox(), clientX, clientY);
  }

  /** Whether the picture is what the keyboard is for just now. */
  private keysAreForThePc(): boolean {
    const { stage } = this.links;
    return document.activeElement === stage || document.pointerLockElement === stage;
  }

  // Movement goes out at most about once a millisecond: the newest place (POINTER) or the summed movement (GAME).
  private readonly flushPointer = () => {
    this.flushTimer = 0;
    this.lastFlush = performance.now();
    if (!this.mine) {
      this.newestAt = null;
      this.owedBy = [0, 0];
      return;
    }
    if (this.newestAt !== null) {
      if (this.links.sendPointer(pointerAtMessage(this.newestAt))) this.sent += 1;
      this.newestAt = null;
    }
    const dx = wholeMove(this.owedBy[0]);
    const dy = wholeMove(this.owedBy[1]);
    if (dx !== 0 || dy !== 0) {
      if (this.links.sendPointer(pointerByMessage(dx, dy))) this.sent += 1;
      this.owedBy = [this.owedBy[0] - dx, this.owedBy[1] - dy];
    }
  };

  private pointerMoved(): void {
    if (performance.now() - this.lastFlush >= 1) this.flushPointer();
    else if (this.flushTimer === 0) this.flushTimer = window.setTimeout(this.flushPointer, 1);
  }

  private readonly onPointerMove = (raw: Event) => {
    if (!this.mine) return;
    const event = raw as PointerEvent;
    if (this.links.mouse() === 'game') {
      if (!this.pointerLocked) return;
      // Every movement since the last event counts, not only the newest.
      const all = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
      for (const one of all.length > 0 ? all : [event]) {
        this.owedBy[0] += one.movementX;
        this.owedBy[1] += one.movementY;
      }
    } else {
      this.newestAt = this.place(event.clientX, event.clientY);
    }
    this.pointerMoved();
  };

  private readonly onPointerDown = (event: PointerEvent) => this.onPointerButton(event, true);
  private readonly onPointerUp = (event: PointerEvent) => this.onPointerButton(event, false);

  private onPointerButton(event: PointerEvent, down: boolean): void {
    if (!this.mine) return;
    // The press is the PC's: the room's own answers to it (dragging a floating picture) are stopped here.
    event.preventDefault();
    event.stopPropagation();
    const { stage } = this.links;
    // A press on the picture makes it what the keyboard is for (the held-off mouse press would not move the focus itself).
    if (down && document.activeElement !== stage) stage.focus({ preventScroll: true });
    const button = BUTTONS[event.button];
    if (button === undefined) return;
    const game = this.links.mouse() === 'game';
    if (game && !this.pointerLocked) {
      // In GAME mode a click on the picture first captures the pointer; that click is not passed on.
      if (down) {
        this.lockPointer();
        return;
      }
      // (A button let go after the capture was lost is still let go on the PC, below, when the PC has it down.)
    }
    if (down) {
      this.heldButtons.add(button);
      // A drag that leaves the picture still belongs to it.
      if (!game) {
        try {
          stage.setPointerCapture(event.pointerId);
        } catch {
          /* not this pointer */
        }
      }
    } else {
      if (!this.heldButtons.has(button)) return;
      this.heldButtons.delete(button);
    }
    // The place travels with the click: movement goes on the other channel and could arrive after it.
    const place = game ? null : this.place(event.clientX, event.clientY);
    this.newestAt = null;
    this.sendKeys(buttonMessage(button, down, place));
  }

  private readonly onWheel = (event: WheelEvent) => {
    if (!this.mine) return;
    event.preventDefault();
    event.stopPropagation();
    const { dx, dy } = wheelTurns(event.deltaX, event.deltaY, event.deltaMode);
    if (dx === 0 && dy === 0) return;
    const place = this.links.mouse() === 'game' ? null : this.place(event.clientX, event.clientY);
    this.sendKeys(wheelMessage(dx, dy, place));
  };

  private readonly holdOff = (event: Event) => {
    if (!this.mine) return;
    event.preventDefault();
    event.stopPropagation();
  };

  private readonly onKey: KeyTaker = (event, down) => {
    if (!this.mine) return;
    // The way out on this device: Ctrl+Alt+Shift+Q, from anywhere on the page. It is never sent to the PC.
    if (isLetGoChord(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (down) this.release();
      return;
    }
    // Typing elsewhere on the site (the room's chat) stays with the site.
    if (!this.keysAreForThePc()) return;
    // The key belongs to the PC: the browser is asked not to act on it, and the site's own shortcuts never hear it.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.code) return;
    // The easy way out (Luke, 2026-11-21: "we need an easier way of ending control"): hold Esc for a second. A quick
    // press is still an ordinary Esc for the PC; while it is held, its repeats are not sent, so the PC sees one press.
    if (event.code === 'Escape') {
      if (down && event.repeat) return;
      if (down) this.startEscHold();
      else this.stopEscHold();
    }
    if (down) this.heldKeys.add(event.code);
    // A key let go that was pressed before the picture had the keyboard (the Enter that pressed [ CONTROL ]) is not the PC's.
    else if (!this.heldKeys.delete(event.code)) return;
    this.sendKeys(keyMessage(down, event.code));
  };

  private startEscHold(): void {
    this.stopEscHold();
    this.escHolding = true;
    this.links.onChange();
    this.escTimer = window.setTimeout(() => {
      this.escTimer = 0;
      this.escHolding = false;
      // The Esc going down already reached the PC; release() lets go of it there with everything else.
      if (this.mine) this.release();
      else this.links.onChange();
    }, LET_GO_HOLD_MS);
  }

  private stopEscHold(): void {
    if (this.escTimer) window.clearTimeout(this.escTimer);
    this.escTimer = 0;
    if (this.escHolding) {
      this.escHolding = false;
      this.links.onChange();
    }
  }

  /**
   * Lets go, on the PC, of everything this device is holding down (the tab lost focus or was hidden, or the picture
   * lost the keyboard: the "up" events would never arrive here, so the PC is told at once).
   */
  readonly allUp = () => {
    this.stopEscHold();
    if (!this.mine) return;
    if (this.heldKeys.size > 0 || this.heldButtons.size > 0) this.sendKeys(allUpMessage());
    this.heldKeys.clear();
    this.heldButtons.clear();
    // The controller too: a browser may stop reading it while the tab is away, so the PC's is set to "nothing pressed".
    this.pad.letGo();
  };

  private readonly onVisibility = () => {
    if (document.hidden) this.allUp();
  };

  // A page that is closing lets go of control on its way out, when the browser still lets the message leave.
  // (When it does not, the PC notices the silence three seconds later and lets go itself.)
  private readonly onPageHide = () => {
    if (this.mine) this.links.sendKeys(releaseMessage());
  };

  private readonly onPointerLock = () => {
    const was = this.pointerLocked;
    this.pointerLocked = document.pointerLockElement === this.links.stage;
    // The capture was lost (Esc gives the pointer back) with something held: its "up" might never be seen here, so
    // the PC lets go of everything now. (The engine's own page leaves a button held in this case.)
    if (was && !this.pointerLocked) this.allUp();
    this.links.onChange();
  };

  /* --- the pointer and the keyboard, captured --------------------------------------------------- */

  private lockPointer(): void {
    const { stage } = this.links;
    if (typeof stage.requestPointerLock !== 'function') return;
    const plain = () => {
      try {
        // (An older browser answers with nothing where a newer one answers with a promise.)
        const asked = stage.requestPointerLock() as Promise<void> | undefined;
        asked?.catch(() => {
          /* refused: the panel says the pointer is not captured */
        });
      } catch {
        /* refused: the panel says the pointer is not captured */
      }
    };
    // "Unadjusted" movement is the mouse's own, before the system's acceleration; older browsers only do the plain kind.
    try {
      const asked = stage.requestPointerLock({ unadjustedMovement: true }) as Promise<void> | undefined;
      asked?.catch(plain);
    } catch {
      plain();
    }
  }

  private exitPointerLock(): void {
    if (document.pointerLockElement === this.links.stage) document.exitPointerLock();
  }

  /** System keys (Alt+Tab, the Windows key, Esc) only reach a page that is fullscreen and has asked to keep them. */
  private readonly lockKeyboard = () => {
    const keyboard = keyboardLock();
    const can = canLockKeyboard();
    if (this.mine && document.fullscreenElement !== null && can && keyboard?.lock !== undefined) {
      keyboard
        .lock()
        .then(() => {
          this.keyboardLocked = this.mine;
          this.links.onChange();
        })
        .catch(() => {
          this.keyboardLocked = false;
          this.links.onChange();
        });
    } else {
      if (can && this.keyboardLocked) keyboard?.unlock?.();
      this.keyboardLocked = false;
    }
  };

  /** The MOUSE choice changed (the session has already remembered it). */
  mouseChanged(): void {
    this.allUp();
    if (this.mine && this.links.mouse() === 'game') this.lockPointer();
    if (this.links.mouse() !== 'game') this.exitPointerLock();
    this.links.onPointing();
    this.links.onChange();
  }

  /* --- taking and letting go ------------------------------------------------------------------- */

  private began(): void {
    this.mine = true;
    this.note = '';
    this.heldKeys.clear();
    this.heldButtons.clear();
    window.clearInterval(this.stillHereTimer);
    this.stillHereTimer = window.setInterval(() => {
      if (this.mine) this.sendKeys(stillHereMessage());
    }, 1000);
    // The picture takes the keyboard, so typing reaches the PC at once.
    this.links.stage.focus({ preventScroll: true });
    if (this.links.mouse() === 'game') this.lockPointer();
    this.lockKeyboard();
    this.pad.begin();
    this.links.onPointing();
    this.links.onChange();
  }

  private over(why: string, tell = true): void {
    this.mine = false;
    this.note = why;
    this.heldKeys.clear();
    this.heldButtons.clear();
    this.newestAt = null;
    this.owedBy = [0, 0];
    window.clearInterval(this.stillHereTimer);
    this.stillHereTimer = 0;
    this.exitPointerLock();
    this.lockKeyboard();
    // (The PC has already unplugged its pretend controller: it does that however control ends.)
    this.pad.end();
    this.links.onPointing();
    if (!tell) return;
    this.links.onChange();
    this.links.onStanding();
  }

  take(): void {
    if (this.mine) return;
    if (!this.sendKeys(takeMessage())) {
      this.note = 'NOT CONNECTED YET';
      this.links.onChange();
    }
  }

  release(): void {
    if (!this.mine) return;
    // The PC lets go of everything held when it hears this; this device stops sending at once.
    this.sendKeys(releaseMessage());
    this.over('');
  }

  /** CONTROL's channel closed under us. */
  channelClosed(): void {
    if (this.mine) this.over('CONTROL ENDED: THE CONNECTION CLOSED');
  }

  /** What the PC says on the keys channel: about control, and four other things passed on to whoever they are for. */
  heard(bytes: Uint8Array): void {
    const message = pcMessage(bytes);
    if (message === null) return;
    if (message.kind === 'pointerShown') return this.links.onPointerShown(message.shown);
    if (message.kind === 'pointerShape') return this.links.onPointerShape(message.shape);
    if (message.kind === 'sound') return this.links.onSoundSays(message.what);
    if (message.kind === 'pad') return this.pad.heard(message.what);
    const said = message.said;
    if (said.kind === 'yours') this.began();
    else if (said.kind === 'released') {
      if (this.mine) this.over('');
    } else if (said.kind === 'ended') this.over(said.why);
    else {
      this.note = said.why;
      this.links.onChange();
      this.links.onStanding();
    }
  }
}
