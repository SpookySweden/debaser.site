'use client';

import { openKeyGate } from '../lib/screens/key-gate';

// Opened as this file loads, before any window of the site can add a key listener of its own: see key-gate.ts.
openKeyGate();

/**
 * Puts the keyboard's first listener in place for the whole site (SPEC-screens.md): while the owner controls their
 * PC from a room, the keys typed to the PC (Esc among them) must not also reach windows that were opened before
 * control was taken. It draws nothing and does nothing until CONTROL is held.
 */
export default function ScreenKeyGate() {
  return null;
}
