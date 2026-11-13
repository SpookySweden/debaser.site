'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { CloseRow, Reason } from '../lib/audio/for-you';
import { listedAccounts } from '../lib/auth/hidden';
import { getDocsRepository } from '../lib/docs/repository';
import { LORE_FOLDER_ID, type DocSummary } from '../lib/docs/types';
import { newsHref } from '../lib/forum/news-feed';
import { openLetter } from '../lib/letters/letter-window';
import { getLettersRepository } from '../lib/letters/repository';
import type { Letter } from '../lib/letters/types';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { getRecommendationsRepository } from '../lib/recommendations/repository';
import { keyOf, pickLane, strongestWords, type Candidate, type LanePick } from '../lib/recommender/engine';
import type { HistoryKind, HistoryRow } from '../lib/recommender/types';
import type { Taste } from '../lib/web/recommend';
import { roomIsLive } from '../lib/watch/rules';
import type { LiveRoom } from '../lib/watch/types';
import { enterRoom, useLiveRooms } from '../lib/watch/use-music-room';
import { useAuth } from './AuthProvider';
import { useComms } from './CommsProvider';
import { useForum } from './ForumProvider';
import { Lane, PickFoot, wordsIn } from './ForYouParts';
import ProfileAvatarLink from './ProfileAvatarLink';
import { STATION_KEY } from './TagStationParts';

/**
 * FOR YOU's community lanes (SPEC-recommender.md step 2, Luke 2026-11-13): ON THE BOARD, OPEN ROOMS, LETTERS, LORE and
 * PEOPLE, picked by the same engine as MEDIA. Only what people share openly counts: public threads and replies, open
 * rooms, public letters, lore pages, recommendations sent to the reader, and VANITY's closeness (which already reads
 * replies, DM counts but never text, listening along and profile visits). Never anyone's private history. A person is
 * only offered if the reader has dealt with them or they openly post about the reader's words; a face shows only beside
 * the person themself or something they shared openly. No scores or counts are drawn.
 */

type Context = { taste: Taste; rows: readonly HistoryRow[]; explore: ReadonlyMap<string, string>; now: number; size: number };
type Hide = (kind: HistoryKind, ref: string, title: string, maker: string, words: readonly string[]) => void;

const CLOSE_WHY: Record<Reason, string> = {
  replies: 'YOU REPLY TO EACH OTHER',
  messages: 'YOU MESSAGE EACH OTHER',
  together: 'YOU LISTEN TOGETHER',
  visits: "YOU VISIT EACH OTHER'S PROFILES",
};
/** People whose public letters LETTERS reads. */
const LETTER_PEOPLE = 6;

/** Who the reader has dealt with, and why, strongest reason first: replies, recommendations, VANITY's closeness. */
type Known = Map<string, { why: string; weight: number }>;

function PersonRow({ pick, onHide }: { pick: LanePick<{ id: string; name: string; words: string[] }>; onHide: Hide }) {
  const { profile } = usePublicProfile(pick.item.id);
  const status = profile?.status?.trim() ?? '';
  return (
    <li className="rule-pixel flex items-start gap-2 py-2">
      <ProfileAvatarLink author={{ id: pick.item.id, displayName: pick.item.name }} size={40} />
      <div className="min-w-0 flex-1">
        {status !== '' ? <p className="break-words px-1 text-label text-ink">{status}</p> : null}
        <PickFoot why={pick.why} title={pick.item.name} onHide={() => onHide('person', pick.item.id, pick.item.name, '', pick.item.words)} />
      </div>
    </li>
  );
}

export default function ForYouCommunity({ context, hidden, onHide, close, loading }: { context: Context; hidden: ReadonlySet<string>; onHide: Hide; close: readonly CloseRow[] | null; loading: boolean }) {
  const { user } = useAuth();
  const me = user?.id ?? null;
  const forum = useForum();
  const { accounts } = useComms();
  const { rooms } = useLiveRooms();
  const visible = <T,>(picks: LanePick<T>[]) => picks.filter((pick) => !hidden.has(pick.key));

  const listed = useMemo(() => new Map(listedAccounts(accounts).filter((account) => account.id !== me).map((account) => [account.id, account.displayName])), [accounts, me]);
  const threads = useMemo(() => forum.threads.filter((thread) => !thread.privateRecord && thread.title !== ''), [forum.threads]);

  /* Recommendations sent to the reader: their senders shared something with them openly. */
  const [senders, setSenders] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    if (me === null) return;
    void getRecommendationsRepository()
      .list('for_me')
      .then((found) => live && setSenders([...new Set(found.map((one) => one.sender).filter((id): id is string => id !== null))]))
      .catch(() => live && setSenders([]));
    return () => {
      live = false;
    };
  }, [me]);

  /* Everyone the reader has dealt with, and why. */
  const known = useMemo<Known>(() => {
    const out: Known = new Map();
    const add = (id: string | null | undefined, why: string, weight: number) => {
      if (!id || id === me || !listed.has(id)) return;
      const was = out.get(id);
      if (was === undefined || was.weight < weight) out.set(id, { why, weight });
    };
    if (me !== null) {
      for (const thread of threads) {
        for (const comment of thread.comments) {
          if (thread.author.id === me) add(comment.author.id, 'YOU REPLY TO EACH OTHER', 2);
          if (comment.author.id === me) add(thread.author.id, 'YOU REPLY TO EACH OTHER', 2);
        }
      }
    }
    for (const sender of senders ?? []) add(sender, 'RECOMMENDED YOU SOMETHING', 2.5);
    for (const row of close ?? []) add(row.personId, CLOSE_WHY[row.reason], 1.5);
    return out;
  }, [threads, senders, close, me, listed]);

  /* What each person posts about openly: their threads' tags. */
  const postsAbout = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const thread of threads) {
      const id = thread.author.id;
      if (!id) continue;
      out.set(id, [...new Set([...(out.get(id) ?? []), ...thread.tags.map((tag) => tag.label.toLowerCase())])].slice(0, 12));
    }
    return out;
  }, [threads]);

  /* PEOPLE: people the reader has dealt with, or who openly post about the reader's strongest words. */
  const people = useMemo(() => {
    const strong = new Set(strongestWords(context.taste, 12));
    const candidates: Candidate<{ id: string; name: string; words: string[] }>[] = [];
    for (const [id, name] of listed) {
      const words = postsAbout.get(id) ?? [];
      const reason = known.get(id);
      const shared = words.find((word) => strong.has(word));
      if (reason === undefined && shared === undefined) continue;
      candidates.push({
        key: keyOf('person', id),
        words,
        item: { id, name, words },
        shared: reason ?? { why: `POSTS ABOUT ${(shared as string).toUpperCase()}`, weight: 0.75 },
      });
    }
    return pickLane(candidates, context);
  }, [listed, known, postsAbout, context]);

  /* ON THE BOARD: threads, with what they're about. A thread by someone the reader knows, or about something they opened, says so. */
  const board = useMemo(() => {
    const opened = new Map(context.rows.filter((row) => row.kind === 'media').map((row) => [row.ref, row.title]));
    const candidates: Candidate<(typeof threads)[number]>[] = threads
      .filter((thread) => thread.author.id !== me)
      .map((thread) => {
        const author = thread.author.id ? known.get(thread.author.id) : undefined;
        const about = thread.anchor.kind === 'web' ? opened.get(thread.anchor.id) : undefined;
        const shared = about
          ? { why: `ABOUT ${about.toUpperCase().slice(0, 60)}, WHICH YOU OPENED`, weight: 2 }
          : author
            ? { why: `BY ${thread.author.displayName.toUpperCase()}: ${author.why}`, weight: 1 }
            : undefined;
        return {
          key: keyOf('thread', thread.id),
          words: [...thread.tags.map((tag) => tag.label), ...wordsIn(thread.title)],
          maker: thread.author.displayName,
          item: thread,
          ...(shared ? { shared } : {}),
        };
      });
    return pickLane(candidates, context);
  }, [threads, known, context, me]);

  /* OPEN ROOMS: public rooms live right now, not the reader's own. */
  const roomPicks = useMemo(() => {
    const now = context.now;
    const candidates: Candidate<LiveRoom>[] = (rooms ?? [])
      .filter(({ room }) => room.isPublic && room.hostId !== me && roomIsLive(room, now))
      .map((live) => {
        const host = known.get(live.room.hostId);
        return {
          key: keyOf('room', live.room.id),
          words: wordsIn(live.room.name, live.room.topic, live.current?.link?.title),
          maker: live.room.originalHostLabel,
          item: live,
          ...(host ? { shared: { why: `${live.room.originalHostLabel.toUpperCase()} IS HOSTING: ${host.why}`, weight: 1.5 } } : {}),
        };
      });
    return pickLane(candidates, context);
  }, [rooms, known, context, me]);

  /* LETTERS: the public letters of the people the reader knows best. */
  const letterPeople = useMemo(
    () =>
      [...known.entries()]
        .sort(([a, x], [b, y]) => y.weight - x.weight || (a < b ? -1 : 1))
        .slice(0, LETTER_PEOPLE)
        .map(([id]) => id),
    [known],
  );
  const letterKey = letterPeople.join('|');
  const [letters, setLetters] = useState<{ letter: Letter; name: string }[] | null>(null);
  useEffect(() => {
    let live = true;
    const ids = letterKey === '' ? [] : letterKey.split('|');
    const repository = getLettersRepository();
    void Promise.all(ids.map((id) => repository.listOf(id).catch((): Letter[] => [])))
      .then((found) => live && setLetters(found.flatMap((list, at) => list.filter((letter) => letter.isPublic).map((letter) => ({ letter, name: listed.get(ids[at]) ?? '' })))));
    return () => {
      live = false;
    };
  }, [letterKey, listed]);
  const letterPicks = useMemo(() => {
    const candidates: Candidate<{ letter: Letter; name: string }>[] = (letters ?? []).map((one) => ({
      key: keyOf('letter', one.letter.id),
      words: wordsIn(one.letter.name, one.letter.description),
      maker: one.name,
      item: one,
      shared: { why: `A LETTER BY ${one.name.toUpperCase()}`, weight: 1 },
    }));
    return pickLane(candidates, context);
  }, [letters, context]);

  /* LORE: lore pages, by their words; a page a thread the reader read talks about says so. */
  const [pages, setPages] = useState<DocSummary[] | null>(null);
  useEffect(() => {
    let live = true;
    void getDocsRepository(me)
      .listDocs({ folderId: LORE_FOLDER_ID })
      .then((found) => live && setPages(found.filter((page) => page.slug !== null)))
      .catch(() => live && setPages([]));
    return () => {
      live = false;
    };
  }, [me]);
  const lore = useMemo(() => {
    const read = new Set(context.rows.filter((row) => row.kind === 'thread').map((row) => row.ref));
    const talkedOf = new Map<string, string>();
    for (const thread of threads) if (thread.anchor.kind === 'doc' && read.has(thread.id)) talkedOf.set(thread.anchor.id, thread.title);
    const candidates: Candidate<DocSummary>[] = (pages ?? []).map((page) => {
      const thread = talkedOf.get(page.id);
      return {
        key: keyOf('lore', page.slug as string),
        words: wordsIn(page.title, page.summary),
        maker: page.createdByLabel,
        item: page,
        ...(thread ? { shared: { why: `TALKED ABOUT IN ${thread.toUpperCase().slice(0, 60)}`, weight: 1.5 } } : {}),
      };
    });
    return pickLane(candidates, context);
  }, [pages, threads, context]);

  if (me === null) return null;
  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="flex min-w-0 flex-1 basis-72 flex-col">
        <Lane
          id="for-you-board"
          title="ON THE BOARD"
          loading={loading}
          picks={visible(board)}
          render={(pick) => (
            <li key={pick.key} className="rule-pixel flex flex-col gap-1 py-2">
              <Link href={newsHref(pick.item.id)} className={`${STATION_KEY} block w-full break-words text-left`}>
                {pick.item.title}
              </Link>
              <p className="break-words px-1 text-label text-ink">{pick.item.author.displayName}</p>
              <PickFoot why={pick.why} title={pick.item.title} onHide={() => onHide('thread', pick.item.id, pick.item.title, pick.item.author.displayName, pick.item.tags.map((tag) => tag.label))} />
            </li>
          )}
        />
        <Lane
          id="for-you-rooms"
          title="OPEN ROOMS"
          loading={loading || rooms === null}
          picks={visible(roomPicks)}
          render={(pick) => {
            const { room, current } = pick.item;
            const name = room.name ?? `${room.originalHostLabel.toUpperCase()}'S ROOM`;
            return (
              <li key={pick.key} className="rule-pixel flex flex-col gap-1 py-2">
                <button type="button" onClick={() => enterRoom(room.id, room.origin)} aria-label={`Join ${name}`} className={`${STATION_KEY} block w-full break-words text-left`}>
                  {`[ JOIN ] ${name}`}
                </button>
                <p className="break-words px-1 text-label text-ink">
                  {room.originalHostLabel}
                  {current?.link?.title ? ` · ON NOW: ${current.link.title}` : ''}
                </p>
                <PickFoot why={pick.why} title={name} onHide={() => onHide('room', room.id, name, room.originalHostLabel, [])} />
              </li>
            );
          }}
        />
        <Lane
          id="for-you-lore"
          title="LORE"
          loading={loading || pages === null}
          picks={visible(lore)}
          render={(pick) => (
            <li key={pick.key} className="rule-pixel flex flex-col gap-1 py-2">
              <Link href={`/lore/${pick.item.slug}`} className={`${STATION_KEY} block w-full break-words text-left`}>
                {pick.item.title}
              </Link>
              {pick.item.summary ? <p className="break-words px-1 text-label text-ink">{pick.item.summary}</p> : null}
              <PickFoot why={pick.why} title={pick.item.title} onHide={() => onHide('lore', pick.item.slug as string, pick.item.title, pick.item.createdByLabel, [])} />
            </li>
          )}
        />
      </div>
      <div className="flex min-w-0 flex-1 basis-72 flex-col">
        <Lane id="for-you-people" title="PEOPLE" loading={loading || senders === null} picks={visible(people)} render={(pick) => <PersonRow key={pick.key} pick={pick} onHide={onHide} />} />
        <Lane
          id="for-you-letters"
          title="LETTERS"
          loading={loading || letters === null}
          picks={visible(letterPicks)}
          render={(pick) => (
            <li key={pick.key} className="rule-pixel flex flex-col gap-1 py-2">
              <button type="button" onClick={() => openLetter(pick.item.letter.id)} aria-label={`Open the letter ${pick.item.letter.name}`} className={`${STATION_KEY} block w-full break-words text-left`}>
                {pick.item.letter.name}
              </button>
              {pick.item.letter.description ? <p className="break-words px-1 text-label text-ink">{pick.item.letter.description}</p> : null}
              <PickFoot why={pick.why} title={pick.item.letter.name} onHide={() => onHide('letter', pick.item.letter.id, pick.item.letter.name, pick.item.name, [])} />
            </li>
          )}
        />
      </div>
    </div>
  );
}
