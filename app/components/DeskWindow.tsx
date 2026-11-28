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
  deskAutoOn,
  deskAutoServer,
  deskRequested,
  deskWindowServerState,
  deskWindowState,
  localDay,
  openDesk,
  opensByItself,
  setDeskAuto,
  subscribeToDeskAuto,
  subscribeToDeskWindow,
} from '../lib/desk/desk-window';
import { commentDomId, threadDomId } from '../lib/forum/anchors';
import { displayTitle } from '../lib/forum/site-author';
import { notificationLine, snippet } from '../lib/notifications/feed';
import { notificationHref } from '../lib/notifications/links';
import type { AppNotification } from '../lib/notifications/types';
import { useUnreadRecommendations } from '../lib/recommendations/store';
import { accountSettingsLoaded, serverAccountSettingsLoaded, subscribeToAccountSettingsLoaded } from '../lib/settings/account-settings';
import { clearMainKeys } from '../lib/ui/clear-main-keys';
import { PLATE } from '../lib/ui/controls';
import {
  defaultRect,
  handMoving,
  layoutReady,
  liveWindow,
  setWindowRect,
  subscribeToWindowLayout,
  windowLayoutState,
  type WindowRect,
} from '../lib/ui/window-layout';
import { useLiveRooms } from '../lib/watch/use-music-room';
import { watchHref } from '../lib/watch/watch-window';
import { useAuth } from './AuthProvider';
import { useComms } from './CommsProvider';
import DockWindow from './DockWindow';
import { useForum } from './ForumProvider';
import { useNotifications } from './NotificationsProvider';
import { usePresenceDirectory } from './PresenceProvider';
import ProfileName from './ProfileName';
import RelativeShort from './RelativeShort';
import { explain } from '../lib/ui/explain';

/** The desk's sections, in their fixed order (SPEC-forum-v3.md, Luke's D2A and D3A). */
type SectionKey = 'reading' | 'replies' | 'live' | 'people' | 'waiting';

/*
 * The window (Luke, 2026-11-21: "make it significantly more palatable and less intrusive"). Narrower than it was (520 by 620,
 * over the side panel), as tall as what it holds, and set down beside the side panel rather than over it, so the panel, its
 * bell and its DESK key stay in sight. `desk2`: a box saved at the old size does not stick.
 */
const DESK_LAYOUT = 'desk2';
const DESK_SIZE = { w: 400, h: 360 };
const DESK_MIN = { w: 320, h: 140 };
/** The box the desk last fitted itself to: while it is still in that box, nobody has moved or resized it by hand. */
const DESK_FIT_KEY = 'debaser.desk.fit.v1';
/** Room between the desk and the side panel, and above the music bar. */
const GAP = 8;

/** A row that is one press: lit in `pointed` under the pointer, as rows are. */
const ROW = 'block min-w-0 px-1 py-1 text-ink hover:bg-pointed';
/** A row's first line: who or what, in the writing size; the eye's first stop wears the heavier face. */
const FIRST = 'flex min-w-0 items-baseline gap-2 text-prose';
/** A row's second line: where, and what was said, a size down. */
const SECOND = 'mt-0.5 block truncate text-label';

function readFolds(): SectionKey[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(DESK_FOLDS_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed.filter((key) => typeof key === 'string') as SectionKey[]) : [];
  } catch {
    return [];
  }
}

function sameRect(a: WindowRect, b: WindowRect): boolean {
  return Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2 && Math.abs(a.w - b.w) < 2 && Math.abs(a.h - b.h) < 2;
}

function readFit(): WindowRect | null {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(DESK_FIT_KEY) ?? 'null');
    if (typeof parsed !== 'object' || parsed === null) return null;
    const rect = parsed as Record<string, unknown>;
    return [rect.x, rect.y, rect.w, rect.h].every((n) => typeof n === 'number') ? (parsed as WindowRect) : null;
  } catch {
    return null;
  }
}

/**
 * Where the desk goes when nobody has put it anywhere, and how tall it is: just left of the side panel, its top level with
 * the panel's, and as tall as its sections (up to the music bar). Pure, so a check can ask it.
 */
export function deskFitRect(input: {
  current: WindowRect;
  fresh: boolean;
  panel: { left: number; top: number } | null;
  contentHeight: number;
  top: number;
  floor: number;
}): WindowRect {
  const { current, fresh, panel, contentHeight, top, floor } = input;
  const x = fresh && panel !== null ? Math.max(0, panel.left - GAP - current.w) : current.x;
  const y = fresh && panel !== null ? Math.max(top + GAP, panel.top + GAP) : current.y;
  const room = Math.max(DESK_MIN.h, floor - GAP - y);
  return { x, y, w: current.w, h: Math.round(Math.min(room, Math.max(DESK_MIN.h, contentHeight))) };
}

/**
 * Keeps the open desk beside the side panel and as tall as what it holds, until the reader moves or resizes it: from then on
 * it stays where they put it (the layout store keeps that box, per account and screen shape, as it does every window's).
 */
function useDeskFit(open: boolean) {
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const fit = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (!layoutReady() || handMoving()) return;
        const live = liveWindow(DESK_LAYOUT);
        if (live === undefined || !live.open || live.restore !== null) return;
        const { viewport, top } = windowLayoutState();
        const corner = defaultRect({ min: DESK_MIN, size: DESK_SIZE, dock: 'top' }, viewport, top);
        const fresh = sameRect(live.rect, corner);
        const last = readFit();
        if (!fresh && (last === null || !sameRect(live.rect, last))) return;
        const aside = document.querySelector<HTMLElement>('[data-dock-window="desk"]');
        const body = aside?.querySelector<HTMLElement>('[data-desk]');
        const scroller = body?.parentElement;
        if (!aside || !body || !scroller) return;
        // The frame, the title line and the inside's padding, then what the sections take.
        const chrome = aside.offsetHeight - scroller.clientHeight;
        const padding = Number.parseFloat(window.getComputedStyle(scroller).paddingTop) + Number.parseFloat(window.getComputedStyle(scroller).paddingBottom);
        const panelBox = document.querySelector<HTMLElement>('[data-side-panel]')?.getBoundingClientRect();
        const panel = panelBox !== undefined && panelBox.width > 0 ? { left: panelBox.left, top: panelBox.top } : null;
        const reach = Number.parseFloat(document.documentElement.style.getPropertyValue('--music-top'));
        const floor = window.innerHeight - (Number.isFinite(reach) ? reach : 0);
        const rect = deskFitRect({ current: live.rect, fresh, panel, contentHeight: chrome + padding + body.offsetHeight, top, floor });
        setWindowRect(DESK_LAYOUT, rect);
        // Never over the board's own main keys (+ NEW POST): it hops clear of them, as PREFERENCES does.
        clearMainKeys(DESK_LAYOUT);
        const placed = liveWindow(DESK_LAYOUT)?.rect;
        if (placed === undefined) return;
        try {
          window.localStorage.setItem(DESK_FIT_KEY, JSON.stringify(placed));
        } catch {
          // Without storage it fits this visit only.
        }
      });
    };
    fit();
    const stopLayout = subscribeToWindowLayout(fit);
    const body = document.querySelector<HTMLElement>('[data-dock-window="desk"] [data-desk]');
    const observer = typeof ResizeObserver === 'undefined' || body === null ? null : new ResizeObserver(fit);
    if (observer !== null && body !== null) observer.observe(body);
    return () => {
      window.cancelAnimationFrame(frame);
      stopLayout();
      observer?.disconnect();
    };
  }, [open]);
}

/**
 * AUTO POP-UP, in the title line's right end beside the close key: on, the desk opens by itself on the first forum visit of
 * the day; off, it never does. A switch, so on is the filled pill (docs/design.md), and the word says which.
 */
function AutoPopUpKey() {
  const on = useSyncExternalStore(subscribeToDeskAuto, deskAutoOn, deskAutoServer);
  return (
    <button
      type="button"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={() => setDeskAuto(!on)}
      aria-pressed={on}
      title={on ? 'Opens by itself once a day' : 'Opens only when you press DESK'}
      className={`cursor-pointer px-1 py-0.75 text-label leading-none ${on ? 'key key-fill key-on [--key-fill:var(--color-ink)] text-paper' : 'key'}`}
      data-desk-auto={on ? 'on' : 'off'}
      {...explain(on ? 'Stops the desk opening by itself.' : 'Lets the desk open by itself again.', on ? 'It then opens only when you press DESK.' : 'It does so on your first visit to the forum each day.')}
    >
      {on ? '[ AUTO POP-UP: ON ]' : '[ AUTO POP-UP: OFF ]'}
    </button>
  );
}

/**
 * One section: its name between two rules, as the side panel's are, a Rose chip when something in it is new, and a fold key
 * at the line's end (D3A, remembered in this browser). Drawn only when it has something to say (D2A).
 */
function Section({
  id,
  title,
  fresh,
  folded,
  onFold,
  children,
}: {
  id: SectionKey;
  title: string;
  fresh?: number;
  folded: boolean;
  onFold: (id: SectionKey, open: boolean) => void;
  children: ReactNode;
}) {
  const bodyId = `desk-section-${id}`;
  return (
    <section className="mb-3 last:mb-0" data-desk-section={id} data-folded={folded ? 'true' : undefined}>
      <div className="title-line text-ink">
        <span className="flex items-center gap-2">
          {title}
          {fresh !== undefined && fresh > 0 ? <span className="bg-bubble-pale px-1 text-label text-ink-bar">{fresh} NEW</span> : null}
        </span>
        <button
          type="button"
          onClick={() => onFold(id, folded)}
          aria-expanded={!folded}
          aria-controls={bodyId}
          aria-label={folded ? `Show ${title}` : `Fold ${title} away`}
          title={folded ? 'Show' : 'Fold away'}
          className="key cursor-pointer px-1 py-0.75 text-label leading-none"
          {...explain(folded ? 'Shows this part of the desk again.' : 'Folds this part of the desk away.', folded ? 'To read what is in it.' : 'To keep only what you read in view.')}
        >
          {folded ? '[ + ]' : '[ − ]'}
        </button>
      </div>
      {folded ? null : (
        <div id={bodyId} className="fold-body mt-1">
          {children}
        </div>
      )}
    </section>
  );
}

/** The square a new reply or tag carries, as the bell's rows do; a read one keeps the room so the names line up. */
function NewMark({ unread }: { unread: boolean }) {
  return (
    <span
      {...(unread ? { 'aria-label': 'New', title: 'New' } : { 'aria-hidden': true })}
      className={`inline-block h-2 w-2 shrink-0 self-center border ${unread ? 'border-ink-plate bg-ena' : 'border-transparent'}`}
    />
  );
}

/**
 * YOUR DESK (SPEC-forum-v3.md, Luke 2026-11-17; reworked 2026-11-21): what is waiting for this reader, gathered from what
 * the site already keeps, a small window over the forum beside the side panel. Nothing new is tracked or stored: each
 * section reads the store its own page reads. Signed in only: a visitor has no desk.
 */
export default function DeskWindow() {
  const state = useSyncExternalStore(subscribeToDeskWindow, deskWindowState, deskWindowServerState);
  const auto = useSyncExternalStore(subscribeToDeskAuto, deskAutoOn, deskAutoServer);
  const settingsRead = useSyncExternalStore(subscribeToAccountSettingsLoaded, accountSettingsLoaded, serverAccountSettingsLoaded);
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

  // However it was shut (its [ × ], or the shelf's DESK key), `?desk=1` is spent with it, or the next change of the board's
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

  // The first visit to the forum each day opens it by itself (D1A+) while AUTO POP-UP is on; closing it is enough for the
  // rest of the day. It waits for the account's settings to be read, so a switch turned off on the other computer holds here.
  useEffect(() => {
    if (me === null || status === 'loading' || !settingsRead || !auto) return;
    const frame = window.requestAnimationFrame(() => {
      let lastDay: string | null = null;
      try {
        lastDay = window.localStorage.getItem(DESK_DAY_KEY);
      } catch {
        return;
      }
      const today = localDay(new Date());
      if (!opensByItself({ signedIn: true, onForum: pathname === '/forum', lastDay, today, auto: deskAutoOn() })) return;
      try {
        window.localStorage.setItem(DESK_DAY_KEY, today);
      } catch {
        return;
      }
      openDesk();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [me, status, pathname, settingsRead, auto]);

  // Closing spends `?desk=1` and nothing else: the board's own address (its tab and tags) stays.
  const close = useCallback(() => {
    closeDesk();
    if (!deskRequested(query)) return;
    const rest = new URLSearchParams(asked);
    rest.delete('desk');
    const left = rest.toString();
    router.replace(left.length === 0 ? pathname : `${pathname}?${left}`);
  }, [asked, pathname, query, router]);

  useDeskFit(state.open && me !== null);

  if (!state.open || me === null) return null;

  return (
    <DockWindow
      title="DESK"
      onClose={close}
      id="desk"
      layoutId={DESK_LAYOUT}
      defaultSize={DESK_SIZE}
      minSize={DESK_MIN}
      status="What is waiting for you"
      titleKeys={<AutoPopUpKey />}
    >
      <DeskBody me={me} onLeave={close} />
    </DockWindow>
  );
}

/** "TAGGED YOU", "REPLIED": what someone did, as a reply line says it. */
function replyVerb(item: AppNotification): string {
  return item.kind === 'tag' ? 'TAGGED YOU' : 'REPLIED';
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
  const newReplies = replies.filter((item) => item.readAt === null).length;

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
    const rows: { key: string; at: string; href: string; name: string; verb: string; where: string }[] = [];
    for (const thread of forum.threads) {
      if (thread.author.id !== null && people.has(thread.author.id)) {
        rows.push({ key: thread.id, at: thread.createdAt, href: `/forum#${threadDomId(thread.id)}`, name: thread.author.displayName, verb: 'POSTED', where: displayTitle(thread) });
      }
      for (const comment of thread.comments) {
        if (comment.author.id === null || !people.has(comment.author.id)) continue;
        rows.push({ key: comment.id, at: comment.createdAt, href: `/forum#${commentDomId(comment.id)}`, name: comment.author.displayName, verb: 'REPLIED IN', where: displayTitle(thread) });
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

  const sections: { id: SectionKey; title: string; fresh?: number; body: ReactNode }[] = [];
  if (reading.length > 0)
    sections.push({
      id: 'reading',
      title: 'CONTINUE READING',
      body: reading.map((place) => (
        <Link key={place.bookRef} href={continueHref(place.bookRef)} onClick={onLeave} className={ROW}>
          <span className={FIRST}>
            <span className="min-w-0 truncate font-strong">{place.title || 'A BOOK'}</span>
            <span className="ml-auto shrink-0 text-label">{progressText(place)}</span>
          </span>
        </Link>
      )),
    });
  if (replies.length > 0)
    sections.push({
      id: 'replies',
      title: 'REPLIES TO YOU',
      fresh: newReplies,
      body: replies.map((item) => (
        <Link key={item.id} href={`/forum#${threadDomId(item.threadId ?? '')}`} onClick={onLeave} className={ROW}>
          <span className={FIRST}>
            <NewMark unread={item.readAt === null} />
            <span className="min-w-0 truncate">
              <span className="font-strong">{item.actorName}</span> {replyVerb(item)}
            </span>
            <span className="ml-auto shrink-0 text-label">
              <RelativeShort at={item.createdAt} />
            </span>
          </span>
          <span className={`${SECOND} pl-4`}>{`${item.threadTitle} · "${snippet(item.body, 90)}"`}</span>
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
            <Link key={room.id} href={watchHref({ kind: 'room', roomId: room.id })} onClick={onLeave} className={ROW}>
              <span className={FIRST}>
                <span aria-hidden="true">●</span>
                <span className="min-w-0 truncate">
                  <span className="font-strong">{room.name ?? room.originalHostLabel}</span> IS STREAMING
                </span>
                <span className="ml-auto shrink-0 text-label text-accent-ink">[ ▶ WATCH ]</span>
              </span>
              {current?.link?.title ? <span className={`${SECOND} pl-4`}>{`"${current.link.title}"`}</span> : null}
            </Link>
          ))}
          {online.length > 0 ? (
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-1 py-1 text-label text-ink">
              <span>ONLINE</span>
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
        <Link key={row.key} href={row.href} onClick={onLeave} className={ROW}>
          <span className={FIRST}>
            <span className="min-w-0 truncate">
              <span className="font-strong">{row.name}</span> {row.verb}
            </span>
            <span className="ml-auto shrink-0 text-label">
              <RelativeShort at={row.at} />
            </span>
          </span>
          <span className={SECOND}>{row.where}</span>
        </Link>
      )),
    });
  if (recommendations > 0 || unreadTotal > 0 || letters.length > 0 || comic !== null)
    sections.push({
      id: 'waiting',
      title: 'WAITING FOR YOU',
      body: (
        <>
          {comic !== null ? (
            <Link href={notificationHref(comic) ?? '/forum'} onClick={onLeave} className={ROW}>
              <span className={FIRST}>
                <span className="min-w-0 truncate font-strong">{notificationLine(comic)}</span>
              </span>
            </Link>
          ) : null}
          {/* The counts as keys in one row: what is waiting reads at a glance, and each is one press to it. */}
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 py-1">
            {letters.length > 0 ? (
              <Link href={(letters.length === 1 ? notificationHref(letters[0]) : null) ?? '/recommendations'} onClick={onLeave} className={PLATE} {...explain('Goes to the letters waiting for you.', 'With one, straight to it; with more, to the recommendations page.')}>
                {`[ ${letters.length} ${letters.length === 1 ? 'LETTER' : 'LETTERS'} ]`}
              </Link>
            ) : null}
            {unreadTotal > 0 ? (
              <Link href="/comms" onClick={onLeave} className={PLATE} {...explain('Goes to COMMS, where your unread messages are.', 'To read and answer them.')}>
                {`[ ${unreadTotal} ${unreadTotal === 1 ? 'MESSAGE' : 'MESSAGES'} ]`}
              </Link>
            ) : null}
            {recommendations > 0 ? (
              <Link href="/recommendations" onClick={onLeave} className={PLATE} {...explain('Goes to the recommendations page.', 'To see what people have sent you.')}>
                {`[ ${recommendations} ${recommendations === 1 ? 'RECOMMENDATION' : 'RECOMMENDATIONS'} ]`}
              </Link>
            ) : null}
          </p>
        </>
      ),
    });

  return (
    <div data-desk>
      {sections.length === 0 ? (
        <p className="px-1 py-2 text-key text-ink">{places === null ? 'GATHERING...' : 'ALL CAUGHT UP.'}</p>
      ) : (
        sections.map((section) => (
          <Section key={section.id} id={section.id} title={section.title} fresh={section.fresh} folded={folds.includes(section.id)} onFold={onFold}>
            {section.body}
          </Section>
        ))
      )}
    </div>
  );
}
