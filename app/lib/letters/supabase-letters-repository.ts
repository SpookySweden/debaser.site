import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ITEMS_PER_LETTER_MAX,
  LETTERS_PER_PERSON_MAX,
  TOO_MANY_ITEMS,
  TOO_MANY_LETTERS,
  type Letter,
  type LetterItem,
  type LetterKind,
  type LetterPatch,
  type LettersRepository,
} from './types';

const LETTER_COLUMNS = 'id, owner, name, description, text_colour, stamp_url, stamp_opacity, stamp_density, is_public, created_at, updated_at';
const ITEM_COLUMNS = 'id, letter_id, kind, ref, title, picture, x, y, turn, added_at';

type LetterRow = {
  id: string;
  owner: string;
  name: string;
  description: string;
  text_colour: string | null;
  stamp_url: string | null;
  stamp_opacity: number;
  stamp_density: number;
  is_public: boolean;
  created_at: string;
  updated_at: string;
};

type ItemRow = {
  id: string;
  letter_id: string;
  kind: LetterKind;
  ref: string;
  title: string;
  picture: string | null;
  x: number;
  y: number;
  turn: number;
  added_at: string;
};

function letterFromRow(row: LetterRow): Letter {
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    description: row.description,
    textColour: row.text_colour ?? undefined,
    stampUrl: row.stamp_url ?? undefined,
    stampOpacity: row.stamp_opacity,
    stampDensity: row.stamp_density,
    isPublic: row.is_public,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function itemFromRow(row: ItemRow): LetterItem {
  return {
    id: row.id,
    letterId: row.letter_id,
    kind: row.kind,
    ref: row.ref,
    title: row.title,
    picture: row.picture ?? undefined,
    x: row.x,
    y: row.y,
    turn: row.turn,
    addedAt: row.added_at,
  };
}

function patchToRow(patch: LetterPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.description !== undefined) row.description = patch.description;
  if ('textColour' in patch) row.text_colour = patch.textColour ?? null;
  if ('stampUrl' in patch) row.stamp_url = patch.stampUrl ?? null;
  if (patch.stampOpacity !== undefined) row.stamp_opacity = patch.stampOpacity;
  if (patch.stampDensity !== undefined) row.stamp_density = patch.stampDensity;
  if (patch.isPublic !== undefined) row.is_public = patch.isPublic;
  return row;
}

/**
 * `public.letters` and `public.letter_items`. Row Level Security is the real lock (only the owner writes; anyone reads a
 * public letter): the filters here only say what's being asked for. Words shown to a reader are the site's own.
 */
export function createSupabaseLettersRepository(client: SupabaseClient): LettersRepository {
  return {
    async listOf(owner) {
      const { data, error } = await client
        .from('letters')
        .select(LETTER_COLUMNS)
        .eq('owner', owner)
        .order('created_at', { ascending: true })
        .limit(LETTERS_PER_PERSON_MAX);
      if (error) throw new Error('The letters could not be read.');
      return (data as LetterRow[]).map(letterFromRow);
    },
    async get(id) {
      const { data, error } = await client.from('letters').select(LETTER_COLUMNS).eq('id', id).maybeSingle();
      if (error) throw new Error('That letter could not be read.');
      return data ? letterFromRow(data as LetterRow) : null;
    },
    async items(letterId) {
      const { data, error } = await client
        .from('letter_items')
        .select(ITEM_COLUMNS)
        .eq('letter_id', letterId)
        .order('added_at', { ascending: true })
        .limit(ITEMS_PER_LETTER_MAX);
      if (error) throw new Error('That letter could not be read.');
      return (data as ItemRow[]).map(itemFromRow);
    },
    async create(owner, name) {
      const { data, error } = await client.from('letters').insert({ owner, name }).select(LETTER_COLUMNS).single();
      if (error) throw new Error(error.code === 'P0001' ? TOO_MANY_LETTERS : 'The letter could not be made.');
      return letterFromRow(data as LetterRow);
    },
    async update(id, patch) {
      const { data, error } = await client.from('letters').update(patchToRow(patch)).eq('id', id).select(LETTER_COLUMNS).single();
      if (error) throw new Error('The letter could not be saved.');
      return letterFromRow(data as LetterRow);
    },
    async remove(id) {
      const { error } = await client.from('letters').delete().eq('id', id);
      if (error) throw new Error('The letter could not be deleted.');
    },
    async addItem(letterId, thing, at) {
      const { data, error } = await client
        .from('letter_items')
        .insert({ letter_id: letterId, kind: thing.kind, ref: thing.ref, title: thing.title, picture: thing.picture ?? null, ...at })
        .select(ITEM_COLUMNS)
        .single();
      if (error?.code === '23505') return 'already';
      if (error) throw new Error(error.code === 'P0001' ? TOO_MANY_ITEMS : 'That could not be added.');
      return itemFromRow(data as ItemRow);
    },
    async placeItems(places) {
      const results = await Promise.all(
        places.map(({ id, x, y, turn }) => client.from('letter_items').update({ x, y, turn }).eq('id', id)),
      );
      if (results.some((result) => result.error)) throw new Error('The cards could not all be moved.');
    },
    async removeItem(id) {
      const { error } = await client.from('letter_items').delete().eq('id', id);
      if (error) throw new Error('That could not be taken out.');
    },
  };
}
