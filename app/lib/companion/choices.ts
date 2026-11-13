/**
 * The COMPANION switch (SPEC-companion.md, decision 2): whether your companion is out. It always wears your profile's
 * SHOWN character (Luke, 2026-11-13: "Only the shown one"), so there is no character to choose.
 *
 * Pure: no browser, no database. `companion-slot.ts` keeps them in this browser and on the account.
 */

export type CompanionChoices = {
  /**
   * On a computer. Null is the default: on once you have a SHOWN character (SPEC-profile-characters.md), and off until
   * that is built, so nobody gets an empty placeholder walking about without asking for it.
   */
  computer: boolean | null;
  /** On a phone or tablet: off unless you turn it on there. */
  phone: boolean;
};

export const DEFAULT_COMPANION: CompanionChoices = { computer: null, phone: false };

/** Reads saved choices back. Anything unrecognised falls back to the default, never throws. */
export function parseCompanionChoices(value: unknown): CompanionChoices {
  if (value === null || typeof value !== 'object') return DEFAULT_COMPANION;
  const raw = value as Record<string, unknown>;
  return {
    computer: typeof raw.computer === 'boolean' ? raw.computer : null,
    phone: raw.phone === true,
  };
}

/**
 * Whether the companion is out on this device.
 *
 * `phone` is a device with no mouse or pen (`(any-pointer: fine)` fails): the site gives phones the desktop zoomed out,
 * so the width cannot tell. `hasShown` is whether the account has a SHOWN character, which decides the default.
 */
export function companionOut(choices: CompanionChoices, opts: { signedIn: boolean; phone: boolean; hasShown: boolean }): boolean {
  if (!opts.signedIn) return false;
  if (opts.phone) return choices.phone;
  return choices.computer ?? opts.hasShown;
}

/** The same choices with this device's switch set. */
export function withSwitch(choices: CompanionChoices, phone: boolean, on: boolean): CompanionChoices {
  return phone ? { ...choices, phone: on } : { ...choices, computer: on };
}
