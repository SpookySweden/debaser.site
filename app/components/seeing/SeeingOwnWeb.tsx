'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { matchesWords, searchWords } from '../../lib/search/site-search';
import { forgetOwnWeb, isOwnWeb, ownWebOn, ownWebOnServer, setOwnWeb, subscribeToOwnWeb } from '../../lib/seeing/own-web';
import { keptAddress, pageWords, type SeenPage } from '../../lib/seeing/pages';
import { keptPages, keptPagesOnServer, removePage, subscribeToKeptPages } from '../../lib/seeing/pages-store';
import { explain, NOTE } from '../../lib/ui/explain';
import { FIELD_TIGHT, PLATE, PLATE_PRESSED, TITLE_BAR_INACTIVE } from '../../lib/ui/controls';

const SHOWN = 100;

/** OWN WEB, over the page: every page you opened from the house, found by words or by site, and taken out by page, by site or all. */
export default function SeeingOwnWeb({ onGo, onClose }: { onGo: (address: string) => void; onClose: () => void }) {
  const every = useSyncExternalStore(subscribeToKeptPages, keptPages, keptPagesOnServer);
  const keeping = useSyncExternalStore(subscribeToOwnWeb, ownWebOn, ownWebOnServer);
  const pages = useMemo(() => every.filter(isOwnWeb), [every]);
  const [words, setWords] = useState('');
  const [site, setSite] = useState<string | null>(null);
  const [sure, setSure] = useState<string | null>(null);
  const sites = useMemo(() => [...pages.reduce((all, page) => all.set(page.site, (all.get(page.site) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]), [pages]);
  const found = useMemo(() => pages.filter((page) => (site === null || page.site === site) && (words.trim() === '' || matchesWords(searchWords(words), ...pageWords(page), page.address))), [pages, site, words]);
  const twice = (key: string, act: () => void) => () => {
    if (sure === key) {
      act();
      setSure(null);
    } else setSure(key);
  };
  return (
    <section aria-label="Own web" className="absolute inset-0 z-30 flex flex-col bg-paper p-2 text-label text-ink" data-seeing-own-web={pages.length}>
      <div className="flex flex-wrap items-center gap-1">
        <h2 className={`${TITLE_BAR_INACTIVE} min-w-40 flex-1`}>OWN WEB</h2>
        <input value={words} onChange={(event) => setWords(event.target.value)} aria-label="Find in your own web" placeholder="FIND" spellCheck={false} className={`${FIELD_TIGHT} w-40`} {...explain('Finds kept pages by their title, address, description and the words they were kept with.', 'Your own web is every page you opened from the house.')} />
        <button type="button" aria-pressed={keeping} onClick={() => setOwnWeb(!keeping)} className={keeping ? `${PLATE_PRESSED} cursor-pointer` : PLATE} {...explain(keeping ? 'Stops keeping the pages you open from now on.' : 'Keeps the pages you open from the house again.', 'What is kept already stays until you delete it.')}>
          {keeping ? '[ KEEPING WHAT I OPEN ]' : '[ NOT KEEPING ]'}
        </button>
        <button type="button" aria-label="Close own web" onClick={onClose} className={PLATE} {...explain('Closes OWN WEB and shows the page again.')}>
          [ × ]
        </button>
      </div>
      <p className="text-ink-quiet">YOURS ALONE. EVERY PAGE YOU OPEN FROM THE HOUSE, KEPT WHOLE ONCE A DAY. NEVER WHAT YOUR OWN BROWSER SHOWS, A SIGN-IN, OR A FORM.</p>
      {sites.length > 0 ? (
        <p className="flex flex-wrap items-center gap-1 py-1">
          {sites.slice(0, 40).map(([name, count]) => (
            <button key={name} type="button" aria-pressed={site === name} onClick={() => setSite(site === name ? null : name)} className={site === name ? `${PLATE_PRESSED} cursor-pointer` : PLATE} {...explain(`Shows only the pages kept from ${name}.`)}>
              {name} {count}
            </button>
          ))}
          {site !== null ? (
            <button type="button" onBlur={() => setSure(null)} onClick={twice(`site ${site}`, () => void forgetOwnWeb((page) => page.site === site).then(() => setSite(null)))} className={PLATE} {...explain(`Deletes every page kept from ${site}.`, 'Press twice.', NOTE.undo)}>
              {sure === `site ${site}` ? '[ DELETE THEM ALL? ]' : '[ DELETE THIS SITE ]'}
            </button>
          ) : null}
          <button type="button" onBlur={() => setSure(null)} onClick={twice('all', () => void forgetOwnWeb(() => true))} className={PLATE} {...explain('Deletes every page in your own web.', 'Press twice.', NOTE.undo)}>
            {sure === 'all' ? '[ DELETE EVERYTHING? ]' : '[ DELETE EVERYTHING ]'}
          </button>
        </p>
      ) : null}
      {found.length === 0 ? <p className="p-1">{pages.length === 0 ? 'NOTHING YET: PAGES YOU OPEN FROM THE HOUSE ARE KEPT HERE.' : 'NOTHING FOUND.'}</p> : null}
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {found.slice(0, SHOWN).map((page) => (
          <Row key={page.id} page={page} onGo={onGo} />
        ))}
      </ul>
    </section>
  );
}

function Row({ page, onGo }: { page: SeenPage; onGo: (address: string) => void }) {
  const [sure, setSure] = useState(false);
  return (
    <li className="rule-pixel flex flex-wrap items-baseline gap-x-2 py-1">
      <span className="tabular-nums text-ink-quiet">{new Date(page.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase()}</span>
      <button type="button" onClick={() => onGo(keptAddress(page.id))} title={page.address} className={`${PLATE} max-w-full min-w-0 truncate`} {...explain('Opens the copy kept that day, here, with nothing asked of the site.', 'It still opens if the site has changed or gone.')}>
        {page.title}
      </button>
      <span className="text-ink-quiet">{page.site}</span>
      <button type="button" onClick={() => onGo(page.address)} className={PLATE} {...explain('Opens the page as it is now, from the house.')}>
        [ NOW ]
      </button>
      <button type="button" onBlur={() => setSure(false)} onClick={() => (sure ? void removePage(page) : setSure(true))} className={PLATE} {...explain('Deletes this kept page and its copy.', 'Press twice.', NOTE.undo)}>
        {sure ? '[ DELETE IT? ]' : '[ DELETE ]'}
      </button>
    </li>
  );
}
