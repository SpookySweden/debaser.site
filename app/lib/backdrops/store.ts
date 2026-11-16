import { USING_MOCK_AUTH } from '../auth/auth-repository';
import { getSupabaseBrowserClient } from '../supabase/client';
import { BACKDROPS, DEFAULT_BACKDROP, backdropState, setBackdrop, subscribeToBackdrop, type BackdropId } from '../ui/backdrop-slot';
import { createWindowSlot } from '../ui/window-slot';
import { parseLocks, parseSway, parseValues, sameValues, type BackdropDef, type Values } from './knobs';
import { BACKDROP_DEFS, backdropDef } from './registry';

/**
 * Every background's settings as the site holds them (SPEC-aquarium-settings.md, then SPEC-backgrounds.md): a store outside
 * React, the MODULOS arrangement (`../ui/modules-slot.ts`). This browser's copy draws the background at once and is all a
 * signed-out visitor has; a signed-in person's settings are saved to their account as well, in one row of `user_aquarium`,
 * which only they can read or write, so their backgrounds follow them between machines.
 *
 * The row is the aquarium's knobs at its top level (as it was when the aquarium was the only one), the BACKGROUND choice
 * (`backdrop`), and every other background's settings under `scenes`. In the browser each background has its own key, and the
 * choice stays under its own (`../ui/backdrop-slot.ts`), which the boot script reads before the first paint.
 *
 * Besides its knobs' values a background keeps two things about its knobs: which are LOCKED (PARTY and the looks leave them
 * alone) and which SWAY, and between what marks. They are stored beside the values as `_locks` and `_sway`.
 *
 * Saving to accounts is switched on by `NEXT_PUBLIC_AQUARIUM_DATA_SOURCE=supabase` (set since the table was added, 2026-11-15;
 * without it a signed-in person's settings are kept in their browser like a visitor's and nothing asks the database). Under
 * mock sign-in the "account" is this browser's storage, one entry a person.
 */

export type Extras = { locks: readonly string[]; sway: Readonly<Record<string, readonly [number, number]>> };
/** One background's settings: its knobs' values, and what is locked and swaying. */
export type Scene = { values: Values; extras: Extras };
type Scenes = Readonly<Record<string, Scene>>;

/** What an account holds: every background's settings, and which background is on. */
export type SavedBackdrops = { scenes: Scenes; backdrop: BackdropId };

export type BackdropStore = {
  /** Null when this account has saved nothing yet. */
  read(person: string): Promise<SavedBackdrops | null>;
  save(person: string, saved: SavedBackdrops): Promise<void>;
};

export const NO_EXTRAS: Extras = { locks: [], sway: {} };

/** A background's stored object read back: its values, and its locks and sways. */
function parseScene(def: BackdropDef, raw: unknown): Scene {
  const held = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return { values: parseValues(def, raw), extras: { locks: parseLocks(def, held._locks), sway: parseSway(def, held._sway) } };
}

/**
 * A background's settings as they are stored: the values, with the locks and sways beside them when there are any. `lean`
 * leaves out every value that is as the background comes (reading it back fills them in), which is how the account's row is
 * written: five backgrounds of every knob would be most of the 4 KB the database allows it.
 */
function sceneObject(scene: Scene, lean?: BackdropDef): Record<string, unknown> {
  const stored: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(scene.values)) if (lean === undefined || lean.defaults[key] !== value) stored[key] = value;
  if (scene.extras.locks.length > 0) stored._locks = scene.extras.locks;
  if (Object.keys(scene.extras.sway).length > 0) stored._sway = scene.extras.sway;
  return stored;
}

/** An account's row read back through the same checks as everything else. */
export function parseSavedBackdrops(raw: unknown): SavedBackdrops {
  const held = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const nested = typeof held.scenes === 'object' && held.scenes !== null ? (held.scenes as Record<string, unknown>) : {};
  const scenes: Record<string, Scene> = {};
  for (const def of BACKDROP_DEFS) scenes[def.id] = parseScene(def, def.id === 'aquarium' ? raw : nested[def.id]);
  const backdrop = BACKDROPS.find((option) => option.id === held.backdrop)?.id ?? backdropState().id;
  return { scenes, backdrop };
}

/** The most the account's row is let grow to, as text: well inside the 4096 bytes the table's check allows. */
export const ROW_ROOM = 3400;

/**
 * The row as it is saved: lean (see `sceneObject`), and if somebody has swayed and locked so much that it would still be too
 * big for the table, the sways and then the locks of the backgrounds that are not on are left out, so a save is never refused.
 */
export function rowObject(saved: SavedBackdrops): Record<string, unknown> {
  const build = (skip: (id: string, what: '_sway' | '_locks') => boolean): Record<string, unknown> => {
    const scenes: Record<string, unknown> = {};
    let top: Record<string, unknown> = {};
    for (const def of BACKDROP_DEFS) {
      const scene = saved.scenes[def.id];
      if (scene === undefined) continue;
      const stored = sceneObject(scene, def);
      if (skip(def.id, '_sway')) delete stored._sway;
      if (skip(def.id, '_locks')) delete stored._locks;
      if (def.id === 'aquarium') top = stored;
      else if (Object.keys(stored).length > 0) scenes[def.id] = stored;
    }
    return { v: 1, ...top, backdrop: saved.backdrop, ...(Object.keys(scenes).length > 0 ? { scenes } : {}) };
  };
  const fits = (row: Record<string, unknown>) => JSON.stringify(row).length <= ROW_ROOM;
  const off = (id: string) => id !== saved.backdrop;
  const tries: ((id: string, what: '_sway' | '_locks') => boolean)[] = [() => false, (id, what) => off(id) && what === '_sway', (id) => off(id), (_id, what) => what === '_sway', () => true];
  for (const skip of tries) {
    const row = build(skip);
    if (fits(row)) return row;
  }
  return build(() => true);
}

const MOCK_KEY = 'debaser.aquarium.mock.v1';

function readMock(): Record<string, unknown> {
  try {
    const raw = window.localStorage.getItem(MOCK_KEY);
    const parsed = raw === null ? {} : (JSON.parse(raw) as unknown);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const MOCK_STORE: BackdropStore = {
  read: async (person) => {
    const held = readMock()[person];
    return held === undefined ? null : parseSavedBackdrops(held);
  },
  save: async (person, saved) => {
    window.localStorage.setItem(MOCK_KEY, JSON.stringify({ ...readMock(), [person]: rowObject(saved) }));
  },
};

const SUPABASE_STORE: BackdropStore = {
  read: async (person) => {
    const client = getSupabaseBrowserClient();
    if (client === null) throw new Error('No database.');
    const { data, error } = await client.from('user_aquarium').select('settings').eq('person', person).maybeSingle();
    if (error) throw new Error('Your backgrounds could not be read.');
    return data === null ? null : parseSavedBackdrops((data as { settings: unknown }).settings);
  },
  save: async (person, saved) => {
    const client = getSupabaseBrowserClient();
    if (client === null) throw new Error('No database.');
    const { error } = await client.from('user_aquarium').upsert({ person, settings: rowObject(saved) });
    if (error) throw new Error('Your backgrounds could not be saved.');
  },
};

/** Where accounts' settings are kept; null while accounts aren't being saved to (see the note at the top). */
function store(): BackdropStore | null {
  if (USING_MOCK_AUTH) return MOCK_STORE;
  return process.env.NEXT_PUBLIC_AQUARIUM_DATA_SOURCE === 'supabase' ? SUPABASE_STORE : null;
}

/** The aquarium keeps the key it had when it was the only background. */
const browserKey = (id: string) => (id === 'aquarium' ? 'debaser.site.aquarium.v1' : `debaser.site.backdrop.${id}.v1`);
/** Whose account this browser's copies last came from or went to; absent while they are only ever a visitor's. */
const OWNER_KEY = 'debaser.site.aquarium.owner.v1';

function browserOwner(): string | null {
  try {
    return window.localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

function setBrowserOwner(person: string): void {
  try {
    window.localStorage.setItem(OWNER_KEY, person);
  } catch {
    // Without storage there is no copy to mix up either.
  }
}

function readBrowser(def: BackdropDef): Scene {
  if (typeof window === 'undefined') return { values: def.defaults, extras: NO_EXTRAS };
  try {
    const stored = window.localStorage.getItem(browserKey(def.id));
    if (stored === null) return { values: def.defaults, extras: NO_EXTRAS };
    const scene = parseScene(def, JSON.parse(stored));
    // The default itself, when that is what was stored: "is it the default?" is then one comparison.
    return sameValues(def, scene.values, def.defaults) ? { ...scene, values: def.defaults } : scene;
  } catch {
    return { values: def.defaults, extras: NO_EXTRAS };
  }
}

function writeBrowser(id: string, scene: Scene): void {
  try {
    window.localStorage.setItem(browserKey(id), JSON.stringify(sceneObject(scene)));
  } catch {
    // Private windows and full storage: the background still follows for this visit.
  }
}

const scenesSlot = createWindowSlot<Scenes>(Object.fromEntries(BACKDROP_DEFS.map((def) => [def.id, readBrowser(def)])));
const failedSlot = createWindowSlot<boolean>(false);

export const subscribeToBackdropScenes = scenesSlot.subscribe;

/** A background's settings as they stand. The same object until one of its knobs changes. */
export function backdropValues(id: string): Values {
  return scenesSlot.state()[id]?.values ?? backdropDef(id)?.defaults ?? {};
}

/** What is locked and what sways, for a background. */
export function backdropExtras(id: string): Extras {
  return scenesSlot.state()[id]?.extras ?? NO_EXTRAS;
}

export const backdropSaveFailed = failedSlot.state;
export const subscribeToBackdropSaveFailed = failedSlot.subscribe;
export const serverBackdropSaveFailed = (): boolean => false;

let account: string | null = null;
/** Bumped by every change, so an answer that was already on its way can't overwrite what somebody has just set. */
let changes = 0;
/** Which backgrounds have been changed here since the account began to be read (`'backdrop'` for the choice itself). */
const touched = new Set<string>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** Set while the account's own copy is being put on, so that doing so isn't taken for a change to save back. */
let applying = false;

/** How long after the last change the account is written: a slider drag is one save, not one a pixel. */
const SAVE_AFTER_MS = 700;

function saveNow(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
  const keeper = store();
  if (account === null || keeper === null) return;
  keeper
    .save(account, { scenes: scenesSlot.state(), backdrop: backdropState().id })
    .then(() => failedSlot.set(false))
    .catch(() => failedSlot.set(true));
}

function saveSoon(): void {
  if (account === null || store() === null) return;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_AFTER_MS);
}

/** Anything still waiting to be saved goes now: the window closing, the tab being put away. */
export function flushBackdropSave(): void {
  if (saveTimer !== null) saveNow();
}

/** Every background put on as given, in this browser too, without that counting as a change to save. */
function applyScenes(scenes: Scenes, backdrop: BackdropId): void {
  applying = true;
  try {
    const held = scenesSlot.state();
    const next: Record<string, Scene> = {};
    for (const def of BACKDROP_DEFS) {
      const scene = scenes[def.id] ?? { values: def.defaults, extras: NO_EXTRAS };
      const same = sameValues(def, scene.values, held[def.id].values) && JSON.stringify(scene.extras) === JSON.stringify(held[def.id].extras);
      next[def.id] = same ? held[def.id] : scene;
      writeBrowser(def.id, scene);
    }
    if (BACKDROP_DEFS.some((def) => next[def.id] !== held[def.id])) scenesSlot.set(next);
    setBackdrop(backdrop);
  } finally {
    applying = false;
  }
}

/** True when this browser holds nothing but what it came with. */
function untouched(): boolean {
  const held = scenesSlot.state();
  return (
    backdropState().id === DEFAULT_BACKDROP &&
    BACKDROP_DEFS.every((def) => sameValues(def, held[def.id].values, def.defaults) && held[def.id].extras.locks.length === 0 && Object.keys(held[def.id].extras.sway).length === 0)
  );
}

/**
 * Who is signed in, from the settings window's host. Their account's settings and background replace the browser's; an account
 * with none takes the browser's, if the browser has anything worth keeping.
 */
export async function setBackdropAccount(person: string | null): Promise<void> {
  if (person === account) return;
  flushBackdropSave();
  account = person;
  if (failedSlot.state()) failedSlot.set(false);
  const keeper = store();
  if (person === null || keeper === null) return;
  const before = changes;
  touched.clear();
  try {
    const saved = await keeper.read(person);
    if (account !== person) return;
    const owner = browserOwner();
    setBrowserOwner(person);
    if (changes !== before) {
      // Somebody changed a knob while the account was being read. What they touched stays as they set it; every other
      // background is the account's, so a quick hand on one slider can't wipe the rest of what the account held.
      if (saved !== null) {
        const held = scenesSlot.state();
        const merged: Record<string, Scene> = {};
        for (const def of BACKDROP_DEFS) merged[def.id] = touched.has(def.id) ? held[def.id] : (saved.scenes[def.id] ?? held[def.id]);
        applyScenes(merged, touched.has('backdrop') ? backdropState().id : saved.backdrop);
        saveSoon();
      }
      return;
    }
    if (saved !== null) {
      applyScenes(saved.scenes, saved.backdrop);
      return;
    }
    if (owner !== null && owner !== person) {
      // A second person on this browser, with nothing saved: they start on the defaults, not on the last person's.
      applyScenes({}, DEFAULT_BACKDROP);
      return;
    }
    if (!untouched()) await keeper.save(person, { scenes: scenesSlot.state(), backdrop: backdropState().id });
  } catch {
    // The background keeps the browser's copy; changing something tries the account again and says if it fails.
  }
}

function setScene(id: string, scene: Scene): void {
  changes += 1;
  touched.add(id);
  scenesSlot.set({ ...scenesSlot.state(), [id]: scene });
  writeBrowser(id, scene);
  saveSoon();
}

export function setBackdropValues(id: string, next: Values): void {
  const def = backdropDef(id);
  const held = scenesSlot.state()[id];
  if (def === null || held === undefined || sameValues(def, next, held.values)) return;
  setScene(id, { ...held, values: next });
}

/** Locks a knob, or lets it go. */
export function setBackdropLock(id: string, key: string, locked: boolean): void {
  const held = scenesSlot.state()[id];
  if (held === undefined || held.extras.locks.includes(key) === locked) return;
  const locks = locked ? [...held.extras.locks, key] : held.extras.locks.filter((each) => each !== key);
  setScene(id, { ...held, extras: { ...held.extras, locks } });
}

/** Sets the marks a knob sways between; null stops it swaying. */
export function setBackdropSway(id: string, key: string, marks: readonly [number, number] | null): void {
  const held = scenesSlot.state()[id];
  if (held === undefined) return;
  const sway: Record<string, readonly [number, number]> = { ...held.extras.sway };
  if (marks === null) {
    if (!(key in sway)) return;
    delete sway[key];
  } else {
    if (sway[key] !== undefined && sway[key][0] === marks[0] && sway[key][1] === marks[1]) return;
    sway[key] = [Math.min(marks[0], marks[1]), Math.max(marks[0], marks[1])];
  }
  setScene(id, { ...held, extras: { ...held.extras, sway } });
}

// The BACKGROUND choice rides in the account's copy: pressing a background's row is a change to save like any other.
if (typeof window !== 'undefined') {
  subscribeToBackdrop(() => {
    if (applying) return;
    changes += 1;
    touched.add('backdrop');
    saveSoon();
  });
  // A tab being put away may never get to its timer. (Best effort: a browser may drop a request made this late, and then the
  // account keeps what it had a moment before. This browser's own copy is always written first.)
  window.addEventListener('pagehide', flushBackdropSave);
}

/* ------------------------------------------------------------------ the settings window */

/**
 * `dock` is the window's own id in the layout (`DockWindow`'s `id`; it kept the name it had when the aquarium was the only
 * background): the undo arrows read it, to close the right window when this one was opened from PREFERENCES.
 */
export type BackdropWindowState = { open: boolean; seeThrough: boolean; dock: 'aquarium' };

const windowSlot = createWindowSlot<BackdropWindowState>({ open: false, seeThrough: false, dock: 'aquarium' });

export const backdropWindowState = windowSlot.state;
export const subscribeToBackdropWindow = windowSlot.subscribe;

export function openBackdropWindow(): void {
  if (!windowSlot.state().open) windowSlot.set({ ...windowSlot.state(), open: true });
}

export function closeBackdropWindow(): void {
  if (windowSlot.state().open) windowSlot.set({ ...windowSlot.state(), open: false });
  flushBackdropSave();
}

export function toggleBackdropWindow(): void {
  if (windowSlot.state().open) closeBackdropWindow();
  else openBackdropWindow();
}

/** The `[ 50% ]` key: the window itself half see-through, so the background shows through it. */
export function toggleBackdropSeeThrough(): void {
  windowSlot.set({ ...windowSlot.state(), seeThrough: !windowSlot.state().seeThrough });
}
