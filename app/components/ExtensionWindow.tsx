'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BOOKMARK_THEME_SLOT, bookmarkAddress } from '../lib/seeing/bookmark-key';
import { changeExtensionSettings, extensionState, extensionStateOnServer, folderCanBePicked, forgetExtensionFolder, installIntoFolder, lookForExtension, pickExtensionFolder, subscribeToExtension, updateExtension, type ExtensionState } from '../lib/seeing/extension-store';
import { STORE_PAGE, storeIdFor } from '../lib/seeing/extension-ids';
import { OWN_EYE_LENSES, openOwnEyeSites, ownEyeTheme } from '../lib/seeing/own-eye';
import { closeExtensionWindow, extensionWindowState, subscribeToExtensionWindow } from '../lib/ui/extension-window';
import { PLATE, PLATE_MAIN, PLATE_PRESSED, TITLE_BAR_INACTIVE } from '../lib/ui/controls';
import { subscribeToTheme, themeState } from '../lib/ui/theme-slot';
import { themeById } from '../lib/ui/themes';
import DockWindow from './DockWindow';
import { explain, NOTE } from '../lib/ui/explain';

/** How long after a page opens the keeper asks: after everything the page itself needs. */
const ASK_AFTER_MS = 5000;

/** Chrome or Edge: the extensions page has its own address in each, and each has its own store. Anything else built on Chrome is Chrome here. */
export type Browser = 'chrome' | 'edge';
const browserIn = (): Browser => {
  const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands ?? [];
  return brands.some((each) => each.brand === 'Microsoft Edge') || /\bEdg\//.test(navigator.userAgent) ? 'edge' : 'chrome';
};
const never = () => () => undefined;

/** The stores' ids as the window uses them: the ones in extension-ids.ts, or a check's. */
export type Stores = { chrome: string | null; edge: string | null };
const STORES: Stores = { chrome: storeIdFor('chrome'), edge: storeIdFor('edge') };

/**
 * The extension kept up to date, and its window (Luke, 2026-11-23: "if you don't have it or it needs an update, it makes you get it first";
 * 2026-11-27: "need the extension to be easier to download and update"). The keeper asks nothing in a browser without the extension; in one
 * with an old copy loaded by hand it updates it when the browser already lets the site write to its folder, and otherwise its key in the
 * browser's bar says an update is ready. A copy from a store is updated by the store.
 */
export default function ExtensionWindow() {
  const { open } = useSyncExternalStore(subscribeToExtensionWindow, extensionWindowState, extensionWindowState);
  useEffect(() => {
    const here = (window as typeof window & { chrome?: { runtime?: { sendMessage?: unknown } } }).chrome?.runtime?.sendMessage !== undefined;
    if (!here) return;
    const timer = window.setTimeout(() => {
      void lookForExtension().then((now) => {
        if (now.kind === 'old' && now.folder === 'granted' && now.from === 'zip') void updateExtension(false);
      });
    }, ASK_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return open ? <ExtensionPanel /> : null;
}

function ExtensionPanel() {
  const state = useSyncExternalStore(subscribeToExtension, extensionState, extensionStateOnServer);
  const browser = useSyncExternalStore(never, browserIn, () => 'chrome' as const);
  useEffect(() => {
    void lookForExtension();
    // It is put in from another page of the browser: looked for again on coming back.
    const again = () => void lookForExtension();
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, []);
  return (
    <DockWindow title="EXTENSION" onClose={closeExtensionWindow} status="" dock="bottom" id="extension" defaultSize={{ w: 400, h: 620 }} minSize={{ w: 280, h: 200 }}>
      <ExtensionBody state={state} canPick={folderCanBePicked()} browser={browser} />
    </DockWindow>
  );
}

/** Said wherever the folder is asked for: it is the whole of what is given. */
const TRUST = "IT LETS THIS SITE CHANGE THE EXTENSION'S CODE: WHOEVER RUNS THIS SITE COULD.";
/**
 * Where the bookmarks-bar key does nothing: the pages are from the drive's table (`scripts/drive-bookmark-key.cjs`, Edge), and a browser's
 * own pages never run a bookmark's code. Chrome and Firefox are tried next (the Firefox trial); the line names what was tried.
 */
const BOOKMARK_WONT =
  'WHERE IT WON\'T WORK: ON A PAGE THAT ALLOWS NO SCRIPTS AT ALL (A RAW FILE ON GITHUB, FOR ONE), ON YOUR BROWSER\'S OWN PAGES (SETTINGS, A NEW TAB, ITS ADD-ONS STORE) AND IN A PDF. IT SIGNS YOU IN TO NOTHING AND SHOWS NOTHING INSIDE DEBASER: IT IS THE LENSES AND MEDIA ONLY. TRIED IN EDGE SO FAR; CHROME AND FIREFOX COME NEXT.';
const STORE_NAME: Record<Browser, string> ={ chrome: 'THE CHROME WEB STORE', edge: 'THE EDGE ADD-ONS STORE' };

/** The store this browser gets it from, once that store has it: Edge's own, or Chrome's (Edge can take Chrome's too, once allowed). */
function storeFor(browser: Browser, stores: Stores): { page: string; name: string; note: string | null } | null {
  if (browser === 'edge' && stores.edge !== null) return { page: STORE_PAGE.edge(stores.edge), name: STORE_NAME.edge, note: null };
  if (stores.chrome === null) return null;
  return { page: STORE_PAGE.chrome(stores.chrome), name: STORE_NAME.chrome, note: browser === 'edge' ? 'EDGE ASKS YOU TO ALLOW EXTENSIONS FROM OTHER STORES FIRST: SAY YES.' : null };
}

export function ExtensionBody({ state, canPick, browser = 'chrome', stores = STORES }: { state: ExtensionState; canPick: boolean; browser?: Browser; stores?: Stores }) {
  const fromStore = state.from === 'chrome' || state.from === 'edge';
  return (
    <div className="space-y-2 p-2 text-label text-ink" data-extension={state.kind}>
      {state.kind === 'asking' ? <p>LOOKING...</p> : null}
      {state.kind === 'unable' ? <p>IT WORKS IN CHROME AND EDGE, ON A COMPUTER.</p> : null}
      {state.kind === 'missing' ? <Get state={state} canPick={canPick} browser={browser} stores={stores} /> : null}
      {state.kind === 'old' ? <Update state={state} canPick={canPick} browser={browser} /> : null}
      {state.kind === 'current' ? <Settings state={state} canPick={canPick} browser={browser} /> : null}
      {state.said !== null ? <p role="status">{state.said}</p> : null}
      {state.kind === 'asking' || state.kind === 'current' ? null : <BookmarkKey />}
      <section>
        <h3 className={TITLE_BAR_INACTIVE}>WHAT IT CAN SEE</h3>
        <p className="py-1">
          ONLY SITES YOU ADD (OR EVERY SITE, IF YOU ALLOW THAT ON ITS OWN SITES PAGE), AND THE TAB YOU PRESS ITS KEY ON. IT NEVER READS PASSWORDS OR COOKIES. IT TELLS THIS SITE ITS VERSION, ITS SETTINGS, WHAT YOU PRESS TO SEND, AND, FOR A PAGE OWN EYE SHOWS IN BROWSER, WHAT THE TOOLS YOU PRESS THERE FIND. A PAGE&apos;S WORDS ONLY IF YOU SWITCH ON KEEP OWN EYE&apos;S PAGES THERE: OFF UNTIL YOU DO. TO TAKE IT OUT: REMOVE IT IN THE BROWSER&apos;S EXTENSIONS PAGE
          {fromStore ? '.' : ', AND DELETE ITS FOLDER.'}
        </p>
      </section>
    </div>
  );
}

/**
 * The bookmarks-bar key (Luke, 2026-11-27: "Bookmarks-bar key (no install)"): the lenses as a bookmark that holds all of its own code, for a
 * browser with no extension. Its address is written onto the key by hand, after the page is up: React refuses a `javascript:` address, and the
 * address carries the colours the reader's theme has now. A press here does nothing: it is for dragging.
 */
function BookmarkKey() {
  const key = useRef<HTMLAnchorElement>(null);
  const [code, setCode] = useState<string | null>(null);
  const [pressed, setPressed] = useState(false);
  const themeId = useSyncExternalStore(subscribeToTheme, themeState, themeState).id;
  useEffect(() => {
    let gone = false;
    void fetch('/api/extension/key')
      .then((answer) => (answer.ok ? answer.text() : ''))
      .then((text) => {
        if (!gone && text.includes(BOOKMARK_THEME_SLOT)) setCode(text);
      })
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, []);
  useEffect(() => {
    if (code === null || key.current === null) return;
    const theme = themeById(themeId);
    key.current.setAttribute('href', bookmarkAddress(code, ownEyeTheme(theme.tokens, theme.scheme)));
  }, [code, themeId]);
  return (
    <section className="space-y-2" data-bookmark-key={code === null ? 'waiting' : 'ready'}>
      <h3 className={TITLE_BAR_INACTIVE}>OR NO INSTALL: A BOOKMARKS-BAR KEY</h3>
      <p>
        <a
          ref={key}
          draggable={code !== null}
          onClick={(event) => {
            event.preventDefault();
            setPressed(true);
          }}
          className={PLATE_MAIN}
          {...explain('A key to drag to your browser\'s bookmarks bar. Pressed there, on any page, it puts a strip of keys on that page: READER, X-RAY, LOW-FI, YOUR THEME, and MEDIA to send a video to DEBASER.', 'For a browser without the extension: nothing is installed, and the key holds all of its own code. It changes the page in front of you only; it is not signed-in browsing inside DEBASER.', 'DRAG IT: A PRESS HERE DOES NOTHING.')}
        >
          DEBASER LENSES
        </a>{' '}
        DRAG THIS KEY TO YOUR BOOKMARKS BAR (CTRL+SHIFT+B SHOWS THE BAR).
      </p>
      {pressed ? <p role="status">DRAG IT TO THE BOOKMARKS BAR: A PRESS HERE DOES NOTHING.</p> : null}
      <p>THEN, ON ANY PAGE, PRESS IT THERE: A STRIP OF KEYS COMES UP ON THAT PAGE, WITH READER, X-RAY, LOW-FI AND YOUR THEME, AND [ MEDIA ] TO SEND A VIDEO ON THE PAGE TO DEBASER. PRESS IT AGAIN TO PUT IT AWAY.</p>
      <p>NOTHING IS INSTALLED, AND IT ASKS THE NETWORK FOR NOTHING. IT IS NOT INSIDE DEBASER.SITE: IT CHANGES THE PAGE IN FRONT OF YOU, IN THAT TAB, UNTIL THE PAGE IS LOADED AGAIN. IT KEEPS THE COLOURS YOUR THEME HAD WHEN YOU DRAGGED IT.</p>
      <p data-bookmark-wont>{BOOKMARK_WONT}</p>
    </section>
  );
}

const Download = ({ words, version }: { words: string; version: string | null }) => (
  <a href={`/api/extension/zip?v=${version ?? ''}`} download className={PLATE_MAIN} {...explain('Downloads the extension as a zip file, the newest version.', 'Unzip it and load the folder in your browser\'s extensions page, as the steps here say.', 'DOWNLOADS A FILE.')}>
    {words}
  </a>
);

/** The extensions page's address, copied: a site can't open that page, or link to it. */
function CopyPage({ browser }: { browser: Browser }) {
  const page = `${browser}://extensions`;
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard
      ?.writeText(page)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };
  return (
    <button type="button" onClick={copy} className={PLATE} data-copy-page={page} {...explain(`Copies ${page} for you to paste into the address bar.`, 'That page is where extensions are put in and switched on; the browser lets no site open it, so it is copied for you to paste.')}>
      [ COPY {page} ]{copied ? ' COPIED' : ''}
    </button>
  );
}

const ItsIn = () => (
  <button type="button" onClick={() => window.location.reload()} title="Loads this page again: a page that was open before it was put in can't hear it" className={PLATE} {...explain('Loads this page again, so it finds the extension you just put in.', 'A page that was already open before the extension went in can\'t hear it until it is loaded again.')}>
    [ IT&apos;S IN ]
  </button>
);

function Get({ state, canPick, browser, stores }: { state: ExtensionState; canPick: boolean; browser: Browser; stores: Stores }) {
  const store = storeFor(browser, stores);
  const wrote = state.wroteInto ?? null;
  const folder = canPick ? (wrote ?? 'YOU CHOSE') : 'debaser-extension';
  return (
    <section className="space-y-2">
      <h3 className={TITLE_BAR_INACTIVE}>GET IT FIRST</h3>
      {store === null ? null : (
        <>
          <a href={store.page} target="_blank" rel="noopener noreferrer" className={PLATE_MAIN} data-store-page {...explain(`Opens the DEBASER extension's page in ${store.name.toLowerCase()}, where one press puts it in.`, 'From a store it updates itself, like any extension: nothing to unzip, no developer mode.', NOTE.leaves)}>
            [ GET IT FROM {store.name} ↗ ]
          </a>
          <p>ONE PRESS THERE, AND IT KEEPS ITSELF UP TO DATE. {store.note ?? ''}</p>
          <h4 className={TITLE_BAR_INACTIVE}>OR BY HAND</h4>
        </>
      )}
      <ol className="list-decimal space-y-1 pl-6">
        <li>
          {!canPick ? (
            <>
              <Download words="DOWNLOAD" version={state.newest} /> UNZIP IT, AND KEEP THE FOLDER WHERE IT CAN STAY.
            </>
          ) : wrote === null ? (
            <>
              <button type="button" disabled={state.busy} onClick={() => void installIntoFolder()} className={store === null ? PLATE_MAIN : PLATE} data-install-folder {...explain('Asks you to choose a new, empty folder, and writes the extension into it: nothing to download or unzip.', 'Each new version is written into the same folder later, so it keeps itself up to date; a folder with anything else in it is refused and nothing is written.', 'THE BROWSER ASKS YOU FIRST.')}>
                [ CHOOSE AN EMPTY FOLDER ]
              </button>{' '}
              MAKE A NEW FOLDER WHERE IT CAN STAY, AND CHOOSE IT: THE SITE WRITES THE EXTENSION INTO IT, AND EACH NEW VERSION LATER. {TRUST}
            </>
          ) : (
            <>IT IS WRITTEN INTO THE FOLDER {wrote}.</>
          )}
        </li>
        <li>
          <CopyPage browser={browser} /> AND PASTE IT INTO THE ADDRESS BAR: A SITE CAN&apos;T OPEN THAT PAGE FOR YOU.
        </li>
        <li>TURN ON &ldquo;Developer mode&rdquo;.</li>
        <li>
          PRESS &ldquo;Load unpacked&rdquo;, AND CHOOSE THE FOLDER {folder}.
        </li>
      </ol>
      <ItsIn />
      {canPick ? (
        <p>
          OR <Download words="DOWNLOAD THE ZIP" version={state.newest} /> AND UNZIP IT, IF YOU&apos;D RATHER: THEN UPDATES ASK FOR ITS FOLDER ONCE.
        </p>
      ) : null}
      <p>THE BROWSER LETS NO SITE TURN ON DEVELOPER MODE OR LOAD IT FOR YOU: ONLY A STORE PUTS AN EXTENSION IN WITH ONE PRESS.</p>
    </section>
  );
}

function Update({ state, canPick, browser }: { state: ExtensionState; canPick: boolean; browser: Browser }) {
  if (state.from === 'chrome' || state.from === 'edge') {
    // From a store, more than one version behind: the store updates it; the extensions page can hurry it.
    return (
      <section className="space-y-2">
        <h3 className={TITLE_BAR_INACTIVE}>UPDATE IT FIRST</h3>
        <p>
          YOU HAVE {state.version}. THIS IS {state.newest}.
        </p>
        <p>
          THE STORE UPDATES IT BY ITSELF. TO HAVE IT NOW: <CopyPage browser={browser} /> PASTE IT INTO THE ADDRESS BAR, TURN ON &ldquo;Developer mode&rdquo; AND PRESS &ldquo;Update&rdquo;.
        </p>
        <ItsIn />
      </section>
    );
  }
  return (
    <section className="space-y-2">
      <h3 className={TITLE_BAR_INACTIVE}>UPDATE IT FIRST</h3>
      <p>
        YOU HAVE {state.version}. THIS IS {state.newest}.
      </p>
      {canPick ? (
        state.folder === 'none' ? (
          <button type="button" disabled={state.busy} onClick={() => void pickExtensionFolder()} className={PLATE_MAIN} {...explain('Asks you to choose the folder you loaded the extension from, so the site can write new versions into it.', 'Once it is chosen, updating is one press, or happens by itself; the browser asks you before the site may write there.')}>
            CHOOSE ITS FOLDER
          </button>
        ) : (
          <button type="button" disabled={state.busy} onClick={() => void updateExtension()} className={PLATE_MAIN} {...explain('Writes the newest version into the extension\'s folder and tells the extension to load it again.', 'Your version is older than the site\'s; some parts of BROWSER need the newest.')}>
            UPDATE
          </button>
        )
      ) : null}
      {canPick ? <p>{state.folder === 'none' ? `THE FOLDER YOU LOADED IT FROM. THE SITE WRITES THE NEW ONE INTO IT; THE BROWSER ASKS YOU FIRST. ${TRUST}` : 'THE BROWSER MAY ASK FIRST.'}</p> : null}
      <p>
        OR <Download words="DOWNLOAD" version={state.newest} /> UNZIP IT OVER THE SAME FOLDER, AND PRESS ↻ ON IT IN THE EXTENSIONS PAGE.
      </p>
    </section>
  );
}

function Settings({ state, canPick, browser }: { state: ExtensionState; canPick: boolean; browser: Browser }) {
  const { settings } = state;
  const fromStore = state.from === 'chrome' || state.from === 'edge';
  return (
    <>
      {(state.copies ?? 0) > 1 ? (
        <p role="note" data-two-copies>
          TWO COPIES ARE IN: IN THE EXTENSIONS PAGE, REMOVE THE ONE LOADED BY HAND (WITH DEVELOPER MODE ON, IT SAYS WHICH FOLDER IT CAME FROM). THE STORE&apos;S KEEPS ITSELF UP TO DATE. <CopyPage browser={browser} />
        </p>
      ) : null}
      <section>
        <h3 className={TITLE_BAR_INACTIVE}>SETTINGS</h3>
        {settings === null ? null : (
          <div className="space-y-2 py-1">
            <p>OPENS PAGES IN</p>
            <p className="flex flex-wrap gap-1" role="group" aria-label="Opens pages in">
              {OWN_EYE_LENSES.map(([id, label]) => (
                <button key={id} type="button" aria-pressed={settings.lens === id} onClick={() => void changeExtensionSettings({ ...settings, lens: id })} {...explain(`Makes ${label} the lens the extension's own page opens pages with.`, 'You can still change the lens on any page afterwards.')} className={settings.lens === id ? `${PLATE_PRESSED} cursor-pointer` : PLATE}>
                  [ {label} ]
                </button>
              ))}
            </p>
            <button type="button" aria-pressed={settings.wear} onClick={() => void changeExtensionSettings({ ...settings, wear: !settings.wear })} {...explain(settings.wear ? 'Stops the extension wearing your DEBASER theme: it goes back to the house colours.' : 'Makes the extension wear your DEBASER theme\'s colours.', 'The theme is used for its own panel and page, and by the YOUR THEME lens.')} className={settings.wear ? `${PLATE_PRESSED} cursor-pointer` : PLATE}>
              [ WEARS THE SITE&apos;S THEME ]
            </button>
            <p>
              <button type="button" onClick={() => void openOwnEyeSites()} title="In the extension's own page: this site is never told them" className={PLATE} {...explain('Opens the extension\'s own page listing the sites you let it act on, where you can add or take one away.', 'The list stays in your browser: this site is never told which sites are on it.', 'OPENS A NEW TAB.')}>
                [ SITES IT MAY ACT ON ↗ ]
              </button>
            </p>
          </div>
        )}
      </section>
      <section>
        <h3 className={TITLE_BAR_INACTIVE}>UPDATES</h3>
        <div className="space-y-2 py-1">
          {fromStore ? (
            <p data-from-store>
              {state.checking
                ? `VERSION ${state.version}, FROM ${STORE_NAME[state.from === 'edge' ? 'edge' : 'chrome']}. THE STORE IS STILL CHECKING THE NEW ONE (${state.newest}): IT UPDATES BY ITSELF.`
                : `VERSION ${state.version}, THE NEWEST, FROM ${STORE_NAME[state.from === 'edge' ? 'edge' : 'chrome']}: IT UPDATES BY ITSELF.`}
            </p>
          ) : (
            <p>VERSION {state.version}, THE NEWEST.</p>
          )}
          {fromStore || !canPick ? null : state.folder === 'none' ? (
            <>
              <button type="button" onClick={() => void pickExtensionFolder()} className={PLATE} {...explain('Asks you to choose the folder you loaded the extension from, so the site can write new versions into it.', 'Once it is chosen, updating is one press, or happens by itself; the browser asks you before the site may write there.')}>
                [ CHOOSE ITS FOLDER ]
              </button>
              <p>THE FOLDER YOU LOADED IT FROM. THEN A NEW VERSION IS WRITTEN INTO IT BY ITSELF IF THE BROWSER LETS THE SITE ON EVERY VISIT, AND BY ONE PRESS HERE IF NOT. {TRUST}</p>
            </>
          ) : (
            <>
              <p>{state.folder === 'granted' ? 'ITS FOLDER IS CHOSEN. NEW VERSIONS ARE WRITTEN INTO IT BY THEMSELVES WHILE THE BROWSER LETS THE SITE.' : 'ITS FOLDER IS CHOSEN. THE BROWSER WILL ASK BEFORE A NEW VERSION IS WRITTEN.'}</p>
              <button type="button" onClick={() => void forgetExtensionFolder()} className={PLATE} {...explain('Makes the site forget the extension\'s folder: it stops writing new versions into it.', 'The folder and the extension stay as they are; choose the folder again to have updates written for you.')}>
                [ FORGET THE FOLDER ]
              </button>
            </>
          )}
        </div>
      </section>
    </>
  );
}
