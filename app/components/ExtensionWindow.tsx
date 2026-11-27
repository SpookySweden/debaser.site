'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { changeExtensionSettings, extensionState, extensionStateOnServer, folderCanBePicked, forgetExtensionFolder, lookForExtension, pickExtensionFolder, subscribeToExtension, updateExtension, type ExtensionState } from '../lib/seeing/extension-store';
import { OWN_EYE_LENSES, openOwnEyeSites } from '../lib/seeing/own-eye';
import { closeExtensionWindow, extensionWindowState, subscribeToExtensionWindow } from '../lib/ui/extension-window';
import { PLATE, PLATE_MAIN, PLATE_PRESSED, TITLE_BAR_INACTIVE } from '../lib/ui/controls';
import DockWindow from './DockWindow';
import { explain } from '../lib/ui/explain';

/** How long after a page opens the keeper asks: after everything the page itself needs. */
const ASK_AFTER_MS = 5000;

/**
 * The extension kept up to date, and its window (Luke, 2026-11-23: "if you don't have it or it needs an update, it makes you get it first").
 * The keeper asks nothing in a browser without the extension; in one with an old version it updates it when the browser already lets the site
 * write to its folder, and otherwise its key in the browser's bar says an update is ready.
 */
export default function ExtensionWindow() {
  const { open } = useSyncExternalStore(subscribeToExtensionWindow, extensionWindowState, extensionWindowState);
  useEffect(() => {
    const here = (window as typeof window & { chrome?: { runtime?: { sendMessage?: unknown } } }).chrome?.runtime?.sendMessage !== undefined;
    if (!here) return;
    const timer = window.setTimeout(() => {
      void lookForExtension().then((now) => {
        if (now.kind === 'old' && now.folder === 'granted') void updateExtension(false);
      });
    }, ASK_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return open ? <ExtensionPanel /> : null;
}

function ExtensionPanel() {
  const state = useSyncExternalStore(subscribeToExtension, extensionState, extensionStateOnServer);
  useEffect(() => {
    void lookForExtension();
    // It is put in from another page of the browser: looked for again on coming back.
    const again = () => void lookForExtension();
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, []);
  return (
    <DockWindow title="EXTENSION" onClose={closeExtensionWindow} status="" dock="bottom" id="extension" defaultSize={{ w: 400, h: 620 }} minSize={{ w: 280, h: 200 }}>
      <ExtensionBody state={state} canPick={folderCanBePicked()} />
    </DockWindow>
  );
}

/** Said wherever the folder is asked for: it is the whole of what is given. */
const TRUST = "IT LETS THIS SITE CHANGE THE EXTENSION'S CODE: WHOEVER RUNS THIS SITE COULD.";

export function ExtensionBody({ state, canPick }: { state: ExtensionState; canPick: boolean }) {
  return (
    <div className="space-y-2 p-2 text-label text-ink" data-extension={state.kind}>
      {state.kind === 'asking' ? <p>LOOKING...</p> : null}
      {state.kind === 'unable' ? <p>IT WORKS IN CHROME AND EDGE, ON A COMPUTER.</p> : null}
      {state.kind === 'missing' ? <Get newest={state.newest} /> : null}
      {state.kind === 'old' ? <Update state={state} canPick={canPick} /> : null}
      {state.kind === 'current' ? <Settings state={state} canPick={canPick} /> : null}
      {state.said !== null ? <p role="status">{state.said}</p> : null}
      <section>
        <h3 className={TITLE_BAR_INACTIVE}>WHAT IT CAN SEE</h3>
        <p className="py-1">
          ONLY SITES YOU ADD, AND THE TAB YOU PRESS ITS KEY ON. IT NEVER READS PASSWORDS OR COOKIES. IT TELLS THIS SITE ITS VERSION, ITS TWO SETTINGS, AND WHAT YOU PRESS TO SEND. TO TAKE IT OUT: REMOVE IT IN THE BROWSER&apos;S EXTENSIONS PAGE,
          AND DELETE ITS FOLDER.
        </p>
      </section>
    </div>
  );
}

const Download = ({ words, version }: { words: string; version: string | null }) => (
  <a href={`/api/extension/zip?v=${version ?? ''}`} download className={PLATE_MAIN} {...explain('Downloads the extension as a zip file, the newest version.', 'Unzip it and load the folder in your browser\'s extensions page, as the steps here say.', 'DOWNLOADS A FILE.')}>
    {words}
  </a>
);

function Get({ newest }: { newest: string | null }) {
  return (
    <section className="space-y-2">
      <h3 className={TITLE_BAR_INACTIVE}>GET IT FIRST</h3>
      <Download words="DOWNLOAD" version={newest} />
      <ol className="list-decimal space-y-1 pl-6">
        <li>UNZIP IT, AND KEEP THE FOLDER WHERE IT CAN STAY.</li>
        <li>OPEN chrome://extensions (IN EDGE, edge://extensions).</li>
        <li>TURN ON DEVELOPER MODE.</li>
        <li>PRESS LOAD UNPACKED, AND CHOOSE THE FOLDER debaser-extension.</li>
      </ol>
      <button type="button" onClick={() => window.location.reload()} title="Loads this page again: a page that was open before it was put in can't hear it" className={PLATE} {...explain('Loads this page again, so it finds the extension you just put in.', 'A page that was already open before the extension went in can\'t hear it until it is loaded again.')}>
        [ IT&apos;S IN ]
      </button>
    </section>
  );
}

function Update({ state, canPick }: { state: ExtensionState; canPick: boolean }) {
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

function Settings({ state, canPick }: { state: ExtensionState; canPick: boolean }) {
  const { settings } = state;
  return (
    <>
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
          <p>VERSION {state.version}, THE NEWEST.</p>
          {!canPick ? null : state.folder === 'none' ? (
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
