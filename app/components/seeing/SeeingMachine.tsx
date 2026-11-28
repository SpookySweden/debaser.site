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
import { partOf, type FrameScroll } from '../../lib/seeing/frame';
import { engineFor } from '../../lib/seeing/engines';
import { extensionState, extensionStateOnServer, lookForExtension, subscribeToExtension } from '../../lib/seeing/extension-store';
import { holdOwnEye, openInOwnEye, openOwnEyeSites, ownEyeErase, ownEyeHas, ownEyeKeep, ownEyeMedia, ownEyeSelection, ownEyeWatchers, ownEyeWords, tellOwnEyeTheme, type OwnEyeHold } from '../../lib/seeing/own-eye';
import { chooseEye, dontAskAgain, eyeChoice, eyeChoiceOnServer, notAskedAgain, notAskedAgainOnServer, offerFor, subscribeToEyeChoice } from '../../lib/seeing/eye-choice';
import { openExtensionWindow } from '../../lib/ui/extension-window';
import { scriptsOff, setScriptsOff, siteSettings, siteSettingsOnServer, subscribeToSiteSettings } from '../../lib/seeing/site-settings';
import { explain, NOTE } from '../../lib/ui/explain';
import { PLATE, PLATE_PRESSED, TITLE_BAR } from '../../lib/ui/controls';
import { subscribeToTheme, themeState } from '../../lib/ui/theme-slot';
import { useAuth } from '../AuthProvider';
import SeeingEngines from './SeeingEngines';
import SeeingStart from './SeeingStart';
import SeeingAcquiring from './SeeingAcquiring';
import SeeingElapsed from './SeeingElapsed';
import SeeingRefused from './SeeingRefused';
import { seeingKey, type SeeingKey } from '../../lib/seeing/keys';
import { shownLine } from '../../lib/seeing/status-line';
import SeeingOwnFrame, { boxAddress, framedAddress, SeeingOwnWatchers, watchPageOf } from './SeeingOwnFrame';
import SeeingShell from './SeeingShell';
import SeeingGetSignedIn from './SeeingGetSignedIn';
import SeeingFirstVisit from './SeeingFirstVisit';
import { shellOf } from '../../lib/seeing/shells';
import SeeingHistory from './SeeingHistory';
import SeeingSignIn from './SeeingSignIn';
import SeeingKeep from './SeeingKeep';
import SeeingKept from './SeeingKept';
import SeeingOwnWeb from './SeeingOwnWeb';
import { isOwnWeb, keepFromOwnEye, keepInOwnWeb } from '../../lib/seeing/own-web';
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
  | { key: string; state: 'refused'; reason: string; eye: string; ms: number }
  | { key: string; state: 'elsewhere' }
  | { key: string; state: 'shell' };

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
          <Link href="/account" className={PLATE} {...explain('Goes to the account page to log in.', 'BROWSER keeps your tabs, history and kept pages on your account, so it opens only once you are logged in.')}>
            [ LOG IN ]
          </Link>{' '}
          TO OPEN BROWSER
        </p>
      )}
    </div>
  );
}

/** How long after a page OWN EYE shows got there its words are asked for: time for it to draw them. */
const OWN_KEEP_AFTER_MS = 2500;

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
  const [webOpen, setWebOpen] = useState(false);
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
  // OWN WEB's pages are their own list, not KEEP PAGE's.
  const keptOnly = useMemo(() => kept.filter((page) => !isOwnWeb(page)), [kept]);
  const ownWebCount = kept.length - keptOnly.length;
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
  const held_ = shown.key === key ? shown : address === null ? NOTHING : ({ key, state: 'busy', at: null } as Shown);
  // The opening a page that was sent on has already had, under the address it ended at.
  const landed = useRef('');
  const work = useRef<AbortController | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Counted by the page's own drawing; another page's count is never this one's.
  const [restricted, setRestricted] = useState<{ key: string; count: number }>({ key: '', count: 0 });
  const onRestricted = useCallback((count: number) => setRestricted({ key, count }), [key]);
  useSyncExternalStore(subscribeToSiteSettings, siteSettings, siteSettingsOnServer);

  // OWN EYE first (Luke, 2026-11-23), when the extension answers: the page in your own browser, and here the way to see it through the server.
  const eye = useSyncExternalStore(subscribeToEyeChoice, eyeChoice, eyeChoiceOnServer);
  // And a page OWN EYE was asked for by name (the key named OWN EYE, an engine the house can't show), whichever eye is the choice
  // (Luke, 2026-11-27: "it seems own eye still opens a new tab in edge when i click it"): shown here, never in a tab of the browser.
  const [there, setThere] = useState<readonly string[]>([]);
  const ownAsked = eye === 'own' || (address !== null && there.includes(address));
  const ownFirst = ownAsked && address !== null && /^https?:/.test(address);
  const [here, setHere] = useState<readonly string[]>([]);
  // A page opened by a press here goes to OWN EYE; one that was only open when the page loaded waits for a press.
  const pressed = useRef<string | null>(null);
  const elsewhere = ownFirst && extension === 'current' && !here.includes(key);
  // A site the server's eye can't show: said, and nothing asked of the server, unless it is asked for anyway.
  const shell = !elsewhere && extension !== 'asking' && !here.includes(key) ? shellOf(address) : null;
  // What the extension says matters only while OWN EYE is the choice: with the server's eye, its answer coming late asks for nothing again.
  const eyeGate = ownFirst ? extension : 'server';
  const now: Shown = elsewhere ? { key, state: 'elsewhere' } : shell !== null ? { key, state: 'shell' } : held_;

  useEffect(() => {
    if (address === null) return;
    if (landed.current === key) return;
    if (eyeGate === 'asking') return;
    if (shell !== null) return;
    if (elsewhere) {
      // Shown in this tab by the browser itself (SeeingOwnFrame): nothing is asked of the server, and no tab is opened.
      pressed.current = null;
      return;
    }
    // A press that went to the server's eye is spent: it opens nothing in OWN EYE later.
    pressed.current = null;
    landed.current = '';
    const going = new AbortController();
    work.current = going;
    const engine = engineFor(address);
    const began = performance.now();
    // (Said once the effect is over: the clock starts with the asking.)
    queueMicrotask(() => {
      if (!going.signal.aborted) setShown({ key, state: 'busy', at: null, since: began });
    });
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
          // OWN WEB: the owner's page from the house, kept as a copy once a day (the server says whether it may be).
          void keepInOwnWeb(answer.document, owner);
          // Where it was sent on to, so the box says where it really is and its links are its own.
          if (answer.document.address !== address) changeTabs((all) => withAddress(all, tab.id, address, answer.document.address));
        } else {
          setShown({ key, state: 'refused', reason: answer.reason, eye: engine.name, ms: Math.round(performance.now() - began) });
          // Their keys are put away on a refused page (decision 46), so nothing is left on that can't be switched off.
          setSeam(null);
          setLoupe(null);
          setErasing(false);
        }
      });
    return () => going.abort();
    // (The stop before is read as it was when this one was opened; it does not open the page again.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, key, tab.id, tab.at, turn, eyeGate, elsewhere, shell]);

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
    (text: string, newTab = false, own = false) => {
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
      // `own`: with OWN EYE, here, whichever eye is the choice.
      if (own) setThere((all) => (all.includes(read.address) ? all : [...all, read.address]));
      pressed.current = read.address;
      changeTabs((all) => {
        const room = newTab ? addTab(all, freshId()) : all;
        return visit(room, room.front, read.address);
      });
      // Going to the page already in front is asking for it again.
      if (!newTab && stopOf(frontTab(state))?.address === read.address) setTurn((each) => each + 1);
    },
    [state, setSent],
  );

  /**
   * Words to an engine: here, or where it lets itself be seen. A new tab when asked for one. An engine that turns the house away is shown
   * here by OWN EYE when the extension is in (never a tab of the browser), and in a tab of the browser's when it isn't.
   */
  const ask = (engine: Engine, words: string, newTab = false) => {
    if (engine.id === 'debaser') openSearch(words);
    else if (engine.opens === 'site') router.push(engine.address.replace('%s', () => encodeURIComponent(words)));
    else if (engine.opens === 'here') go(searchAddress(engine, words), newTab);
    else if (extension === 'current') go(searchAddress(engine, words), newTab, true);
    else window.open(searchAddress(engine, words), '_blank', 'noopener,noreferrer');
  };

  /** The key named OWN EYE: the page in front, here, from the reader's own browser. Without the extension, the window that gets it. */
  const showOwn = () => {
    if (address === null) return;
    if (extension !== 'current') {
      openExtensionWindow();
      return;
    }
    setNotice(null);
    setHere(here.filter((each) => each !== key));
    if (!there.includes(address)) setThere([...there, address]);
  };
  // The eye switch: which eye shows the page in front (a site the house can't show is still the server's eye in front, saying so), and a
  // press on either eye, which shows this page through it and is the choice for the pages opened next.
  const showing: 'own' | 'server' = now.state === 'elsewhere' ? 'own' : 'server';
  const throughOwn = () => {
    if (extension === 'current') chooseEye('own');
    showOwn();
  };
  const throughServer = () => {
    chooseEye('server');
    setNotice(null);
    if (address !== null) setThere(there.filter((each) => each !== address));
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
    // With the extension in, an engine that turns the house away is a tab here too, shown by OWN EYE.
    const own = extension === 'current' ? engines.filter((each) => each.opens === 'out').map((each) => searchAddress(each, typed.words)) : [];
    const here = engines.filter((each) => each.opens === 'here' || (each.opens === 'out' && extension === 'current'));
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
    if (own.length > 0) setThere((all) => [...all, ...own.filter((each) => !all.includes(each))]);
    else for (const engine of engines) if (engine.opens === 'out') ask(engine, typed.words);
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
      else if (asked.do === 'reload') {
        // As ↻: a page in front and nothing being asked for already.
        if (address === null || now.state === 'busy') return false;
        setTurn((each) => each + 1);
      }
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
        : now.state === 'elsewhere'
          ? 'OWN EYE: YOUR OWN BROWSER, SIGNED IN AS YOU'
        : now.state === 'shell'
          ? 'NOT ASKED OF THE SERVER: IT NEEDS YOUR OWN BROWSER'
        : now.state === 'shown'
          ? shownLine(now.document, LENS_NAMES.find((each) => each.id === tab.lens)?.label ?? tab.lens, restricted.key === key ? restricted.count : 0, now.ms)
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
  // (Nor on a page shown in OWN EYE: there is nothing here for them to work on.)
  const working = outside && now.state !== 'refused' && now.state !== 'elsewhere' && now.state !== 'shell';
  // Whether the site in front is on the extension's list (ADD THIS SITE), as it says for this one page.
  // `on`: the extension may show it (added by name, or EVERY SITE is on); `named`: on the list itself (null from a copy that doesn't say).
  const [listed, setListed] = useState<{ address: string; on: boolean; site: string; named: boolean | null } | null>(null);
  useEffect(() => {
    if (!outside || extension !== 'current') return;
    let gone = false;
    const askIt = () =>
      void ownEyeHas(address).then((answer) => {
        if (!gone && answer !== null) setListed({ address, ...answer });
      });
    askIt();
    // Added in OWN EYE's own tab: asked again on coming back.
    window.addEventListener('focus', askIt);
    return () => {
      gone = true;
      window.removeEventListener('focus', askIt);
    };
  }, [outside, extension, address]);
  const onList = listed !== null && listed.address === address ? listed : null;
  // Shown because EVERY SITE is on, this site not being on the list by name.
  const everySite = onList !== null && onList.on && onList.named === false;
  // While OWN EYE shows pages here: held open to the extension, which says where a framed page got to.
  const [framedAt, setFramedAt] = useState<{ key: string; href: string; title: string } | null>(null);
  const holdRef = useRef<OwnEyeHold | null>(null);
  useEffect(() => {
    if (!(ownAsked && extension === 'current')) return;
    // (ERASE's press on the framed page comes back the same way: BROWSER keeps the list, as for a page from the house.)
    const hold = holdOwnEye((href, title) => setFramedAt({ key, href, title }), erase);
    holdRef.current = hold;
    return () => {
      holdRef.current = null;
      hold.release();
    };
  }, [ownAsked, extension, key]);
  // Where the page OWN EYE shows here got to, by a link followed inside it: the address box follows it (the frame is not reloaded; GO there
  // makes it a stop of the tab's own).
  const followed = now.state === 'elsewhere' && framedAt !== null && framedAt.key === key ? boxAddress(framedAt.href) : null;
  // HISTORY and SEEN LAST hold OWN EYE's pages too (Luke, 2026-11-27: "use it like they would chrome or edge"): the address and the title,
  // in this browser only, never on the account. A page is seen once the extension says it is there; YouTube's own player says nothing
  // unless its site was added, so a video is seen as soon as it is asked for.
  const ownPlayer = now.state === 'elsewhere' && address !== null && framedAddress(address) !== address ? address : null;
  const ownSeen = now.state === 'elsewhere' && framedAt !== null && framedAt.key === key ? framedAt : null;
  const stopBefore = tab.at > 0 ? (tab.stops[tab.at - 1]?.address ?? null) : null;
  const ownCameFrom = stopBefore !== null && /^https?:/.test(stopBefore) ? stopBefore : null;
  useEffect(() => {
    if (ownPlayer !== null) noteSeen({ address: ownPlayer, title: ownPlayer, at: Date.now(), from: ownCameFrom, own: true, told: true });
  }, [ownPlayer, key, ownCameFrom]);
  useEffect(() => {
    if (ownSeen === null || address === null) return;
    const at = boxAddress(ownSeen.href);
    // A link followed inside the frame was come to from the page the tab asked for.
    noteSeen({ address: at, title: ownSeen.title || at, at: Date.now(), from: at === address ? ownCameFrom : address, own: true, told: true });
  }, [ownSeen, address, ownCameFrom]);
  // OWN WEB keeps the pages OWN EYE shows here (Luke, 2026-11-27: "Keep every page"), while the switch in the extension is on: it is the
  // extension's, off for everybody until two presses on its own SITES page, and this page can only read it and switch it off.
  const [ownKeep, setOwnKeep] = useState<boolean | null>(null);
  useEffect(() => {
    if (!(ownAsked && extension === 'current')) return;
    let gone = false;
    const askIt = () =>
      void ownEyeKeep().then((on) => {
        if (!gone) setOwnKeep(on);
      });
    askIt();
    // Switched on in the extension's own tab: asked again on coming back.
    window.addEventListener('focus', askIt);
    return () => {
      gone = true;
      window.removeEventListener('focus', askIt);
    };
  }, [ownAsked, extension]);
  // The words a reader can see on it, asked of the extension a moment after the page got there (so it has drawn them), and kept on this
  // person's own account, private. YouTube's own player has no words to keep. Whether this page was kept is said above it.
  const [ownKept, setOwnKept] = useState<{ href: string; kept: boolean } | null>(null);
  useEffect(() => {
    if (ownSeen === null || ownKeep !== true || boxAddress(ownSeen.href) !== ownSeen.href) return;
    const href = ownSeen.href;
    let gone = false;
    const soon = window.setTimeout(() => {
      void ownEyeWords(href).then(async (read) => {
        const kept = read === null ? 'refused' : await keepFromOwnEye(read, { id: ownerId, label: ownerLabel });
        if (gone) return;
        setOwnKept({ href, kept: kept !== 'refused' });
        // No words came: the switch may have been turned off in the extension since.
        if (read === null) void ownEyeKeep().then((on) => (gone ? undefined : setOwnKeep(on)));
      });
    }, OWN_KEEP_AFTER_MS);
    return () => {
      gone = true;
      window.clearTimeout(soon);
    };
  }, [ownSeen, ownKeep, ownerId, ownerLabel]);
  // MEDIA, WATCHERS, SEARCH THIS and ERASE on a page OWN EYE shows (Luke, 2026-11-28: "MEDIA,SEARCH THIS,WATCHERS,ERASE"): the house has no
  // copy of it, so the extension does each on that one frame, when its key is pressed or its lens is in front.
  const ownHref = ownSeen?.href ?? null;
  const [ownMedia, setOwnMedia] = useState<{ at: string; media: readonly FoundMedia[] } | null>(null);
  useEffect(() => {
    if (ownHref === null || !trayOpen) return;
    let gone = false;
    void ownEyeMedia().then((found) => {
      if (!gone && found !== null) setOwnMedia({ at: ownHref, media: found.map((each) => ({ address: each.address, title: each.title, from: 'link', seconds: null })) });
    });
    return () => {
      gone = true;
    };
  }, [ownHref, trayOpen]);
  const ownTray = useMemo(() => (ownHref !== null && ownMedia !== null && ownMedia.at === ownHref ? trayOf([...sent, ...ownMedia.media]) : tray), [ownHref, ownMedia, sent, tray]);
  const ownWatching = now.state === 'elsewhere' && tab.lens === 'watchers';
  const [ownWatchers, setOwnWatchers] = useState<{ at: string; hosts: { host: string; count: number }[] | null } | null>(null);
  useEffect(() => {
    if (ownHref === null || !ownWatching) return;
    let gone = false;
    void ownEyeWatchers().then((hosts) => {
      if (!gone) setOwnWatchers({ at: ownHref, hosts });
    });
    return () => {
      gone = true;
    };
  }, [ownHref, ownWatching]);
  const ownErased = erasedOn(ownHref);
  useEffect(() => {
    if (ownHref !== null) void ownEyeErase(erasing, ownErased);
  }, [ownHref, erasing, ownErased]);
  // A video clicked inside a page OWN EYE shows moves that frame to YouTube's watch page, which is white in a frame (Luke, 2026-11-27:
  // "shorts will play but clicking a video will return a white page"). Once the extension says the frame got there, the video becomes this
  // tab's next stop, so YouTube's own player takes over and BACK returns. Heard only when youtube.com is on the extension's list.
  const ownWatch = ownSeen === null ? null : watchPageOf(ownSeen.href);
  useEffect(() => {
    if (ownWatch === null) return;
    // After this drawing, not inside it.
    const soon = window.setTimeout(() => go(ownWatch, false, true), 0);
    return () => window.clearTimeout(soon);
    // Once for each place the frame says it got to, not again when `go` is made anew.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownWatch, ownSeen]);
  // The lens in front, on the page OWN EYE shows here: worn by the extension on the site's own page, so the reader stays signed in.
  const ownLens = now.state === 'elsewhere' ? tab.lens : null;
  const lensNeeds = onList !== null && !onList.on ? onList.site : null;
  useEffect(() => {
    if (ownLens === null) return;
    const worn = holdRef.current?.lens(ownLens) ?? 'unheard';
    // (WATCHERS is listed beside the page by the extension, the page left plain.)
    if (worn === 'house' && ownLens === 'watchers') return;
    if (worn === 'house') setNotice('THIS LENS IS THE HOUSE\'S ONLY: FROM THE HOUSE SHOWS IT');
    else if (worn === 'unheard' && ownLens !== 'standard') setNotice('THE EXTENSION DID NOT ANSWER: PICK THE LENS AGAIN, OR RELOAD THE PAGE');
    // Never a silent nothing (the morning's gap G5): the extension may put a lens only on a site that was added (YouTube's player
    // shows here without that).
    else if (ownLens !== 'standard' && lensNeeds !== null) queueMicrotask(() => setNotice(`A LENS NEEDS ${lensNeeds.toUpperCase()} ADDED FIRST: PRESS [ ADD ${lensNeeds} ], THEN PICK THE LENS AGAIN`));
  }, [ownLens, framedAt, lensNeeds]);
  // The sign-in offered on entering a page (YouTube, for now), until it is on the list or the reader says not to.
  const offer = offerFor(address);
  const never = useSyncExternalStore(subscribeToEyeChoice, () => notAskedAgain(owner.id), notAskedAgainOnServer);
  const [notNow, setNotNow] = useState('');
  // With OWN EYE first a page opens signed in already; the line is for the server's eye, and for a browser without the extension.
  const offering = offer !== null && outside && !never.includes(offer) && notNow !== key && (extension === 'missing' || extension === 'old' || (extension === 'current' && eye === 'server' && now.state !== 'elsewhere' && onList?.on === false));
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
              }} className={PLATE} {...explain('Opens your BROWSER history over the page, as a list or a TRAIL of sites; press again to close it.', 'To find a page you saw before. It is yours alone and goes by itself after 90 days.')}>
              [ HISTORY ]
            </button>
            <button type="button" aria-expanded={keptOpen} onClick={() => {
                setKeptOpen(!keptOpen);
                setHistoryOpen(false);
              }} className={PLATE} {...explain('Opens the pages kept with KEEP PAGE over the page, found by tag or by words; press again to close it.', 'The number is how many kept pages there are.')}>
              [ KEPT {keptOnly.length} ]
            </button>
            {ownWebCount > 0 ? (
              <button type="button" aria-expanded={webOpen} onClick={() => {
                  setWebOpen(!webOpen);
                  setKeptOpen(false);
                  setHistoryOpen(false);
                }} className={PLATE} {...explain('Every page you opened from the house, kept whole on your account for you alone, and the words of pages OWN EYE showed while you had that switched on in the extension: found by words or site, deleted by page, site or all.', 'A page still opens here after the site changes it or takes it down.')}>
                [ OWN WEB {ownWebCount} ]
              </button>
            ) : null}
          </>
        }
      />
      <SeeingToolbar
        place={`${tab.id}:${tab.at}:${address ?? ''}:${tab.draft ?? ''}:${followed ?? ''}`}
        address={tab.draft ?? followed ?? address ?? ''}
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
              <button key={each.id} type="button" onClick={() => ask(each, asked.words)} className={PLATE} {...explain(`Searches for the same words with ${each.name} instead.`, each.opens === 'out' ? 'Marked ↗: its results open in your own browser.' : 'To compare what another engine finds.')}>
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
        eraseReady={seen !== null || ownHref !== null}
        refused={now.state === 'refused'}
        seam={seam}
        loupe={loupe}
        erasing={erasing}
        erased={(now.state === 'elsewhere' ? ownErased : erased).length}
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
          // On a page OWN EYE shows, the list is the one of the site that page is on now.
          const at = now.state === 'elsewhere' ? ownHref : address;
          if (at !== null) bringBack(at);
        }}
        onScan={() => go(SCAN_ADDRESS)}
        onGood={(good) => {
          if (address !== null) markGood(address, stop?.title ?? address, good);
        }}
        onGo={go}
      >
        {working ? (
          <>
            <button type="button" aria-expanded={keeping} disabled={seen === null} onClick={() => setKeeping(!keeping)} className={PLATE} {...explain('Opens KEEP PAGE beside the page: tags, a note and quotes, then KEEP; press again to close it.', 'To keep this page, with a copy of it, so you can find it again under KEPT.')}>
              [ KEEP PAGE ]
            </button>
            <button type="button" aria-expanded={noting} disabled={seen === null} onClick={() => setNoting(!noting)} className={PLATE} {...explain('Opens NOTES beside the page: notes on passages of it; press again to close it.', 'Select words on the page and write a note on them. The number is how many notes this page has.')}>
              [ NOTES {notes.length} ]
            </button>
            <button type="button" aria-pressed={drawing} disabled={seen === null} onClick={() => setDrawing(!drawing)} className={drawing ? `${PLATE_PRESSED} cursor-pointer` : PLATE} {...explain('While it is on, you draw over the page with the pointer, in the ink you pick. Press again to stop drawing.', 'The lines stay where you drew them as the page scrolls, and come back next time, in this browser.')}>
              [ GRAFFITI ]
            </button>
          </>
        ) : null}
        {(address !== null && now.state !== 'refused') || sent.length > 0 ? (
          <button type="button" aria-expanded={trayOpen} disabled={seen === null && sent.length === 0 && ownHref === null} onClick={() => setTrayOpen(!trayOpen)} className={PLATE} {...explain('Opens the MEDIA tray beside the page: the videos and sounds this page plays, each with keys to play it in your room; press again to close it.', 'Video and sound never come through the house: the tray hands them to the Room. The number is how many there are.')}>
          [ MEDIA {ownTray.length} ]
        </button>
        ) : null}
        {outside && seen !== null && (seen.feeds ?? []).length > 0 ? (
          // The page's own news feed, drawn as its list (decision 44).
          <button type="button" title={`The news feed this page says it has, as a list: ${(seen.feeds ?? [])[0]}`} onClick={() => go((seen.feeds ?? [])[0])} className={PLATE} data-seeing-feed {...explain('Opens the news feed this page says it has, drawn as a list of its latest posts.', 'A quick way to see what is new on a site without its clutter.')}>
            [ FEED ]
          </button>
        ) : null}
        {working ? (
          <button type="button" disabled={pickedWords === ''} title="Words selected on the page, to the engine in front, in a new tab" onClick={() => ask(engineChosen(choices), pickedWords, true)} {...explain('Searches for the words you selected on the page, with the engine in front, in a new BROWSER tab.', 'Select words on the page first; this page stays where it is.')} className={PLATE}>
            [ SEARCH THIS ]
          </button>
        ) : null}
        {now.state === 'elsewhere' ? (
          // On a page OWN EYE shows, the extension says which words are selected, when the key is pressed (never ones inside a box).
          <button
            type="button"
            disabled={ownHref === null}
            title="Words selected on the page, to the engine in front, in a new tab"
            onClick={() =>
              void ownEyeSelection().then((text) => {
                const words = cleanWords(text ?? '');
                if (words !== '') ask(engineChosen(choices), words, true);
                else setNotice(text === null ? 'THE EXTENSION DID NOT ANSWER: PRESS SEARCH THIS AGAIN, OR RELOAD THE PAGE' : 'SELECT WORDS ON THE PAGE FIRST, THEN PRESS SEARCH THIS');
              })
            }
            className={PLATE}
            data-seeing-own-search
            {...explain('Searches for the words you selected on the page, with the engine in front, in a new BROWSER tab.', 'Select words on the page first, then press this; the page stays where it is. The extension reads the selection from your own browser when you press, never words inside a box you type in.')}
          >
            [ SEARCH THIS ]
          </button>
        ) : null}
        {address !== null && now.state !== 'refused' ? (
        <button type="button" disabled={seen === null} title="The page's structure as a BEATBOX loop: headings the beat, links the notes" onClick={sonify} className={PLATE} {...explain('Turns the shape of this page into a loop and opens it in BEATBOX: its headings are the beat, its links the notes.', 'For fun: every page sounds different.', 'LEAVES BROWSER FOR BEATBOX.')}>
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
            {...explain(scriptsOff(address) ? 'Lets this site\'s scripts run again and shows the page afresh.' : 'Stops this site\'s scripts running and shows the page afresh without them.', 'For a site that is slow, jumpy or full of pop-ups. Remembered for the whole site, in this browser.')}
          >
            [ SCRIPTS OFF ]
          </button>
        ) : null}
        {outside ? <span aria-hidden="true" className="mx-1 hidden self-stretch border-l-line border-ink md:block" /> : null}
        {working && roomId !== null ? (
          <button
            type="button"
            aria-pressed={leading}
            disabled={seen === null}
            title="Your room sees which page this is, and how far down it you are; each looks through their own lens"
            onClick={() => (leading ? stopLeading() : address !== null ? lead({ address: address.split('#')[0], y: 0, whole: 1 }) : undefined)}
            className={leading ? `${PLATE_PRESSED} cursor-pointer` : PLATE}
            {...explain(leading ? 'Stops showing this page to your room.' : 'Shows your room which page you are on and how far down it you are, as you read.', 'Others in the room can follow along, each through their own lens.', NOTE.others)}
          >
            [ SHOW MY ROOM ]
          </button>
        ) : null}
        {reading !== null ? (
          <Link href={`/read/${reading}`} title="In the site's own reader" className={`${PLATE} inline-flex items-center`} data-seeing-read {...explain('Opens this book in the site\'s own reader.', 'The reader shows books better than a page from outside does.')}>
            [ READ IT ]
          </Link>
        ) : null}
        {outside ? (
          <a href={address} target="_blank" rel="noopener noreferrer" className={`${PLATE} inline-flex items-center`} {...explain('Opens this page on its own site, outside BROWSER.', 'The site as it is, with nothing of the house\'s in between.', NOTE.leaves)}>
            [ OPEN SOURCE ↗ ]
          </a>
        ) : null}
        {outside && extension !== 'asking' && extension !== 'unable' ? (
          // The two eyes side by side, each named by what it is (Luke, 2026-11-27: "make it clearer between own and eye server eye, these
          // need to really state their purpose better"). The eye showing the page in front is the one drawn pressed; a press on the other
          // shows this page through it, here, and is remembered for the pages opened next. Without the extension, OWN EYE's key gets it.
          <span role="group" aria-label="Which eye shows this page" className="inline-flex flex-wrap items-center gap-1 text-label text-ink" data-seeing-eye={eye} data-seeing-eye-showing={showing}>
            THIS PAGE THROUGH:
            <button
              type="button"
              aria-pressed={showing === 'own'}
              title="OWN EYE: your own browser shows the page here, signed in as you, as the site makes it"
              onClick={throughOwn}
              className={showing === 'own' ? `${PLATE_PRESSED} cursor-pointer` : PLATE}
              data-seeing-eye-key="own"
              {...explain(
                extension !== 'current'
                  ? 'Opens the EXTENSION window, to get or update the DEBASER extension that OWN EYE needs.'
                  : showing === 'own'
                    ? 'OWN EYE is showing this page now: your own browser, signed in as you, the page as the site makes it.'
                    : 'Shows this page here through OWN EYE: your own browser, signed in as you, the page as the site makes it. No tab of your browser is opened.',
                'For sites you are signed in to, and sites that turn the house away. Remembered: the pages you open next come through OWN EYE too.',
              )}
            >
              {extension === 'current' ? '[ OWN EYE: YOUR BROWSER, SIGNED IN ]' : '[ GET OWN EYE: YOUR BROWSER, SIGNED IN ]'}
            </button>
            <button
              type="button"
              aria-pressed={showing === 'server'}
              title="SERVER EYE: the house fetches the page, never signed in, and rebuilds it through the lenses"
              onClick={throughServer}
              className={showing === 'server' ? `${PLATE_PRESSED} cursor-pointer` : PLATE}
              data-seeing-eye-key="server"
              {...explain(
                showing === 'server'
                  ? 'SERVER EYE is showing this page now: fetched by the house, never signed in, rebuilt through the lenses.'
                  : 'Shows this page through SERVER EYE: fetched by the house, never signed in, rebuilt through the lenses.',
                'For reading a page without it seeing you, and for every lens and tool. Remembered: the pages you open next come through SERVER EYE too.',
                'THE SITE NAME AND THE TIME ARE WRITTEN DOWN.',
              )}
            >
              [ SERVER EYE: THE HOUSE, SIGNED OUT ]
            </button>
          </span>
        ) : null}
        {outside && (extension === 'missing' || extension === 'old' || onList !== null) ? (
          // ADD THIS SITE, in words: on the list, shown because every site is, or a press away (in OWN EYE, which asks the browser). Taking one
          // off is in the EXTENSION window. With EVERY SITE on there is nothing to add here: a page that needs its site added by name says so
          // where it stayed blank, with the key beside it.
          <button
            type="button"
            disabled={onList?.on === true}
            title={everySite ? 'Every site is allowed: the extension may show this one and put a lens on it. Take that back under SITES in the EXTENSION window' : onList?.on === true ? 'The extension may act on it. Take it off in the EXTENSION window' : 'The extension may act on it once you add it: a press in OWN EYE, and your browser asks too'}
            onClick={() => (extension === 'current' ? void openInOwnEye(dialOf(address).address, 'machine') : openExtensionWindow())}
            className={PLATE}
            data-seeing-add-site={everySite ? 'every' : onList?.on === true ? 'on' : 'off'}
            {...explain(
              everySite
                ? 'You allowed every site: OWN EYE may show this one here, signed in, with no ADD step. Take that back under SITES in the EXTENSION window.'
                : onList?.on === true
                  ? 'This site is on the extension\'s list already: OWN EYE may show it here. Take it off in the EXTENSION window.'
                  : 'Adds this site to the extension\'s list, so OWN EYE may show it here, signed in.',
              everySite ? 'A site that stays blank here says why, and offers a tab or adding it by name.' : 'Your browser asks you too before the extension may act on a site.',
            )}
          >
            {everySite ? '[ ✓ EVERY SITE IS ALLOWED ]' : onList?.on === true ? `[ ✓ ON THE LIST: ${onList.site} ]` : `[ ADD ${onList?.site ?? shortName(address)} ]`}
          </button>
        ) : null}
      </SeeingTools>
      </div>

      {now.state === 'elsewhere' ? (
        // Why most of the tools are put away or greyed on a page OWN EYE shows (the morning's gap G5): said, not left to be guessed.
        <p className="py-1 text-label text-ink-quiet" data-seeing-own-tools>
          THIS PAGE IS FROM YOUR OWN BROWSER: THE LENSES, MEDIA, WATCHERS, SEARCH THIS AND ERASE REACH IT THROUGH THE EXTENSION (ON A SITE IT MAY SHOW). THE OTHER TOOLS ON THIS ROW (NOTES,
          GRAFFITI, SCRIPTS OFF, SHOW MY ROOM, SEAM, LOUPE, SONIFY) NEED THE HOUSE&apos;S COPY OF A PAGE: [ FROM THE HOUSE ] SHOWS THIS PAGE THAT WAY, SIGNED OUT.
        </p>
      ) : null}
      <SeeingFirstVisit owner={owner.id} />
      {extension === 'missing' || extension === 'old' || extension === 'unable' ? <SeeingGetSignedIn extension={extension} onGet={openExtensionWindow} /> : null}
      {offering && offer !== null ? (
        <SeeingSignIn
          site={offer}
          has={extension === 'current'}
          onLogIn={() => void openInOwnEye(dialOf(address).address)}
          onGet={openExtensionWindow}
          onNotNow={() => setNotNow(key)}
          onNever={() => dontAskAgain(owner.id, offer)}
        />
      ) : null}
      {theirs !== null && !leading ? (
        <p className="flex flex-wrap items-center gap-2 py-1 text-label text-ink" data-seeing-together>
          IN YOUR ROOM: {shortName(theirs.address)}
          {samePage(theirs.address, address) ? (
            <button type="button" aria-pressed={following} onClick={() => follow(!following)} className={following ? `${PLATE_PRESSED} cursor-pointer` : PLATE} {...explain(following ? 'Stops following: you scroll the page yourself again.' : 'Follows the person showing this page to your room: your page scrolls with theirs.', 'To read along together; your lens stays your own.')}>
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
              {...explain('Opens the page somebody in your room is showing, and follows along with them.', 'To join them on it; your lens stays your own.')}
            >
              [ SEE TOGETHER ]
            </button>
          )}
        </p>
      ) : null}
      {copyPage !== null ? (
        <p className="flex flex-wrap items-baseline gap-2 py-1 text-label text-ink" data-seeing-copy-of>
          KEPT {new Date(copyPage.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase()}
          <button type="button" onClick={() => go(copyPage.address)} className={`${PLATE} max-w-full truncate`} {...explain('Opens the page this copy was kept from, as it is now.', 'To see what has changed since it was kept.')}>
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
        {webOpen ? (
          <SeeingOwnWeb
            onGo={(where) => {
              setWebOpen(false);
              go(where);
            }}
            onClose={() => setWebOpen(false)}
          />
        ) : null}
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
          <SeeingStage key={key} drawing={key} part={partOf(address)} document={seen} lens={tab.lens} settings={settings} seam={seam} loupe={loupe} erasing={erasing} erased={erased} onErase={onErase} onOpen={go} onNotice={setNotice} onRestricted={onRestricted} onMedia={onMedia} onSelect={outside ? onSelect : null} onPlace={leading && outside ? onPlace : null} moverRef={moverRef} marks={marks} finderRef={finderRef} graffiti={page} drawn={drawing && outside} />
        ) : address === null ? (
          <SeeingStart good={memory.good} ownEye={extension === 'current'} onGo={go} />
        ) : now.state === 'elsewhere' ? (
          <>
          <SeeingOwnFrame
            key={key}
            address={dialOf(address).address}
            onList={onList?.on ?? null}
            named={onList?.named ?? null}
            site={onList?.site ?? shortName(address)}
            at={framedAt !== null && framedAt.key === key ? framedAt : null}
            onTab={() => void openInOwnEye(dialOf(address).address)}
            onMachine={() => void openInOwnEye(dialOf(address).address, 'machine')}
            onHouse={() => setHere([...here, key])}
            onAdd={() => void openInOwnEye(dialOf(address).address, 'machine')}
            onEvery={() => void openOwnEyeSites()}
            keeping={ownKeep}
            kept={ownSeen !== null && ownKept !== null && ownKept.href === ownSeen.href ? ownKept.kept : null}
            onKeep={() => void openOwnEyeSites()}
            onStopKeeping={() => void ownEyeKeep(true).then(setOwnKeep)}
          />
          {ownWatching ? <SeeingOwnWatchers said={ownHref !== null} hosts={ownHref !== null && ownWatchers !== null && ownWatchers.at === ownHref ? ownWatchers.hosts : undefined} /> : null}
          </>
        ) : now.state === 'shell' && shell !== null ? (
          <SeeingShell site={shell} extension={extension} onOwn={showOwn} onTab={() => void openInOwnEye(dialOf(address).address)} onGet={openExtensionWindow} onAnyway={() => setHere([...here, key])} />
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
            onOwn={showOwn}
          />
        ) : (
          <SeeingAcquiring words={now.state === 'busy' ? (now.at ?? 'ACQUIRING SOURCE') : 'STOPPED'} address={address} eye={engineFor(address).name} busy={now.state === 'busy'} onAgain={() => setTurn((each) => each + 1)} />
        )}
        {noting && page !== null && seen !== null ? (
          <SeeingMargins key={`notes ${page}`} page={page} owner={owner} notes={notes} selected={selected.key === key ? selected.text : ''} onFind={(index) => finderRef.current?.(index)} onClose={() => setNoting(false)} />
        ) : null}
        {keeping && outside && seen !== null ? <SeeingKeep key={`keep ${key}`} address={address} owner={owner} selected={selected.key === key ? selected.text : ''} onOpen={go} onClose={() => setKeeping(false)} /> : null}
        {/* (The start, the refusal and the busy view each fill what the tray leaves, so it needs no spacer.) */}
        {trayOpen && (seen !== null || sent.length > 0 || ownHref !== null) ? <SeeingTray items={ownTray} /> : null}
      </div>

      <p role="status" className={`my-1 max-w-full truncate tabular-nums ${fault ? FAULT : 'text-label text-ink'}`} data-seeing-status>
        {line}
        {notice === null && now.state === 'busy' && now.since !== undefined ? <SeeingElapsed key={key} since={now.since} /> : null}
      </p>
    </>
  );
}
