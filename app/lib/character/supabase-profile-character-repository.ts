import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProfileCharacterRepository, ShownCharacter } from './profile-character-repository';
import { isMood, readSheetAndAge } from './sheet';

/**
 * `profile_characters` and the `profile-characters` picture folder (`20261113022903_profile_characters.sql`). Anyone reads
 * them; the rules there let only the owner write, PNG only, 512 KB a picture, 4 a person, one every 5 seconds.
 */
const BUCKET = 'profile-characters';
const COLUMNS = 'person, character_id, mood, strip, sheet, baked_at';

export function createSupabaseProfileCharacterRepository(client: SupabaseClient): ProfileCharacterRepository {
  const publicUrl = (path: string) => client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  function fromRow(row: Record<string, unknown>): ShownCharacter | null {
    const read = readSheetAndAge(row.sheet);
    if (read === null ||typeof row.person !== 'string' || typeof row.character_id !== 'string' || typeof row.strip !== 'string') return null;
    return {
      person: row.person,
      characterId: row.character_id,
      mood: isMood(row.mood) ? row.mood : 'calm',
      stripUrl: publicUrl(row.strip),
      sheet: read.sheet,
      stale: read.stale,
      bakedAt: typeof row.baked_at === 'string' ? row.baked_at : new Date(0).toISOString(),
    };
  }

  /** Every strip in the person's folder except `keep`, removed. Leftovers from a bake that stopped halfway go too. */
  async function clearFolder(person: string, keep: string | null): Promise<void> {
    const { data } = await client.storage.from(BUCKET).list(person, { limit: 20 });
    const doomed = (data ?? []).map((file) => `${person}/${file.name}`).filter((path) => path !== keep);
    if (doomed.length > 0) await client.storage.from(BUCKET).remove(doomed);
  }

  async function currentStrip(person: string): Promise<string | null> {
    const { data } = await client.from('profile_characters').select('strip').eq('person', person).maybeSingle();
    return typeof data?.strip === 'string' ? data.strip : null;
  }

  return {
    async getShown(person) {
      const { data, error } = await client.from('profile_characters').select(COLUMNS).eq('person', person).maybeSingle();
      if (error || data === null) return null;
      return fromRow(data);
    },

    async show(person, input) {
      const before = await currentStrip(person);
      // Room under the cap of 4 first: anything that isn't the strip on show now.
      await clearFolder(person, before);
      const path = `${person}/${Date.now().toString(36)}.png`;
      const uploaded = await client.storage.from(BUCKET).upload(path, input.strip, { contentType: 'image/png', upsert: false });
      if (uploaded.error) throw new Error('COULD NOT SAVE THE PICTURES');
      const { data, error } = await client
        .from('profile_characters')
        .upsert({ person, character_id: input.characterId, mood: input.mood, strip: path, sheet: input.sheet })
        .select(COLUMNS)
        .single();
      if (error || data === null) {
        await client.storage.from(BUCKET).remove([path]);
        throw new Error('COULD NOT SHOW IT ON YOUR PROFILE');
      }
      if (before !== null && before !== path) await client.storage.from(BUCKET).remove([before]);
      const shown = fromRow(data);
      if (shown === null) throw new Error('COULD NOT SHOW IT ON YOUR PROFILE');
      return shown;
    },

    async setMood(person, mood) {
      const { error } = await client.from('profile_characters').update({ mood }).eq('person', person);
      if (error) throw new Error('COULD NOT SAVE THE MOOD');
    },

    async hide(person) {
      const { error } = await client.from('profile_characters').delete().eq('person', person);
      if (error) throw new Error('COULD NOT TAKE IT OFF YOUR PROFILE');
      await clearFolder(person, null);
    },
  };
}
