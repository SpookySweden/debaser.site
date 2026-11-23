import { createWindowSlot } from './window-slot';

/** The EXTENSION window (Luke, 2026-11-23): opened from the profile's SETTINGS, and by any key that needs the extension when it isn't there or is old. */
const SHUT = { open: false };
const slot = createWindowSlot<{ open: boolean }>(SHUT);

export const extensionWindowState = slot.state;
export const subscribeToExtensionWindow = slot.subscribe;

export function openExtensionWindow(): void {
  if (!slot.state().open) slot.set({ open: true });
}
export function closeExtensionWindow(): void {
  if (slot.state().open) slot.set(SHUT);
}
export function toggleExtensionWindow(): void {
  if (slot.state().open) closeExtensionWindow();
  else openExtensionWindow();
}
