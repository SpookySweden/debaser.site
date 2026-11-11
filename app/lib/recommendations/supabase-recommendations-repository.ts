import type { SupabaseClient } from '@supabase/supabase-js';
import type { LetterKind } from '../letters/types';
import { letterFrom, LIST_LIMIT, RECOMMENDATION_ITEMS_MAX, type RecommendationItem, type RecommendationsRepository, type RecommendationSummary } from './types';

type ListRow = {
  id: string;
  sender: string | null;
  sender_name: string | null;
  title: string;
  message: string;
  is_public: boolean;
  forum_thread_id: string | null;
  created_at: string;
  read_at: string | null;
  item_count: number;
  letter: unknown;
};

type ItemRow = { id: string; position: number; kind: LetterKind; ref: string; title: string; picture: string | null };

/** The database's own refusals that are worded for a reader (the send's checks); anything else gets the site's words. */
const READABLE_REFUSALS = [
  'sign in to recommend',
  'a recommendation holds 1 to 50 things',
  'the message is too long',
  'send it to someone, or post it publicly',
  'at most 20 people',
  'not to yourself',
  'someone in that list is not on the site',
  'that is 50 recommendations today, the most there is room for',
];

/**
 * The recommendations tables, through their functions: `recommendations_list` (names only for signed-in people),
 * `recommendation_send` (the one locked send), `recommendation_played`, `recommendation_attach_thread`. Row Level Security
 * decides who reads what; nothing here filters for safety.
 */
export function createSupabaseRecommendationsRepository(client: SupabaseClient): RecommendationsRepository {
  return {
    async list(tab) {
      const { data, error } = await client.rpc('recommendations_list', { p_tab: tab, p_limit: LIST_LIMIT });
      if (error) throw new Error('The recommendations could not be read.');
      return ((data ?? []) as ListRow[]).map(
        (row): RecommendationSummary => ({
          id: row.id,
          sender: row.sender,
          senderName: row.sender_name,
          title: row.title,
          message: row.message,
          isPublic: row.is_public,
          forumThreadId: row.forum_thread_id,
          createdAt: row.created_at,
          readAt: row.read_at,
          itemCount: row.item_count,
          letter: letterFrom(row.letter),
        }),
      );
    },
    async items(id) {
      const { data, error } = await client
        .from('recommendation_items')
        .select('id, position, kind, ref, title, picture')
        .eq('recommendation_id', id)
        .order('position', { ascending: true })
        .limit(RECOMMENDATION_ITEMS_MAX);
      if (error) throw new Error('That recommendation could not be read.');
      return ((data ?? []) as ItemRow[]).map(
        (row): RecommendationItem => ({ id: row.id, position: row.position, kind: row.kind, ref: row.ref, title: row.title, picture: row.picture ?? undefined }),
      );
    },
    async players(ids) {
      const found: Record<string, string[]> = {};
      if (ids.length === 0) return found;
      const { data, error } = await client
        .from('recommendation_plays')
        .select('recommendation_id, person, played_at')
        .in('recommendation_id', [...ids])
        .order('played_at', { ascending: true })
        .limit(2000);
      if (error) return found;
      for (const row of (data ?? []) as { recommendation_id: string; person: string }[]) {
        (found[row.recommendation_id] ??= []).push(row.person);
      }
      return found;
    },
    async send({ message, isPublic, things, to, letter }) {
      const { data, error } = await client.rpc('recommendation_send', {
        p_message: message,
        p_public: isPublic,
        p_items: things.map((thing) => ({ kind: thing.kind, ref: thing.ref, title: thing.title, picture: thing.picture ?? '' })),
        p_to: [...to],
        p_letter: letter ?? null,
      });
      if (error) {
        const said = READABLE_REFUSALS.find((words) => error.message.includes(words));
        throw new Error(said ? said.toUpperCase() + '.' : 'The recommendation could not be sent.');
      }
      return data as string;
    },
    async attachThread(id, threadId) {
      const { error } = await client.rpc('recommendation_attach_thread', { p_rec: id, p_thread: threadId });
      if (error) throw new Error('The forum thread could not be linked.');
    },
    async played(id) {
      await client.rpc('recommendation_played', { p_rec: id });
    },
    async markRead(id, me) {
      await client.from('recommendation_to').update({ read_at: new Date().toISOString() }).eq('recommendation_id', id).eq('person', me).is('read_at', null);
    },
    async remove(id) {
      const { error } = await client.from('recommendations').delete().eq('id', id);
      if (error) throw new Error('The recommendation could not be deleted.');
    },
  };
}
