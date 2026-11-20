'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { CloseRow } from '../lib/audio/for-you';
import { getMusicRepository } from '../lib/audio/repository';
import { continueHref, progressText, shelves } from '../lib/books/reading-places';
import { getBooksRepository } from '../lib/books/repository';
import type { BookPlace } from '../lib/books/types';
import {
  closeDesk,
  DESK_DAY_KEY,
  DESK_FOLDS_KEY,
  deskRequested,
  deskWindowServerState,
  deskWindowState,
  localDay,
  openDesk,
  opensByItself,
  subscribeToDeskWindow,
} from '../lib/desk/desk-window';
import { commentDomId, threadDomId } from '../lib/forum/anchors';
import { displayTitle } from '../lib/forum/site-author';
import { notificationLine, notificationVerb, snippet } from '../lib/notifications/feed';
import { notificationHref } from '../lib/notifications/links';
import { useUnreadRecommendations } from '../lib/recommendations/store';
import { useLiveRooms } from '../lib/watch/use-music-room';
import { watchHref } from '../lib/watch/watch-window';
import { useAuth } from './AuthProvider';
import { useComms } from './CommsProvider';
import DockWindow from './DockWindow';
import { useForum } from './ForumProvider';
import { useNotifications } from './NotificationsProvider';
import { usePresenceDirectory } from './PresenceProvider';
import ProfileName from './ProfileName';

/** The desk's sections, in their fixed order (SPEC-forum-v3.md, Luke's D2A and D3A). */
type SectionKey = 'reading' | 'replies' | 'live' | 'people' | 'waiting';

const LINE = 'block truncate py-0.5 text-prose text-ink hover:underline';

function readFolds(): SectionKey[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(DESK_FOLDS_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed.filter((key) => typeof key === 'string') as SectionKey[]) : [];
  } catch {
    return [];
  }
}

/**
 * One section: a title line that folds it, remembered in this browser (D3A). Drawn only when it has something to say: an
 * empty section is no section (D2A).
 */
function Section({ id, title, folded, onFold, children }: { id: SectionKey; title: string; folded: boolean; onFold: (id: SectionKey, open: boolean) => void; children: ReactNode }) {
  return (
    <details open={!folded} onToggle={(event) => onFold(id, event.currentTarget.open)} className="mb-2" data-desk-section={id}>
      <summary className="key cursor-pointer px-1 py-0.5 text-label font-bold text-ink">{title}</summary>
      <div className="pt-1 pl-2">{children}</div>
    </details>
  );
}

/**
 * YOUR DESK (SPEC-forum-v3.md, Luke 2026-11-17): what is waiting for this reader, gathered from what the site already
 * keeps, one press from every page and over the forum like MY MUSIC. Nothing new is tracked or stored: each section reads
 * the store its own page reads. Signed in only: a visitor has no desk.
 */
export default function DeskWindow() {
  const state = useSyncExternalStore(subscribeToDeskWindow, deskWindowState, deskWindowServerState);
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { user, status } = useAuth();
  const me = user?.id ?? null;
  const asked = search.toString();
  const query = asked.length === 0 ? '' : `?${asked}`;

  useEffect(() => {
    if (deskRequested(query) && me !== null) openDesk();
  }, [query, me]);

  // However it was shut (its [ × ], or the top bar's DESK key), `?desk=1` is spent with it, or the next change of the board's
  // address would open it again.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (state.open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    if (!deskRequested(query)) return;
    const rest = new URLSearchParams(asked);
    rest.delete('desk');
    const left = rest.toString();
    router.replace(left.length === 0 ? pathname : `${pathname}?${left}`);
  }, [state.open, query, asked, pathname, router]);

  // The first visit to the forum each day opens it by itself (D1A+); closing it is enough for the rest of the day.
  useEffect(() => {
    if (me === null || status === 'loading') return;
    const frame = window.requestAnimationFrame(() => {
      let lastDay: string | null = null;
      try {
        lastDay = window.localStorage.getItem(DESK_DAY_KEY);
      } catch {
        return;
      }
      const today = localDay(new Date());
      if (!opensByItself({ signedIn: true, onForum: pathname === '/forum', lastDay, today })) return;
      try {
        window.localStorage.setItem(DESK_DAY_KEY, today);
      } catch {
        return;
      }
      openDesk();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [me, status, pathname]);

  // Closing spends `?desk=1` and nothing else: the board's own address (its tab and tags) stays.
  const close = useCallback(() => {
    closeDesk();
    if (!deskRequested(query)) return;
    const rest = new URLSearchParams(asked);
    rest.delete('desk');
    const left = rest.toString();
    router.replace(left.length === 0 ? pathname : `${pathname}?${left}`);
  }, [asked, pathname, query, router]);

  if (!state.open || me === null) return null;

  return (
    <DockWindow title="DESK" onClose={close} id="desk" defaultSize={{ w: 520, h: 620 }} minSize={{ w: 340, h: 240 }}>
      <DeskBody me={me} onLeave={close} />
    </DockWindow>
  );
}

export function DeskBody({ me, onLeave }: { me: string; onLeave: () => void }) {
  const [folds, setFolds] = useState<SectionKey[]>(readFolds);
  const onFold = useCallback((id: SectionKey, open: boolean) => {
    setFolds((current) => {
      const next = open ? current.filter((key) => key !== id) : current.includes(id) ? current : [...current, id];
      try {
        window.localStorage.setItem(DESK_FOLDS_KEY, JSON.stringify(next));
      } catch {
        // Kept for this visit.
      }
      return next;
    });
  }, []);

  // CONTINUE READING: the books started and not finished, newest first, as READ's own shelf has them.
  const [places, setPlaces] = useState<BookPlace[] | null>(null);
  useEffect(() => {
    let live = true;
    void getBooksRepository()
      .places(me)
      .then((found) => live && setPlaces(found))
      .catch(() => live && setPlaces([]));
    return () => {
      live = false;
    };
  }, [me]);
  const reading = shelves(places ?? []).reading.slice(0, 3);

  // REPLIES TO YOU: the replies and tags the bell holds, unread first.
  const { items } = useNotifications();
  const replies = useMemo(
    () =>
      items
        .filter((item) => (item.kind === 'reply' || item.kind === 'tag') && item.threadId !== null)
        .sort((a, b) => Number(a.readAt !== null) - Number(b.readAt !== null) || b.createdAt.localeCompare(a.createdAt))
        .slice(0, 4),
    [items],
  );

  // LIVE NOW: the rooms on now, and the people whose lamp is on.
  const { rooms } = useLiveRooms();
  const { accounts, unreadTotal } = useComms();
  const presence = usePresenceDirectory();
  const online = accounts.filter((account) => account.id !== me && presence.statusFor(account.id) === 'online').slice(0, 6);

  // FROM PEOPLE YOU TALK TO: the closest people VANITY already works out, and their newest posts and replies.
  const [close, setClose] = useState<CloseRow[]>([]);
  useEffect(() => {
    let live = true;
    void getMusicRepository()
      .forYou(me)
      .then((rows) => live && setClose(rows))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [me]);
  const forum = useForum();
  const fromPeople = useMemo(() => {
    const people = new Set(close.map((row) => row.personId).filter((id) => id !== me));
    if (people.size === 0) return [];
    const rows: { key: string; at: string; href: string; author: { id: string; displayName: string }; text: string }[] = [];
    for (const thread of forum.threads) {
      if (thread.author.id !== null && people.has(thread.author.id)) {
        rows.push({ key: thread.id, at: thread.createdAt, href: `/forum#${threadDomId(thread.id)}`, author: { id: thread.author.id, displayName: thread.author.displayName }, text: `POSTED "${displayTitle(thread)}"` });
      }
      for (const comment of thread.comments) {
        if (comment.author.id === null || !people.has(comment.author.id)) continue;
        rows.push({ key: comment.id, at: comment.createdAt, href: `/forum#${commentDomId(comment.id)}`, author: { id: comment.author.id, displayName: comment.author.displayName }, text: `REPLIED IN "${displayTitle(thread)}"` });
      }
    }
    return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 4);
  }, [close, forum.threads, me]);

  // WAITING FOR YOU: recommendations sent to you and messages not yet read; letters and new comic pages from the bell's
  // feed (SPEC-notifications.md). RECOMMENDATIONS keeps RECOMMENDED's own count (letters included): the bell's and
  // RECOMMENDED's read marks are separate, so subtracting one from the other could hide a recommendation.
  const recommendations = useUnreadRecommendations(me, true);
  const letters = useMemo(() => items.filter((item) => item.kind === 'letter' && item.readAt === null), [items]);
  const comic = useMemo(() => items.find((item) => item.kind === 'comic' && item.readAt === null) ?? null, [items]);

  const sections: { id: SectionKey; title: string; body: ReactNode }[] = [];
  if (reading.length > 0)
    sections.push({
      id: 'reading',
      title: 'CONTINUE READING',
      body: reading.map((place) => (
        <Link key={place.bookRef} href={continueHref(place.bookRef)} onClick={onLeave} className={LINE}>
          {`${place.title || 'A BOOK'} · ${progressText(place)}`}
        </Link>
      )),
    });
  if (replies.length > 0)
    sections.push({
      id: 'replies',
      title: `REPLIES TO YOU${replies.some((item) => item.readAt === null) ? ` (${replies.filter((item) => item.readAt === null).length} NEW)` : ''}`,
      body: replies.map((item) => (
        <Link key={item.id} href={`/forum#${threadDomId(item.threadId ?? '')}`} onClick={onLeave} className={`${LINE} ${item.readAt === null ? 'font-bold' : ''}`}>
          {`${item.actorName} ${notificationVerb(item.kind)} "${item.threadTitle}": ${snippet(item.body, 80)}`}
        </Link>
      )),
    });
  if ((rooms?.length ?? 0) > 0 || online.length > 0)
    sections.push({
      id: 'live',
      title: 'LIVE NOW',
      body: (
        <>
          {(rooms ?? []).slice(0, 4).map(({ room, current }) => (
            <Link key={room.id} href={watchHref({ kind: 'room', roomId: room.id })} onClick={onLeave} className={LINE}>
              {`● ${room.name ?? room.originalHostLabel} IS STREAMING${current?.link?.title ? ` "${current.link.title}"` : ''} [ ▶ WATCH ]`}
            </Link>
          ))}
          {online.length > 0 ? (
            <p className="flex flex-wrap items-center gap-x-2 py-0.5 text-prose text-ink">
              <span>ONLINE:</span>
              {online.map((account) => (
                <ProfileName key={account.id} author={{ id: account.id, displayName: account.displayName }} />
              ))}
            </p>
          ) : null}
        </>
      ),
    });
  if (fromPeople.length > 0)
    sections.push({
      id: 'people',
      title: 'FROM PEOPLE YOU TALK TO',
      body: fromPeople.map((row) => (
        <p key={row.key} className="flex min-w-0 items-baseline gap-2 py-0.5 text-prose text-ink">
          <ProfileName author={row.author} />
          <Link href={row.href} onClick={onLeave} className="min-w-0 truncate hover:underline">
            {row.text}
          </Link>
        </p>
      )),
    });
  if (recommendations > 0 || unreadTotal > 0 || letters.length > 0 || comic !== null)
    sections.push({
      id: 'waiting',
      title: 'WAITING FOR YOU',
      body: (
        <>
          {comic !== null ? (
            <Link href={notificationHref(comic) ?? '/forum'} onClick={onLeave} className={LINE}>
              {notificationLine(comic)}
            </Link>
          ) : null}
          {letters.length > 0 ? (
            <Link href={(letters.length === 1 ? notificationHref(letters[0]) : null) ?? '/recommendations'} onClick={onLeave} className={LINE}>
              {letters.length === 1 ? notificationLine(letters[0]) : `${letters.length} LETTERS`}
            </Link>
          ) : null}
          {unreadTotal > 0 ? (
            <Link href="/comms" onClick={onLeave} className={LINE}>
              {`${unreadTotal} ${unreadTotal === 1 ? 'MESSAGE' : 'MESSAGES'}`}
            </Link>
          ) : null}
          {recommendations > 0 ? (
            <Link href="/recommendations" onClick={onLeave} className={LINE}>
              {`${recommendations} ${recommendations === 1 ? 'RECOMMENDATION' : 'RECOMMENDATIONS'}`}
            </Link>
          ) : null}
        </>
      ),
    });

  return (
    <div data-desk>
      {sections.length === 0 ? (
        <p className="p-2 text-key font-bold text-ink">{places === null ? 'GATHERING YOUR DESK...' : 'NOTHING WAITING. ALL CAUGHT UP.'}</p>
      ) : (
        sections.map((section) => (
          <Section key={section.id} id={section.id} title={section.title} folded={folds.includes(section.id)} onFold={onFold}>
            {section.body}
          </Section>
        ))
      )}
    </div>
  );
}
