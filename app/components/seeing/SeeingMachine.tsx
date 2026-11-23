'use client';

/**
 * BROWSER, the DEBASER SEEING MACHINE (SPEC-seeing-machine.md): tabs, the address box, the lens keys, the page and the status line.
 *
 * Phase 1 is the shell: only the built-in test page opens, and nothing is fetched. For people with an account (D2); signed out, it shows
 * the sign-in call. Only the tab in front has a page; coming back to a tab opens its page again.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { addressInHash, browserHref, mediaInHash, readAddress } from '../../lib/seeing/address';
import { subscribeToAsked, takeAsked } from '../../lib/seeing/ask';
import { readerRef } from '../../lib/seeing/read-ref';
import type { FoundMedia, SeenDocument, SeeStep } from '../../lib/seeing/engine';
import { LENS_NAMES, type LensId } from '../../lib/seeing/lenses/names';
import { noteSeen, openHistoryOf } from '../../lib/seeing/history-store';
import { bringBack, erase, erasedOn, lensRemembered, markGood, rememberLens, siteMemory, siteMemoryOnServer, subscribeToMemory } from '../../lib/seeing/memory';
import { askedOf, cleanWords, engineChosen, enginesOn, readBox, sayBox, searchAddress, type Engine } from '../../lib/seeing/search';
import { searchChoices, searchChoicesOnServer, subscribeToSearch } from '../../lib/seeing/search-store';
import { openSearch } from '../../lib/search/site-search';
import { beatBoxHref } from '../../lib/seeing/sonify';
import { samePage } from '../../lib/seeing/together';
import { follow, joinTogether, lead, leadTo, stopLeading, subscribeToTogether, together, togetherOnServer } from '../../lib/seeing/together-store';
import { ownRoomState, subscribeToOwnRoom } from '../../lib/watch/own-room-client';
import { subscribeToWatchWindow, watchWindowState } from '../../lib/watch/watch-window';
import { shortName } from '../../lib/seeing/address';
import { trayOf } from '../../lib/seeing/media';
import { dialOf, dialTo } from '../../lib/seeing/time';
import { addTab, canGoBack, canGoForward, closeTab, frontTab, showTab, step, stopOf, TABS_MOST, visit, withDraft, withAddress, withLens, withTitle, type Tabs } from '../../lib/seeing/tabs';
import { changeTabs, freshId, letTabsGo, openTabsOf, seeingTabs, seeingTabsOnServer, subscribeToSeeingTabs } from '../../lib/seeing/tabs-store';
import { pageOf } from '../../lib/seeing/margins';
import { openMarginsOf } from '../../lib/seeing/margins-store';
import { notesState, notesStateOnServer, openNotesOn, subscribeToNotes } from '../../lib/seeing/notes-store';
import type { SharedNote } from '../../lib/seeing/account';
import { keptId } from '../../lib/seeing/pages';
import { keptPage, keptPages, keptPagesOnServer, openKeptPagesOf, subscribeToKeptPages } from '../../lib/seeing/pages-store';
import type { FrameScroll } from '../../lib/seeing/frame';
import { engineFor } from '../../lib/seeing/engines';
import { extensionState, extensionStateOnServer, lookForExtension, subscribeToExtension } from '../../lib/seeing/extension-store';
import { openInOwnEye, tellOwnEyeTheme } from '../../lib/seeing/own-eye';
import { openExtensionWindow } from '../../lib/ui/extension-window';
import { scriptsOff, setScriptsOff, siteSettings, siteSettingsOnServer, subscribeToSiteSettings } from '../../lib/seeing/site-settings';
import { PLATE, PLATE_PRESSED, TITLE_BAR } from '../../lib/ui/controls';
import { subscribeToTheme, themeState } from '../../lib/ui/theme-slot';
import { useAuth } from '../AuthProvider';
import SeeingEngines from './SeeingEngines';
import SeeingStart from './SeeingStart';
import SeeingAcquiring from './SeeingAcquiring';
import SeeingElapsed from './SeeingElapsed';
import SeeingRefused from './SeeingRefused';
import { seeingKey, type SeeingKey } from '../../lib/seeing/keys';
import { took } from '../../lib/seeing/took';
import SeeingHistory from './SeeingHistory';
import SeeingKeep from './SeeingKeep';
import SeeingKept from './SeeingKept';
import SeeingLenses from './SeeingLenses';
import SeeingMargins from './SeeingMargins';
import SeeingStage, { type Loupe } from './SeeingStage';
import SeeingTabs from './SeeingTabs';
import SeeingToolbar from './SeeingToolbar';
import SeeingTools from './SeeingTools';
import SeeingTray from './SeeingTray';
import { useLensSettings } from './use-lens-settings';

/** What came of opening a page. `key` says which opening it was, so an answer to an earlier one is never drawn as this one's. */
type Shown =
  | { key: string; state: 'busy'; at: SeeStep | null; since?: number }
  | { key: string; state: 'stopped' }
  | { key: string; state: 'shown'; document: SeenDocument; ms?: number }
  | { key: string; state: 'refused'; reason: string; eye: string; ms: number };

const NO_MEDIA: readonly FoundMedia[] = [];
const NO_NOTES: readonly SharedNote[] = [];
const NOTHING: Shown = { key: '', state: 'stopped' };

/** A public list's own random page of the small, old web (idea vii). It answers with a page that sends people on, which a page may. */
const SCAN_ADDRESS = 'https://wiby.me/surprise/';

/** Other engines offered on a results page. */
const ASKED_SHOWN = 9;

/** One line of fault words: White on Rose, as every fault is. */
const FAULT = 'w-fit bg-bubble-pale px-1 text-label text-ink-bar';

export default function SeeingMachine() {
  const { status, user } = useAuth();
  const owner = status === 'signed-in' && user !== null ? user.id : null;
  const held = useSyncExternalStore(subscribeToSeeingTabs, seeingTabs, seeingTabsOnServer);

  useEffect(() => {
    if (status !== 'loading') {
      openHistoryOf(owner);
      openMarginsOf(owner);
    }
    if (status !== 'loading') void openKeptPagesOf(owner);
    if (owner !== null) openTabsOf(owner);
    else if (status !== 'loading') letTabsGo();
  }, [owner, status]);

  return (
    <div className="seeing flex h-full min-h-[24rem] flex-col px-2 pt-1 max-sm:overflow-y-auto" data-seeing>
      <h1 className={TITLE_BAR}>THE SEEING MACHINE</h1>
      {owner !== null && held.owner === owner ? (
        <Machine key={owner} state={held.state} owner={{ id: owner, label: user?.displayName ?? '' }} />
      ) : status === 'loading' || owner !== null ? null : (
        <p className="p-3 text-prose text-ink">
          <Link href="/account" className={PLATE}>
            [ LOG IN ]
          </Link>{' '}
          TO OPEN BROWSER
        </p>
      )}
    </div>
  );
}

function Machine({ state, owner }: { state: Tabs; owner: { id: string; label: string } }) {
  const tab = frontTab(state);
  const stop = stopOf(tab);
  const address = stop?.address ?? null;
  const { settings, setSettings } = useLensSettings();
  const memory = useSyncExternalStore(subscribeToMemory, siteMemory, siteMemoryOnServer);
  const [seam, setSeam] = useState<LensId | null>(null);
  const [loupe, setLoupe] = useState<Loupe | null>(null);
  const [erasing, setErasing] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [keptOpen, setKeptOpen] = useState(false);
  const [keeping, setKeeping] = useState(false);
  const [noting, setNoting] = useState(false);
  const [listing, setListing] = useState(false);
  const moverRef = useRef<((to: FrameScroll) => void) | null>(null);
  const choices = useSyncExternalStore(subscribeToSearch, searchChoices, searchChoicesOnServer);
  const [drawing, setDrawing] = useState(false);
  const finderRef = useRef<((index: number) => void) | null>(null);
  const router = useRouter();
  const held = useSyncExternalStore(subscribeToNotes, notesState, notesStateOnServer);
  const page = pageOf(address);
  const { id: ownerId, label: ownerLabel } = owner;
  useEffect(() => openNotesOn(pageOf(address), { id: ownerId, label: ownerLabel }), [address, ownerId, ownerLabel]);
  const notes = held.page === page ? held.notes : NO_NOTES;
  const marks = useMemo(() => notes.map((each) => each.quote), [notes]);
  const [selected, setSelected] = useState<{ key: string; text: string }>({ key: '', text: '' });
  const kept = useSyncExternalStore(subscribeToKeptPages, keptPages, keptPagesOnServer);
  const [sent, setSent] = useState<readonly FoundMedia[]>(NO_MEDIA);
  const extension = useSyncExternalStore(subscribeToExtension, extensionState, extensionStateOnServer).kind;
  const ownEye = extension === 'current' || extension === 'old';
  const themeId = useSyncExternalStore(subscribeToTheme, themeState, themeState).id;
  useEffect(() => {
    void lookForExtension();
  }, []);
  useEffect(() => {
    if (ownEye) void tellOwnEyeTheme(themeId);
  }, [ownEye, themeId]);
  const erased = erasedOn(address);

  // A press of reload, or of stop, makes a new opening of the same page.
  const [turn, setTurn] = useState(0);
  const key = address === null ? '' : `${tab.id}:${tab.at}:${address}:${turn}`;
  const [shown, setShown] = useState<Shown>(NOTHING);
  const now: Shown = shown.key === key ? shown : address === null ? NOTHING : { key, state: 'busy', at: null };
  // The opening a page that was sent on has already had, under the address it ended at.
  const landed = useRef('');
  const work = useRef<AbortController | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Counted by the page's own drawing; another page's count is never this one's.
  const [restricted, setRestricted] = useState<{ key: string; count: number }>({ key: '', count: 0 });
  const onRestricted = useCallback((count: number) => setRestricted({ key, count }), [key]);
  useSyncExternalStore(subscribeToSiteSettings, siteSettings, siteSettingsOnServer);

  useEffect(() => {
    if (address === null) return;
    if (landed.current === key) return;
    landed.current = '';
    const going = new AbortController();
    work.current = going;
    const engine = engineFor(address);
    const began = performance.now();
    setShown({ key, state: 'busy', at: null, since: began });
    const before = tab.at > 0 ? (tab.stops[tab.at - 1]?.address ?? null) : null;
    const cameFrom = before !== null && /^https?:/.test(before) ? before : null;
    void engine
      .open(address, (at) => {
        if (!going.signal.aborted) setShown({ key, state: 'busy', at, since: began });
      }, going.signal)
      .catch(() => ({ ok: false as const, reason: 'SOMETHING WENT WRONG' }))
      .then((answer) => {
        if (going.signal.aborted) return;
        if (answer.ok) {
          const end = readAddress(answer.document.address);
          const endKey = end.ok ? `${tab.id}:${tab.at}:${end.address}:${turn}` : key;
          landed.current = endKey;
          setShown({ key: endKey, state: 'shown', document: answer.document, ms: Math.round(performance.now() - began) });
          // SITE MEMORY: a site opens in the lens it was last looked at through.
          const remembered = lensRemembered(answer.document.address);
          if (remembered !== null) changeTabs((all) => withLens(all, tab.id, remembered));
          changeTabs((all) => withTitle(all, tab.id, address, answer.document.title));
          // Yours alone: the page, and the one it was come to from.
          noteSeen({ address: answer.document.address, title: answer.document.title, at: Date.now(), from: cameFrom });
          // Where it was sent on to, so the box says where it really is and its links are its own.
          if (answer.document.address !== address) changeTabs((all) => withAddress(all, tab.id, address, answer.document.address));
        } else setShown({ key, state: 'refused', reason: answer.reason, eye: engine.name, ms: Math.round(performance.now() - began) });
      });
    return () => going.abort();
    // (The stop before is read as it was when this one was opened; it does not open the page again.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, key, tab.id, tab.at, turn]);

  // A link that brought an address (`/browser#see=...`): put in the box of a new tab, waiting for GO. Any page anywhere can carry such a
  // link, so it never opens by itself, unless it is the page already in front, as it is after a reload.
  useEffect(() => {
    const take = () => {
      // A `[ SEE ]` pressed on this site is the press that opens it.
      const asked = takeAsked();
      if (asked !== null) {
        changeTabs((all) => {
          const room = stopOf(frontTab(all)) === null ? all : addTab(all, freshId());
          return visit(room, room.front, asked);
        });
        return;
      }
      const media = mediaInHash(window.location.hash);
      if (media !== null) {
        // From the extension: in the tray, waiting for a press. Nothing plays because a link said so.
        setSent([{ address: media.address, title: media.title, from: 'link', seconds: null }]);
        setTrayOpen(true);
        window.history.replaceState(window.history.state, '', browserHref(stopOf(frontTab(seeingTabs().state))?.address ?? null));
        return;
      }
      const brought = addressInHash(window.location.hash);
      if (brought === null) return;
      const inFront = stopOf(frontTab(seeingTabs().state));
      if (inFront?.address === brought) return;
      const id = freshId();
      changeTabs((all) => {
        // A tab that has it already (the press that brought it opened it a moment ago): that one, in front, and nothing new.
        const already = all.tabs.find((each) => stopOf(each)?.address === brought || each.draft === brought);
        if (already !== undefined) return showTab(all, already.id);
        const room = inFront === null ? all : addTab(all, id);
        return withDraft(room, room.front, brought);
      });
    };
    take();
    window.addEventListener('hashchange', take);
    const stopAsking = subscribeToAsked(take);
    return () => {
      stopAsking();
      window.removeEventListener('hashchange', take);
    };
  }, []);

  // The address in front, kept after the `#` of this page's own, so it can be copied and come back to. After the effect above, which
  // reads what was there on arrival.
  const href = browserHref(address);
  useEffect(() => {
    // From the tabs as they are now, not as this drawing saw them: a press taken just before (above) has moved them on, and an
    // old address written here would come back as a link that brought it.
    const now = browserHref(stopOf(frontTab(seeingTabs().state))?.address ?? null);
    if (window.location.pathname === '/browser' && window.location.pathname + window.location.hash !== now) {
      window.history.replaceState(window.history.state, '', now);
    }
  }, [href, tab.id, tab.draft]);

  const go = useCallback(
    (text: string, newTab = false) => {
      const read = readAddress(text);
      if (!read.ok) {
        setNotice(read.reason);
        return;
      }
      if (newTab && state.tabs.length >= TABS_MOST) {
        // Opened in front instead, it would take the reader off the page they are on.
        setNotice(`${TABS_MOST} TABS AT MOST`);
        return;
      }
      setNotice(null);
      setSent(NO_MEDIA);
      changeTabs((all) => {
        const room = newTab ? addTab(all, freshId()) : all;
        return visit(room, room.front, read.address);
      });
      // Going to the page already in front is asking for it again.
      if (!newTab && stopOf(frontTab(state))?.address === read.address) setTurn((each) => each + 1);
    },
    [state, setSent],
  );

  /** Words to an engine: here, or where it lets itself be seen. A new tab when asked for one. */
  const ask = (engine: Engine, words: string, newTab = false) => {
    if (engine.id === 'debaser') openSearch(words);
    else if (engine.opens === 'site') router.push(engine.address.replace('%s', () => encodeURIComponent(words)));
    else if (engine.opens === 'here') go(searchAddress(engine, words), newTab);
    else if (extension === 'current') void openInOwnEye(searchAddress(engine, words));
    else window.open(searchAddress(engine, words), '_blank', 'noopener,noreferrer');
  };

  /** What was typed: an address, or words for an engine. */
  const goBox = (text: string) => {
    const typed = readBox(text, choices);
    if (typed.kind === 'address') go(typed.address);
    else if (typed.kind === 'search') ask(typed.engine, typed.words);
    else if (typed.kind === 'list') setListing(true);
    else setNotice(typed.kind === 'refused' ? typed.reason : 'NO ADDRESS');
  };

  /** The same words in the three ticked, a tab each. */
  const searchAll = (text: string) => {
    const typed = readBox(text, choices);
    if (typed.kind !== 'search') return;
    const engines = enginesOn(choices).filter((each) => choices.all.includes(each.id) && each.opens !== 'site');
    const here = engines.filter((each) => each.opens === 'here');
    const room = TABS_MOST - state.tabs.length + (address === null ? 1 : 0);
    if (here.length > room) {
      setNotice(`${TABS_MOST} TABS AT MOST`);
      return;
    }
    setNotice(null);
    setSent(NO_MEDIA);
    changeTabs((all) => {
      let next = all;
      let first: string | null = null;
      for (const engine of here) {
        if (stopOf(frontTab(next)) !== null) next = addTab(next, freshId());
        first ??= next.front;
        next = visit(next, next.front, searchAddress(engine, typed.words));
      }
      return first === null ? next : showTab(next, first);
    });
    for (const engine of engines) if (engine.opens === 'out') ask(engine, typed.words);
  };

  const seen = now.state === 'shown' ? now.document : null;
  // SEEN TOGETHER: the room this reader is in, or their own.
  const shownRoom = useSyncExternalStore(subscribeToWatchWindow, watchWindowState, watchWindowState);
  const ownRoom = useSyncExternalStore(subscribeToOwnRoom, ownRoomState, ownRoomState);
  const roomId = (shownRoom.open && shownRoom.focus?.kind === 'room' ? shownRoom.focus.roomId : null) ?? ownRoom.roomId;
  const shared = useSyncExternalStore(subscribeToTogether, together, togetherOnServer);
  useEffect(() => (roomId === null ? undefined : joinTogether(roomId)), [roomId]);
  const { leading, following, shown: theirs } = shared;
  const onPlace = useCallback(
    (y: number, whole: number) => {
      if (address !== null) leadTo({ address: address.split('#')[0], y, whole });
    },
    [address],
  );
  // Another page in front, while showing: that is what is shown.
  useEffect(() => {
    if (!leading) return;
    if (address !== null && /^https?:/.test(address)) leadTo({ address: address.split('#')[0], y: 0, whole: 1 });
    else stopLeading();
  }, [leading, address]);
  // Following moves the page in front to where they are, and opens nothing.
  useEffect(() => {
    if (following && theirs !== null && samePage(theirs.address, address)) moverRef.current?.({ see: 'scrollTo', x: 0, y: theirs.y, whole: theirs.whole });
  }, [following, theirs, address, seen]);

  const onErase = useCallback(
    (selector: string) => {
      if (address !== null) erase(address, selector);
    },
    [address],
  );

  const sonify = () => {
    const href = seen === null ? null : beatBoxHref(seen.html);
    if (href === null) setNotice('NOTHING ON THIS PAGE TO PLAY');
    else router.push(href);
  };

  const halt = () => {
    work.current?.abort();
    setShown({ key, state: 'stopped' });
  };

  // A lens or a tool pressed while HISTORY, KEPT or the engines' list covers the page puts that away, so the change is seen.
  const uncover = () => {
    setHistoryOpen(false);
    setKeptOpen(false);
    setListing(false);
  };
  const change = (next: (all: Tabs) => Tabs) => {
    setNotice(null);
    changeTabs(next);
  };
  // The keys (keys.ts): heard on the site's own page, never in the frame.
  const keyed = useRef<(asked: SeeingKey) => boolean>(() => false);
  useEffect(() => {
    keyed.current = (asked) => {
      if (asked.do === 'box') {
        const box = document.querySelector<HTMLInputElement>('[data-seeing-address]');
        box?.focus();
        box?.select();
      } else if (asked.do === 'new') change((all) => addTab(all, freshId()));
      else if (asked.do === 'history') {
        setHistoryOpen(!historyOpen);
        setKeptOpen(false);
      } else if (asked.do === 'kept') {
        setKeptOpen(!keptOpen);
        setHistoryOpen(false);
      } else if (asked.do === 'away') {
        if (!historyOpen && !keptOpen && !listing) return false;
        setHistoryOpen(false);
        setKeptOpen(false);
        setListing(false);
      }
      else if (asked.do === 'close') change((all) => closeTab(all, all.front, freshId()));
      else if (asked.do === 'lens') {
        const next = LENS_NAMES[(LENS_NAMES.findIndex((each) => each.id === tab.lens) + 1) % LENS_NAMES.length].id;
        if (address !== null) rememberLens(address, next);
        uncover();
        change((all) => withLens(all, tab.id, next));
      } else {
        const id = state.tabs[asked.index]?.id;
        if (id !== undefined) change((all) => showTab(all, id));
      }
      return true;
    };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing = target !== null && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      const asked = seeingKey({ key: event.key, code: event.code, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, typing });
      if (asked === null || event.defaultPrevented) return;
      if (keyed.current(asked)) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const line =
    notice ??
    (now.state === 'refused'
      ? `SOURCE REFUSED: ${now.reason}`
      : now.state === 'busy'
        ? (now.at ?? 'ACQUIRING SOURCE')
        : now.state === 'shown'
          ? `DOCUMENT RECONSTRUCTED · ${now.document.eye} · ${now.document.files} ${now.document.files === 1 ? 'FILE' : 'FILES'} · ${now.document.refused} REFUSED · LENS: ${LENS_NAMES.find((each) => each.id === tab.lens)?.label ?? tab.lens}${restricted.key === key && restricted.count > 0 ? ` · ${restricted.count} RESTRICTED` : ''}${now.document.status !== null && now.document.status >= 400 ? ` · HTTP ${now.document.status}` : ''}${now.ms !== undefined ? ` · IN ${took(now.ms)}` : ''}`
          : address === null
            ? 'READY'
            : 'STOPPED');
  const fault = notice !== null || now.state === 'refused';
  // What its scripts have put on it since is this drawing's own.
  const [late, setLate] = useState<{ key: string; media: readonly FoundMedia[] }>({ key: '', media: [] });
  const onMedia = useCallback((media: readonly FoundMedia[]) => setLate({ key, media }), [key]);
  const lateMedia = late.key === key ? late.media : NO_MEDIA;
  const tray = useMemo(() => trayOf([...sent, ...(seen?.media ?? NO_MEDIA), ...lateMedia]), [seen, lateMedia, sent]);
  const outside = address !== null && /^https?:/.test(address);
  // A refused page keeps only the keys that may help: lenses, SCAN, TIME, READ IT, OPEN SOURCE, OWN EYE (decision 46).
  const working = outside && now.state !== 'refused';
  const onSelect = useCallback((text: string) => setSelected({ key, text }), [key, setSelected]);
  // A kept copy in front: whose page it is, and where it came from, said above it.
  const asked = useMemo(() => (address === null ? null : askedOf(address, choices)), [address, choices]);
  const pickedWords = selected.key === key ? cleanWords(selected.text) : '';
  const copyId = address === null ? null : keptId(address);
  const copyPage = copyId === null ? null : keptPage(copyId);

  // A book on the page in front: the site's own reader opens it (decision 39).
  const reading = outside && address !== null ? readerRef(dialOf(address).address, seen?.html ?? null) : null;

  return (
    <>
      <SeeingTabs
        state={state}
        onShow={(id) => change((all) => showTab(all, id))}
        onClose={(id) => change((all) => closeTab(all, id, freshId()))}
        onNew={() => change((all) => addTab(all, freshId()))}
        end={
          <>
            <button type="button" aria-expanded={historyOpen} onClick={() => {
                setHistoryOpen(!historyOpen);
                setKeptOpen(false);
              }} className={PLATE}>
              [ HISTORY ]
            </button>
            <button type="button" aria-expanded={keptOpen} onClick={() => {
                setKeptOpen(!keptOpen);
                setHistoryOpen(false);
              }} className={PLATE}>
              [ KEPT {kept.length} ]
            </button>
          </>
        }
      />
      <SeeingToolbar
        place={`${tab.id}:${tab.at}:${address ?? ''}:${tab.draft ?? ''}`}
        address={tab.draft ?? address ?? ''}
        canBack={canGoBack(tab)}
        canForward={canGoForward(tab)}
        busy={now.state === 'busy'}
        empty={address === null}
        onBack={() => change((all) => step(all, tab.id, -1))}
        onForward={() => change((all) => step(all, tab.id, 1))}
        onReload={() => setTurn((each) => each + 1)}
        onStop={halt}
        onGo={goBox}
        say={(text) => sayBox(readBox(text, choices))}
        searches={(text) => readBox(text, choices).kind === 'search'}
        engine={engineChosen(choices).name.toUpperCase()}
        listing={listing}
        onList={() => setListing(!listing)}
        onAll={searchAll}
      />
      {asked !== null ? (
        // A results page: the same words of another, one press.
        <p className="flex flex-wrap items-center gap-1 text-label text-ink" data-seeing-ask>
          ASK
          {enginesOn(choices)
            .filter((each) => each.id !== asked.engine.id && each.opens !== 'site')
            .slice(0, ASKED_SHOWN)
            .map((each) => (
              <button key={each.id} type="button" onClick={() => ask(each, asked.words)} className={PLATE}>
                {each.name}
                {each.opens === 'out' ? ' ↗' : ''}
              </button>
            ))}
        </p>
      ) : null}
      {/* The lenses and the tools share their lines, wrapping where they must (decision 38). */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 pt-1" data-seeing-keyrow>
      <SeeingLenses
        lens={tab.lens}
        settings={settings}
        onSettings={setSettings}
        onLens={(id) => {
          if (address !== null) rememberLens(address, id);
          uncover();
          change((all) => withLens(all, tab.id, id));
        }}
      />
      <span aria-hidden="true" className="mx-1 hidden self-stretch border-l-line border-ink md:block" />
      <SeeingTools
        address={address}
        ready={seen !== null}
        refused={now.state === 'refused'}
        seam={seam}
        loupe={loupe}
        erasing={erasing}
        erased={erased.length}
        good={address !== null && memory.good.some((each) => each.address === address)}
        onSeam={(next) => {
          setSeam(next);
          setLoupe(null);
          uncover();
        }}
        onLoupe={(next) => {
          setLoupe(next);
          setSeam(null);
          uncover();
        }}
        onErasing={(next) => {
          setErasing(next);
          uncover();
        }}
        onBringBack={() => {
          if (address !== null) bringBack(address);
        }}
        onScan={() => go(SCAN_ADDRESS)}
        onGood={(good) => {
          if (address !== null) markGood(address, stop?.title ?? address, good);
        }}
        onGo={go}
      >
        {working ? (
          <>
            <button type="button" aria-expanded={keeping} disabled={seen === null} onClick={() => setKeeping(!keeping)} className={PLATE}>
              [ KEEP PAGE ]
            </button>
            <button type="button" aria-expanded={noting} disabled={seen === null} onClick={() => setNoting(!noting)} className={PLATE}>
              [ NOTES {notes.length} ]
            </button>
            <button type="button" aria-pressed={drawing} disabled={seen === null} onClick={() => setDrawing(!drawing)} className={drawing ? `${PLATE_PRESSED} cursor-pointer` : PLATE}>
              [ GRAFFITI ]
            </button>
          </>
        ) : null}
        {(address !== null && now.state !== 'refused') || sent.length > 0 ? (
          <button type="button" aria-expanded={trayOpen} disabled={seen === null && sent.length === 0} onClick={() => setTrayOpen(!trayOpen)} className={PLATE}>
          [ MEDIA {tray.length} ]
        </button>
        ) : null}
        {outside && seen !== null && (seen.feeds ?? []).length > 0 ? (
          // The page's own news feed, drawn as its list (decision 44).
          <button type="button" title={`The news feed this page says it has, as a list: ${(seen.feeds ?? [])[0]}`} onClick={() => go((seen.feeds ?? [])[0])} className={PLATE} data-seeing-feed>
            [ FEED ]
          </button>
        ) : null}
        {working ? (
          <button type="button" disabled={pickedWords === ''} title="Words selected on the page, to the engine in front, in a new tab" onClick={() => ask(engineChosen(choices), pickedWords, true)} className={PLATE}>
            [ SEARCH THIS ]
          </button>
        ) : null}
        {address !== null && now.state !== 'refused' ? (
        <button type="button" disabled={seen === null} title="The page's structure as a BEATBOX loop: headings the beat, links the notes" onClick={sonify} className={PLATE}>
          [ SONIFY ]
        </button>
        ) : null}
        {working ? (
          <button
            type="button"
            aria-pressed={scriptsOff(address)}
            onClick={() => {
              setScriptsOff(address, !scriptsOff(address));
              setTurn((each) => each + 1);
            }}
            className={scriptsOff(address) ? `${PLATE_PRESSED} cursor-pointer` : PLATE}
          >
            [ SCRIPTS OFF ]
          </button>
        ) : null}
        {outside ? <span aria-hidden="true" className="mx-1 self-stretch border-l-line border-ink" /> : null}
        {working && roomId !== null ? (
          <button
            type="button"
            aria-pressed={leading}
            disabled={seen === null}
            title="Your room sees which page this is, and how far down it you are; each looks through their own lens"
            onClick={() => (leading ? stopLeading() : address !== null ? lead({ address: address.split('#')[0], y: 0, whole: 1 }) : undefined)}
            className={leading ? `${PLATE_PRESSED} cursor-pointer` : PLATE}
          >
            [ SHOW MY ROOM ]
          </button>
        ) : null}
        {reading !== null ? (
          <Link href={`/read/${reading}`} title="In the site's own reader" className={PLATE} data-seeing-read>
            [ READ IT ]
          </Link>
        ) : null}
        {outside ? (
          <a href={address} target="_blank" rel="noopener noreferrer" className={PLATE}>
            [ OPEN SOURCE ↗ ]
          </a>
        ) : null}
        {outside && extension !== 'asking' && extension !== 'unable' ? (
          // Missing or old, the key opens the window that gets it first.
          <button type="button" title="In your own browser, where you are signed in" onClick={() => (extension === 'current' ? void openInOwnEye(dialOf(address).address) : openExtensionWindow())} className={PLATE}>
            [ OWN EYE ↗ ]
          </button>
        ) : null}
      </SeeingTools>
      </div>

      {theirs !== null && !leading ? (
        <p className="flex flex-wrap items-center gap-2 py-1 text-label text-ink" data-seeing-together>
          IN YOUR ROOM: {shortName(theirs.address)}
          {samePage(theirs.address, address) ? (
            <button type="button" aria-pressed={following} onClick={() => follow(!following)} className={following ? `${PLATE_PRESSED} cursor-pointer` : PLATE}>
              [ FOLLOW ]
            </button>
          ) : (
            <button
              type="button"
              title={theirs.address}
              onClick={() => {
                follow(true);
                go(theirs.address);
              }}
              className={PLATE}
            >
              [ SEE TOGETHER ]
            </button>
          )}
        </p>
      ) : null}
      {copyPage !== null ? (
        <p className="flex flex-wrap items-baseline gap-2 py-1 text-label text-ink" data-seeing-copy-of>
          KEPT {new Date(copyPage.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase()}
          <button type="button" onClick={() => go(copyPage.address)} className={`${PLATE} max-w-full truncate`}>
            {copyPage.address}
          </button>
        </p>
      ) : null}
      <div className="frame relative mt-1 flex min-h-0 flex-1 max-sm:min-h-[22rem]" data-seeing-view>
        {historyOpen ? (
          <SeeingHistory
            onGo={(where) => {
              setHistoryOpen(false);
              go(where);
            }}
            onClose={() => setHistoryOpen(false)}
          />
        ) : null}
        {listing ? <SeeingEngines ownEye={extension === 'current'} onClose={() => setListing(false)} /> : null}
        {keptOpen ? (
          <SeeingKept
            me={owner.id}
            onGo={(where) => {
              setKeptOpen(false);
              go(where);
            }}
            onClose={() => setKeptOpen(false)}
          />
        ) : null}
        {seen !== null ? (
          <SeeingStage key={key} drawing={key} document={seen} lens={tab.lens} settings={settings} seam={seam} loupe={loupe} erasing={erasing} erased={erased} onErase={onErase} onOpen={go} onNotice={setNotice} onRestricted={onRestricted} onMedia={onMedia} onSelect={outside ? onSelect : null} onPlace={leading && outside ? onPlace : null} moverRef={moverRef} marks={marks} finderRef={finderRef} graffiti={page} drawn={drawing && outside} />
        ) : address === null ? (
          <SeeingStart good={memory.good} ownEye={extension === 'current'} onGo={go} />
        ) : now.state === 'refused' ? (
          <SeeingRefused
            reason={now.reason}
            eye={now.eye}
            ms={now.ms}
            address={address}
            canOld={outside && dialOf(address).year === null}
            read={reading}
            ownEye={outside && extension === 'current'}
            onAgain={() => setTurn((each) => each + 1)}
            onOld={() => go(dialTo(address, new Date().getFullYear()))}
            onOwn={() => void openInOwnEye(dialOf(address).address)}
          />
        ) : (
          <SeeingAcquiring words={now.state === 'busy' ? (now.at ?? 'ACQUIRING SOURCE') : 'STOPPED'} address={address} eye={engineFor(address).name} busy={now.state === 'busy'} onAgain={() => setTurn((each) => each + 1)} />
        )}
        {noting && page !== null && seen !== null ? (
          <SeeingMargins key={`notes ${page}`} page={page} owner={owner} notes={notes} selected={selected.key === key ? selected.text : ''} onFind={(index) => finderRef.current?.(index)} onClose={() => setNoting(false)} />
        ) : null}
        {keeping && outside && seen !== null ? <SeeingKeep key={`keep ${key}`} address={address} owner={owner} selected={selected.key === key ? selected.text : ''} onOpen={go} onClose={() => setKeeping(false)} /> : null}
        {/* (The start, the refusal and the busy view each fill what the tray leaves, so it needs no spacer.) */}
        {trayOpen && (seen !== null || sent.length > 0) ? <SeeingTray items={tray} /> : null}
      </div>

      <p role="status" className={`my-1 max-w-full truncate tabular-nums ${fault ? FAULT : 'text-label text-ink'}`} data-seeing-status>
        {line}
        {notice === null && now.state === 'busy' && now.since !== undefined ? <SeeingElapsed key={key} since={now.since} /> : null}
      </p>
    </>
  );
}
