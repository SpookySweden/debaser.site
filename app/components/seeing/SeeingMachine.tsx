'use client';

/**
 * BROWSER, the DEBASER SEEING MACHINE (SPEC-seeing-machine.md): tabs, the address box, the lens keys, the page and the status line.
 *
 * Phase 1 is the shell: only the built-in test page opens, and nothing is fetched. For people with an account (D2); signed out, it shows
 * the sign-in call. Only the tab in front has a page; coming back to a tab opens its page again.
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { addressInHash, browserHref, readAddress } from '../../lib/seeing/address';
import type { SeenDocument, SeeStep } from '../../lib/seeing/engine';
import { lensOr } from '../../lib/seeing/lenses/registry';
import { addTab, canGoBack, canGoForward, closeTab, frontTab, showTab, step, stopOf, TABS_MOST, visit, withDraft, withAddress, withLens, withTitle, type Tabs } from '../../lib/seeing/tabs';
import { changeTabs, freshId, letTabsGo, openTabsOf, seeingTabs, seeingTabsOnServer, subscribeToSeeingTabs } from '../../lib/seeing/tabs-store';
import { engineFor } from '../../lib/seeing/engines';
import { scriptsOff, setScriptsOff, siteSettings, siteSettingsOnServer, subscribeToSiteSettings } from '../../lib/seeing/site-settings';
import { TEST_ADDRESS } from '../../lib/seeing/test-engine';
import { PLATE, PLATE_MAIN, PLATE_PRESSED, TITLE_BAR } from '../../lib/ui/controls';
import { useAuth } from '../AuthProvider';
import SeeingLenses from './SeeingLenses';
import SeeingTabs from './SeeingTabs';
import SeeingToolbar from './SeeingToolbar';
import SeeingViewport from './SeeingViewport';
import SeeingWatchers from './SeeingWatchers';
import { useReaderLook } from './use-reader-look';

/** What came of opening a page. `key` says which opening it was, so an answer to an earlier one is never drawn as this one's. */
type Shown =
  | { key: string; state: 'busy'; at: SeeStep | null }
  | { key: string; state: 'stopped' }
  | { key: string; state: 'shown'; document: SeenDocument }
  | { key: string; state: 'refused'; reason: string };

const NOTHING: Shown = { key: '', state: 'stopped' };

/** One line of fault words: White on Rose, as every fault is. */
const FAULT = 'w-fit bg-bubble-pale px-1 text-label text-ink-bar';

export default function SeeingMachine() {
  const { status, user } = useAuth();
  const owner = status === 'signed-in' && user !== null ? user.id : null;
  const held = useSyncExternalStore(subscribeToSeeingTabs, seeingTabs, seeingTabsOnServer);

  useEffect(() => {
    if (owner !== null) openTabsOf(owner);
    else if (status !== 'loading') letTabsGo();
  }, [owner, status]);

  return (
    <div className="flex h-full min-h-[24rem] flex-col px-2 pt-1" data-seeing>
      <h1 className={TITLE_BAR}>THE SEEING MACHINE</h1>
      {owner !== null && held.owner === owner ? (
        <Machine key={owner} state={held.state} />
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

function Machine({ state }: { state: Tabs }) {
  const tab = frontTab(state);
  const stop = stopOf(tab);
  const address = stop?.address ?? null;
  const lens = lensOr(tab.lens);
  const { look, setLook } = useReaderLook();

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
    void engine
      .open(address, (at) => {
        if (!going.signal.aborted) setShown({ key, state: 'busy', at });
      }, going.signal)
      .catch(() => ({ ok: false as const, reason: 'SOMETHING WENT WRONG' }))
      .then((answer) => {
        if (going.signal.aborted) return;
        if (answer.ok) {
          const end = readAddress(answer.document.address);
          const endKey = end.ok ? `${tab.id}:${tab.at}:${end.address}:${turn}` : key;
          landed.current = endKey;
          setShown({ key: endKey, state: 'shown', document: answer.document });
          changeTabs((all) => withTitle(all, tab.id, address, answer.document.title));
          // Where it was sent on to, so the box says where it really is and its links are its own.
          if (answer.document.address !== address) changeTabs((all) => withAddress(all, tab.id, address, answer.document.address));
        } else setShown({ key, state: 'refused', reason: answer.reason });
      });
    return () => going.abort();
  }, [address, key, tab.id, tab.at, turn]);

  // A link that brought an address (`/browser#see=...`): put in the box of a new tab, waiting for GO. Any page anywhere can carry such a
  // link, so it never opens by itself, unless it is the page already in front, as it is after a reload.
  useEffect(() => {
    const take = () => {
      const brought = addressInHash(window.location.hash);
      if (brought === null) return;
      const inFront = stopOf(frontTab(seeingTabs().state));
      if (inFront?.address === brought) return;
      const id = freshId();
      changeTabs((all) => {
        const room = inFront === null ? all : addTab(all, id);
        return withDraft(room, room.front, brought);
      });
    };
    take();
    window.addEventListener('hashchange', take);
    return () => window.removeEventListener('hashchange', take);
  }, []);

  // The address in front, kept after the `#` of this page's own, so it can be copied and come back to. After the effect above, which
  // reads what was there on arrival.
  const href = browserHref(address);
  useEffect(() => {
    if (window.location.pathname === '/browser' && window.location.pathname + window.location.hash !== href) {
      window.history.replaceState(window.history.state, '', href);
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
      changeTabs((all) => {
        const room = newTab ? addTab(all, freshId()) : all;
        return visit(room, room.front, read.address);
      });
      // Going to the page already in front is asking for it again.
      if (!newTab && stopOf(frontTab(state))?.address === read.address) setTurn((each) => each + 1);
    },
    [state],
  );

  const halt = () => {
    work.current?.abort();
    setShown({ key, state: 'stopped' });
  };

  const change = (next: (all: Tabs) => Tabs) => {
    setNotice(null);
    changeTabs(next);
  };

  const seen = now.state === 'shown' ? now.document : null;
  const line =
    notice ??
    (now.state === 'refused'
      ? `SOURCE REFUSED: ${now.reason}`
      : now.state === 'busy'
        ? (now.at ?? 'ACQUIRING SOURCE')
        : now.state === 'shown'
          ? `DOCUMENT RECONSTRUCTED · ${now.document.eye} · ${now.document.files} ${now.document.files === 1 ? 'FILE' : 'FILES'} · ${now.document.refused} REFUSED · LENS: ${tab.lens.toUpperCase()}${restricted.key === key && restricted.count > 0 ? ` · ${restricted.count} RESTRICTED` : ''}${now.document.status !== null && now.document.status >= 400 ? ` · HTTP ${now.document.status}` : ''}`
          : address === null
            ? 'READY'
            : 'STOPPED');
  const fault = notice !== null || now.state === 'refused';
  const outside = address !== null && /^https?:/.test(address);

  return (
    <>
      <SeeingTabs
        state={state}
        onShow={(id) => change((all) => showTab(all, id))}
        onClose={(id) => change((all) => closeTab(all, id, freshId()))}
        onNew={() => change((all) => addTab(all, freshId()))}
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
        onGo={go}
      />
      <SeeingLenses lens={tab.lens} look={look} onLook={setLook} onLens={(id) => change((all) => withLens(all, tab.id, id))}>
        {outside ? (
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
        {outside ? (
          <a href={address} target="_blank" rel="noopener noreferrer" className={PLATE}>
            [ OPEN SOURCE ↗ ]
          </a>
        ) : null}
      </SeeingLenses>

      <div className="frame mt-1 flex min-h-0 flex-1" data-seeing-view>
        {seen !== null ? (
          <>
            <SeeingViewport key={`${key}:${lens.form}`} document={seen} lens={lens} look={look} onOpen={go} onNotice={setNotice} onRestricted={onRestricted} />
            {lens.beside === 'watchers' ? <SeeingWatchers document={seen} /> : null}
          </>
        ) : address === null ? (
          <div className="p-4">
            <button type="button" className={PLATE_MAIN} onClick={() => go(TEST_ADDRESS)}>
              OPEN THE TEST PAGE
            </button>
          </div>
        ) : null}
      </div>

      <p role="status" className={`my-1 max-w-full truncate tabular-nums ${fault ? FAULT : 'text-label text-ink'}`} data-seeing-status>
        {line}
      </p>
    </>
  );
}
