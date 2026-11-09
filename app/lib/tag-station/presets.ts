import { getSupabaseBrowserClient } from '../supabase/client';
import { WEB_DATA_SOURCE } from '../web/repository';
import { EMPTY_RECIPE, parseRecipe, recipeQuery, type Recipe } from './recipe';

/**
 * DISCOVER's saved settings (SPEC-discover.md): named presets, one active, saved to the account so they follow a person between devices. A
 * preset's settings are the page's own address query, read back through the same checks, so they can hold nothing an address can't.
 *
 * Mock and Supabase stores. Row Level Security keeps each person to their own, and to 20.
 */
export type Preset = { id: string; name: string; settings: string; active: boolean };

export const MAX_PRESETS = 20;
export const MAX_PRESET_NAME = 40;

export type PresetStore = {
  list(): Promise<Preset[]>;
  add(name: string, settings: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Null makes none active. */
  activate(id: string | null): Promise<void>;
};

let mock: Preset[] = [];
let mockId = 0;
const MOCK_STORE: PresetStore = {
  list: async () => mock.map((one) => ({ ...one })),
  add: async (name, settings) => {
    if (mock.length >= MAX_PRESETS) throw new Error('Twenty is the most you can save.');
    mockId += 1;
    mock = [...mock, { id: `mock-preset-${mockId}`, name, settings, active: false }];
  },
  rename: async (id, name) => {
    mock = mock.map((one) => (one.id === id ? { ...one, name } : one));
  },
  remove: async (id) => {
    mock = mock.filter((one) => one.id !== id);
  },
  activate: async (id) => {
    mock = mock.map((one) => ({ ...one, active: one.id === id }));
  },
};

const FAILED = 'That could not be saved. Try again.';
const client = () => {
  const db = getSupabaseBrowserClient();
  if (db === null) throw new Error(FAILED);
  return db;
};
const SUPABASE_STORE: PresetStore = {
  list: async () => {
    // A visitor (MEDIA is open to them since 2026-11-09) or a stream-room guest has no presets: not asked, so the refusal never shows in their console.
    const { data: held } = await client().auth.getSession();
    if (held.session === null || held.session.user.is_anonymous === true) return [];
    const { data, error } = await client().from('discover_presets').select('id, name, settings, active').order('created_at').limit(MAX_PRESETS);
    if (error) throw new Error('Your presets could not be read.');
    return (data ?? []) as Preset[];
  },
  add: async (name, settings) => {
    const { error } = await client().from('discover_presets').insert({ name, settings });
    if (error) throw new Error('That could not be saved. Twenty is the most you can keep.');
  },
  rename: async (id, name) => {
    const { error } = await client().from('discover_presets').update({ name }).eq('id', id);
    if (error) throw new Error(FAILED);
  },
  remove: async (id) => {
    const { error } = await client().from('discover_presets').delete().eq('id', id);
    if (error) throw new Error(FAILED);
  },
  activate: async (id) => {
    const { error } = await client().rpc('discover_preset_activate', { p_id: id });
    if (error) throw new Error(FAILED);
  },
};

export function getPresetStore(): PresetStore {
  return WEB_DATA_SOURCE === 'supabase' ? SUPABASE_STORE : MOCK_STORE;
}

/** The part of a recipe that's "how my algorithm is applied": not what's chosen right now, or how it's shown. */
export function presetSettings(recipe: Recipe): string {
  return recipeQuery({ ...recipe, tag: null, item: null, link: null, view: EMPTY_RECIPE.view });
}

/** A preset's settings back as a recipe, keeping what's chosen and how it's shown. Checked as any address is. */
export function withPreset(recipe: Recipe, settings: string): Recipe {
  return { ...parseRecipe(new URLSearchParams(settings)), tag: recipe.tag, item: recipe.item, link: recipe.link, view: recipe.view };
}

export function cleanPresetName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_PRESET_NAME);
  return name.length === 0 ? null : name;
}
