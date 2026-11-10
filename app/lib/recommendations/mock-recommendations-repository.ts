import type { LetterThing } from '../letters/types';
import {
  RECOMMENDATION_ITEMS_MAX,
  RECOMMENDATION_MESSAGE_MAX,
  RECOMMENDATION_PEOPLE_MAX,
  recommendationTitle,
  type RecommendationItem,
  type RecommendationsRepository,
  type RecommendationSummary,
} from './types';

type Held = RecommendationSummary & { to: Set<string>; read: Map<string, string>; things: LetterThing[]; plays: string[] };

/**
 * Recommendations in memory for the page load, for the mock accounts: no database, so no notifications and nothing kept.
 * It keeps the database's rules for sending, so the page behaves the same.
 */
export function createMockRecommendationsRepository(whoAmI: () => { id: string; name: string } | null): RecommendationsRepository {
  const held = new Map<string, Held>();
  let next = 1;

  const summary = (rec: Held, me: string | null): RecommendationSummary => ({
    id: rec.id,
    sender: me === null ? null : rec.sender,
    senderName: me === null ? null : rec.senderName,
    title: rec.title,
    message: rec.message,
    isPublic: rec.isPublic,
    forumThreadId: rec.forumThreadId,
    createdAt: rec.createdAt,
    readAt: me === null ? null : (rec.read.get(me) ?? null),
    itemCount: rec.things.length,
  });
  const readable = (rec: Held, me: string | null) => rec.isPublic || (me !== null && (rec.sender === me || rec.to.has(me)));

  return {
    async list(tab) {
      const me = whoAmI()?.id ?? null;
      const all = [...held.values()].reverse();
      if (tab === 'public') return all.filter((rec) => rec.isPublic).map((rec) => summary(rec, me));
      if (me === null) return [];
      if (tab === 'for_me') return all.filter((rec) => rec.to.has(me)).map((rec) => summary(rec, me));
      return all.filter((rec) => rec.sender === me).map((rec) => summary(rec, me));
    },
    async items(id) {
      const rec = held.get(id);
      if (!rec || !readable(rec, whoAmI()?.id ?? null)) return [];
      return rec.things.map((thing, position): RecommendationItem => ({ ...thing, id: `${id}-${position}`, position }));
    },
    async players(ids) {
      const found: Record<string, string[]> = {};
      for (const id of ids) {
        const rec = held.get(id);
        if (rec && rec.plays.length > 0) found[id] = [...rec.plays];
      }
      return found;
    },
    async send({ message, isPublic, things, to }) {
      const me = whoAmI();
      if (me === null) throw new Error('SIGN IN TO RECOMMEND.');
      if (things.length < 1 || things.length > RECOMMENDATION_ITEMS_MAX) throw new Error('A RECOMMENDATION HOLDS 1 TO 50 THINGS.');
      if (message.trim().length > RECOMMENDATION_MESSAGE_MAX) throw new Error('THE MESSAGE IS TOO LONG.');
      const people = [...new Set(to)];
      if (!isPublic && people.length === 0) throw new Error('SEND IT TO SOMEONE, OR POST IT PUBLICLY.');
      if (people.length > RECOMMENDATION_PEOPLE_MAX) throw new Error('AT MOST 20 PEOPLE.');
      if (people.includes(me.id)) throw new Error('NOT TO YOURSELF.');
      const id = `mock-rec-${next++}`;
      held.set(id, {
        id,
        sender: me.id,
        senderName: me.name,
        title: recommendationTitle(message, things),
        message: message.trim(),
        isPublic,
        forumThreadId: null,
        createdAt: new Date().toISOString(),
        readAt: null,
        itemCount: things.length,
        to: new Set(people),
        read: new Map(),
        things: [...things],
        plays: [],
      });
      return id;
    },
    async attachThread(id, threadId) {
      const rec = held.get(id);
      if (rec && rec.sender === whoAmI()?.id && rec.isPublic) rec.forumThreadId = threadId;
    },
    async played(id) {
      const me = whoAmI()?.id ?? null;
      const rec = held.get(id);
      if (me && rec && readable(rec, me) && !rec.plays.includes(me)) rec.plays.push(me);
    },
    async markRead(id, me) {
      const rec = held.get(id);
      if (rec && rec.to.has(me) && !rec.read.has(me)) rec.read.set(me, new Date().toISOString());
    },
    async remove(id) {
      const rec = held.get(id);
      if (rec && rec.sender === whoAmI()?.id) held.delete(id);
    },
  };
}
