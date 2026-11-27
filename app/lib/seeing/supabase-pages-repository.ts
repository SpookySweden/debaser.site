/**
 * Kept pages on the site. Waits for Phase 5's tables (drafted, not run): nothing uses this until `NEXT_PUBLIC_SEEING_DATA_SOURCE=supabase`.
 * Row Level Security decides who reads what; nothing here filters for safety. A copy is a file in the private `seen` store, `<owner>/<page>`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { copyFrom, pageFrom, type MadeCopy, type SeenPage } from './pages';
import type { PagesRepository } from './pages-repository';

const SHOWN_MOST = 300;
/** OWN WEB's own window: its pages are found, checked for today and deleted from these. */
const OWN_WEB_MOST = 2000;
/** The same words as `OWN_WEB_TAG` in `./own-web.ts`; importing it would go in a circle (own-web reads the store that reads this). */
const OWN_WEB_TAG = 'OWN WEB';

type Row = { id: string; owner: string; owner_label: string; address: string; title: string; description: string; picture: string | null; language: string; published: string | null; tags: string[]; note: string; quotes: string[]; has_copy: boolean; private: boolean; created_at: string };

const pageOf = (row: Row): SeenPage | null =>
  pageFrom({ ...row, ownerId: row.owner, ownerLabel: row.owner_label, date: row.published ?? '', hasCopy: row.has_copy, at: Date.parse(row.created_at) });

export function createSupabasePages(client: SupabaseClient): PagesRepository {
  return {
    shared: true,
    async list() {
      // Two windows: OWN WEB keeps a page a day by itself, so in one shared window it would push the pages kept on purpose out of KEPT.
      const columns = 'id, owner, owner_label, address, title, description, picture, language, published, tags, note, quotes, has_copy, private, created_at';
      const [kept, own] = await Promise.all([
        client.from('seen_pages').select(columns).not('tags', 'cs', `{"${OWN_WEB_TAG}"}`).order('created_at', { ascending: false }).limit(SHOWN_MOST),
        client.from('seen_pages').select(columns).contains('tags', [OWN_WEB_TAG]).order('created_at', { ascending: false }).limit(OWN_WEB_MOST),
      ]);
      if (kept.error || own.error) throw new Error('THE KEPT PAGES COULD NOT BE READ');
      return ([...(kept.data ?? []), ...(own.data ?? [])] as Row[])
        .map(pageOf)
        .filter((page) => page !== null)
        .sort((a, b) => b.at - a.at);
    },
    async copyOf(id) {
      const { data: row } = await client.from('seen_page_copies').select('path').eq('page', id).maybeSingle();
      const path = (row as { path?: unknown } | null)?.path;
      if (typeof path !== 'string') return null;
      const { data } = await client.storage.from('seen').download(path);
      if (data === null) return null;
      try {
        return copyFrom(JSON.parse(await data.text()));
      } catch {
        return null;
      }
    },
    async keep(page: SeenPage, copy: MadeCopy | null) {
      const path = `${page.ownerId}/${page.id}`;
      const { error } = await client.from('seen_pages').insert({
        id: page.id,
        address: page.address,
        title: page.title,
        description: page.description,
        picture: page.picture,
        language: page.language,
        published: page.date === '' ? null : page.date,
        tags: page.tags,
        note: page.note,
        quotes: page.quotes,
        has_copy: copy !== null,
        private: page.private,
      });
      if (error) throw new Error('NOT KEPT');
      if (copy === null) return;
      const { error: sent } = await client.storage.from('seen').upload(path, new Blob([JSON.stringify(copy)], { type: 'application/json' }), { upsert: false });
      if (sent) throw new Error('THE CARD IS KEPT, THE COPY IS NOT');
      const { error: noted } = await client.from('seen_page_copies').insert({ page: page.id, path, words: (copy.reading ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 20_000) });
      if (noted) throw new Error('THE CARD IS KEPT, THE COPY IS NOT');
    },
    async remove(page) {
      // The file first: with the card gone, nothing would say where it was.
      if (page.hasCopy) await client.storage.from('seen').remove([`${page.ownerId}/${page.id}`]);
      const { error } = await client.from('seen_pages').delete().eq('id', page.id);
      if (error) throw new Error('NOT DELETED');
    },
  };
}
