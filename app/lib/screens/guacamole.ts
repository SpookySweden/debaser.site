/**
 * The parts of Apache Guacamole's browser client (`vendor/guacamole-common-js/`, Apache 2.0) that the Remote Desktop
 * view uses, typed by hand. Loaded only when that view opens, so no other page carries it.
 */

export type GuacMouseState = { x: number; y: number; left: boolean; middle: boolean; right: boolean; up: boolean; down: boolean };

export type GuacDisplay = {
  getElement(): HTMLElement;
  getWidth(): number;
  getHeight(): number;
  scale(scale: number): void;
  getScale(): number;
  showCursor(shown: boolean): void;
  onresize: ((width: number, height: number) => void) | null;
};

export type GuacStatus = { code: number; message?: string };

export type GuacClient = {
  connect(data?: string): void;
  disconnect(): void;
  getDisplay(): GuacDisplay;
  sendSize(width: number, height: number): void;
  sendKeyEvent(pressed: 0 | 1 | boolean, keysym: number): void;
  sendMouseState(state: GuacMouseState, applyDisplayScale?: boolean): void;
  onstatechange: ((state: number) => void) | null;
  onerror: ((status: GuacStatus) => void) | null;
};

export type GuacTunnel = {
  onerror: ((status: GuacStatus) => void) | null;
};

export type GuacMouse = {
  onEach(types: string[], listener: (event: { state: GuacMouseState }) => void): void;
};

export type GuacKeyboard = {
  onkeydown: ((keysym: number) => boolean | void) | null;
  onkeyup: ((keysym: number) => void) | null;
  reset(): void;
};

export type Guacamole = {
  WebSocketTunnel: new (url: string) => GuacTunnel;
  Client: new (tunnel: GuacTunnel) => GuacClient;
  Mouse: new (element: Element) => GuacMouse;
  Keyboard: new (element?: Element | Document) => GuacKeyboard;
};

/** Guacamole.Client.State: the numbers its `onstatechange` reports. */
export const GUAC_STATE = { IDLE: 0, CONNECTING: 1, WAITING: 2, CONNECTED: 3, DISCONNECTING: 4, DISCONNECTED: 5 } as const;

/** The X11 key number for Esc, which Guacamole sends keys as. */
export const KEYSYM_ESCAPE = 0xff1b;

export async function loadGuacamole(): Promise<Guacamole> {
  const loaded = (await import('../../../vendor/guacamole-common-js/guacamole-common.js')) as unknown as { default: Guacamole };
  return loaded.default;
}
