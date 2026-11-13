import { NAME_COLOURS } from '../profile/name-colours';
import { contrastRatio } from './colour';

/**
 * The modules: what the top bar's keys are called (Luke, 2026-11-06). Each person ticks which ones appear on their bar, and may give each one a colour its word
 * turns on hover. Pure, so a check can hold it. An unticked module's address still works; only its key goes.
 */

export type ModuleKey = 'home' | 'forum' | 'web' | 'read' | 'tagstation' | 'recommendations' | 'docs' | 'beatbox' | 'cytube' | 'animate' | 'modules';

export type ModuleDef = {
  key: ModuleKey;
  label: string;
  /** Null for MODULOS, the key at the end, which opens the list rather than going anywhere. */
  href: string | null;
  group: 'site' | 'creative';
  /** On the bar until somebody says otherwise. */
  startsOn: boolean;
  /** Still being made: wears a WIP tag on the bar and in the list (Luke, 2026-11-06). */
  wip?: boolean;
  /** Can't be unticked: the way back to this list. */
  always?: boolean;
};

/** In the order the bar draws them, MODULOS last. Luke's choice: BEATBOX, ANIMATE and DISCOVER start off and are tagged WIP, and CREATIVE holds BEATBOX, STREAM and ANIMATE. */
export const MODULES: readonly ModuleDef[] = [
  { key: 'home', label: 'PROJECTS', href: '/projects', group: 'site', startsOn: true },
  { key: 'forum', label: 'FORUM', href: '/forum', group: 'site', startsOn: true },
  { key: 'web', label: 'MEDIA', href: '/media', group: 'site', startsOn: true },
  // The reader (Luke, 2026-11-13: "a new module for reading"): your books, and your own PDFs and EPUBs matched to their book.
  { key: 'read', label: 'READ', href: '/read', group: 'site', startsOn: true },
  // A map of the words on MEDIA's items (SPEC-tag-station.md, SPEC-discover.md).
  { key: 'tagstation', label: 'DISCOVER', href: '/discover', group: 'site', startsOn: false, wip: true },
  // Queues of things sent to people or posted publicly (SPEC-recommendations.md, Luke 2026-11-10): off until ticked.
  { key: 'recommendations', label: 'RECOMMENDATIONS', href: '/recommendations', group: 'site', startsOn: false },
  // Shared live documents in folders, the lore pages among them (SPEC-live-docs.md): on the bar from a first visit (Luke, 2026-11-13: "on for everyone").
  { key: 'docs', label: 'DOCS', href: '/docs', group: 'site', startsOn: true },
  // The music maker (app/features/beatbox).
  { key: 'beatbox', label: 'BEATBOX', href: '/beatbox', group: 'creative', startsOn: false, wip: true },
  { key: 'cytube', label: 'STREAM', href: '/stream', group: 'creative', startsOn: true },
  // The frame-by-frame animator (SPEC-animator.md).
  { key: 'animate', label: 'ANIMATE', href: '/animate', group: 'creative', startsOn: false, wip: true },
  // MODULOS is the tab holding the rest of the modules, Luke's name for it (2026-11-06); the bar's title still reads MODULES:.
  { key: 'modules', label: 'MODULOS', href: null, group: 'site', startsOn: true, always: true },
];

/** Only what somebody changed from the start, so a module's starting state can change later without touching anybody's choices. */
export type ModuleChoices = {
  on: Partial<Record<ModuleKey, boolean>>;
  colours: Partial<Record<ModuleKey, string>>;
};

export const NO_CHOICES: ModuleChoices = { on: {}, colours: {} };

const isModuleKey = (key: string): key is ModuleKey => MODULES.some((module) => module.key === key);

/** Anything stored, from a browser or an account, read back through the same door: unknown keys and colours are dropped, and anything else means no choices. */
export function parseModuleChoices(stored: unknown): ModuleChoices {
  if (typeof stored !== 'object' || stored === null) return NO_CHOICES;
  const { on, colours } = stored as { on?: unknown; colours?: unknown };
  const result: ModuleChoices = { on: {}, colours: {} };
  if (typeof on === 'object' && on !== null) {
    for (const [key, value] of Object.entries(on)) if (isModuleKey(key) && typeof value === 'boolean') result.on[key] = value;
  }
  if (typeof colours === 'object' && colours !== null) {
    for (const [key, value] of Object.entries(colours)) {
      if (isModuleKey(key) && typeof value === 'string' && NAME_COLOURS.some((colour) => colour.id === value)) result.colours[key] = value;
    }
  }
  return result;
}

export function moduleIsOn(module: ModuleDef, choices: ModuleChoices): boolean {
  return module.always === true || (choices.on[module.key] ?? module.startsOn);
}

export function withTick(choices: ModuleChoices, module: ModuleDef, on: boolean): ModuleChoices {
  if (module.always) return choices;
  const next = { ...choices.on };
  if (on === module.startsOn) delete next[module.key];
  else next[module.key] = on;
  return { ...choices, on: next };
}

/** Null takes the module's colour away. */
export function withColour(choices: ModuleChoices, key: ModuleKey, colourId: string | null): ModuleChoices {
  const next = { ...choices.colours };
  if (colourId === null) delete next[key];
  else next[key] = colourId;
  return { ...choices, colours: next };
}

/** Text must stay readable in every theme (`.claude/rules/frontend.md`). */
const READABLE = 4.5;

/**
 * What a swatch is drawn as on this bar: its own colour if that reads, else its counterpart for dark fields, else null. Null means the key keeps the site's own
 * hover, so a colour chosen on one theme can never make a word vanish on another.
 */
export function moduleInk(colourId: string | undefined, bar: string): string | null {
  const swatch = NAME_COLOURS.find((colour) => colour.id === colourId);
  if (swatch === undefined) return null;
  for (const ink of [swatch.hex, swatch.dark]) if (contrastRatio(ink, bar) >= READABLE) return ink;
  return null;
}

/** The swatches worth offering on this bar: those that read, one for each colour they'd actually draw. The one already picked always stays, so it can be seen. */
export function moduleSwatches(bar: string, picked: string | undefined): { id: string; label: string; ink: string }[] {
  const seen = new Set<string>();
  const offered: { id: string; label: string; ink: string }[] = [];
  for (const colour of NAME_COLOURS) {
    const ink = moduleInk(colour.id, bar);
    if (ink === null) continue;
    const already = seen.has(ink);
    if (already && colour.id !== picked) continue;
    seen.add(ink);
    // Named for what's drawn, not for the choice: on a dark bar BLACK draws white, so the square beside it says WHITE.
    offered.push({ id: colour.id, label: ink === colour.hex ? colour.label : (colour.darkLabel ?? colour.label), ink });
  }
  return offered;
}
