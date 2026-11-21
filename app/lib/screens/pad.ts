import { PAD_NEUTRAL, padPresentMessage, padState, padStateMessage } from './wire';
import type { PadSeen } from './wishes';

/**
 * SCREENS' CONTROLLER, ported from the engine's own viewer page (`engine/web/viewer.html`, the CONTROLLER part of
 * CONTROL): a game controller on this device driving a pretend Xbox 360 controller on the PC, while this device
 * holds control and no longer. The browser is asked for the controller's state every few milliseconds; the whole
 * state (buttons, triggers, both sticks) is sent when anything changed, on the channel where a newer message
 * replaces an older one, and once a second whether or not it changed, so a lost message cannot leave a button held
 * on the PC. One controller, in the layout browsers call "standard"; no vibration comes back.
 */

export type PadLinks = {
  sendKeys: (bytes: Uint8Array<ArrayBuffer>) => boolean;
  sendPointer: (bytes: Uint8Array<ArrayBuffer>) => boolean;
  /** This device holds control. */
  mine: () => boolean;
  /** Something the panel shows has changed. */
  onChange: () => void;
  /** The PC could not plug its pretend controller in: its settings say why. */
  onStanding: () => void;
};

/** How often the controller is read while this device holds control. */
const READ_EVERY_MS = 4;
const NEUTRAL = PAD_NEUTRAL.join(' ');

export class ScreenPad {
  /** State messages sent, ever. */
  sent = 0;

  /** The controller in use on this device ('' = none). */
  private name = '';
  /** A controller is connected, but in a layout the browser does not understand. */
  private odd = false;
  /** The PC has been told this device has a controller. */
  private toldPc = false;
  /** The PC's answer: 1 plugged in, 2 no driver, 3 the driver refused. */
  private pcSays: number | null = null;
  /** Counts the state messages, so the PC can drop one that arrives late. */
  private counter = 0;
  /** The last state sent, and when. */
  private last = '';
  private lastAt = 0;
  private timer = 0;
  private listening = false;

  constructor(private readonly links: PadLinks) {}

  private static supported(): boolean {
    return typeof navigator.getGamepads === 'function';
  }

  /** The one controller in use: the first the browser lists that is connected and in the standard layout. */
  private find(): Gamepad | null {
    this.odd = false;
    let all: (Gamepad | null)[] = [];
    try {
      all = ScreenPad.supported() ? navigator.getGamepads() : [];
    } catch {
      return null;
    }
    for (const one of all) {
      if (one === null || !one.connected) continue;
      if (one.mapping === 'standard') return one;
      this.odd = true;
    }
    return null;
  }

  /** A controller coming or going is shown at once. */
  attach(): void {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener('gamepadconnected', this.links.onChange);
    window.addEventListener('gamepaddisconnected', this.links.onChange);
  }

  detach(): void {
    this.end();
    if (!this.listening) return;
    this.listening = false;
    window.removeEventListener('gamepadconnected', this.links.onChange);
    window.removeEventListener('gamepaddisconnected', this.links.onChange);
  }

  private sendState(state: readonly number[]): void {
    this.counter = (this.counter + 1) & 0xffff;
    if (!this.links.sendPointer(padStateMessage(this.counter, state))) return;
    this.last = state.join(' ');
    this.lastAt = performance.now();
    this.sent += 1;
  }

  // Every few milliseconds while this device holds control.
  private readonly read = (): void => {
    if (!this.links.mine()) return;
    const one = this.find();
    if (one === null) {
      // It has gone (unplugged, or switched off): the PC unplugs its pretend one.
      if (this.toldPc) {
        this.links.sendKeys(padPresentMessage(false));
        this.toldPc = false;
        this.pcSays = null;
        this.name = '';
        this.links.onChange();
      }
      return;
    }
    if (!this.toldPc) {
      if (!this.links.sendKeys(padPresentMessage(true))) return;
      this.toldPc = true;
      this.pcSays = null;
      this.name = one.id;
      this.counter = 0;
      this.last = '';
      this.links.onChange();
    }
    const state = padState(one);
    if (state.join(' ') !== this.last || performance.now() - this.lastAt >= 1000) this.sendState(state);
  };

  /**
   * Sets the PC's pretend controller to "nothing pressed" now (the tab lost focus: a browser may stop reading the
   * controller while it is away). The next reading sends the real state again if the browser is still giving one.
   */
  letGo(): void {
    if (this.links.mine() && this.toldPc && this.last !== NEUTRAL) this.sendState(PAD_NEUTRAL);
  }

  /** Control has been given to this device. */
  begin(): void {
    window.clearInterval(this.timer);
    this.toldPc = false;
    this.pcSays = null;
    this.timer = window.setInterval(this.read, READ_EVERY_MS);
    this.read();
  }

  /** Control is over: the PC has already unplugged its pretend controller (it does that however control ends). */
  end(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    this.toldPc = false;
    this.pcSays = null;
  }

  /** The PC's word on its pretend controller: 0 not plugged in, 1 plugged in, 2 no driver, 3 the driver refused. */
  heard(what: number): void {
    this.pcSays = what;
    if (what >= 2) this.links.onStanding();
    this.links.onChange();
  }

  /** What this device knows of its controller, for the panel's CONTROLLER line. */
  seen(): PadSeen {
    const supported = ScreenPad.supported();
    const one = supported ? this.find() : null;
    if (!this.links.mine()) this.name = one === null ? '' : one.id;
    return { supported, name: one === null ? '' : this.name || one.id, odd: this.odd, pcSays: this.pcSays };
  }
}
