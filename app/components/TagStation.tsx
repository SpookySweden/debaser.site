'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { buildIndex, edgePicks, findTag, loosenings, neighbourhood, relatedTags, sameMix, suggest, tagPassesFacet, tagPassesNiche, type StationIndex } from '../lib/tag-station/query';
import { listOf, parseRecipe, recipeQuery, withWordIn, type Recipe, type Sort } from '../lib/tag-station/recipe';
import type { StationGraph, StationItem } from '../lib/tag-station/types';
import { eraOf } from '../lib/tag-station/words';
import { FIELD_TIGHT } from '../lib/ui/controls';
import { loadPeertubeHosts, needsPeertubeHosts } from '../lib/web/everywhere-client';
import { contentLanguage } from '../lib/web/language';
import { rowAddresses, startingEmbed, type ExtraHosts } from '../lib/web/row-addresses';
import { PLATFORM_LABELS, type WebItem } from '../lib/web/types';
import { isBarAudioPlatform, parseWebAudioSrc, playsInBar } from '../lib/web/web-audio';
import { webSessionHeaders } from '../lib/web/web-session';
import { loadWebItem } from '../lib/web/web-track-lookup';
import InfoFold from './InfoFold';
import { useMusicPlayer } from './MusicPlayerProvider';
import TagStationFilters from './TagStationFilters';
import { linkMapWords, LinkInput, useLinkAnswer } from './TagStationLink';
import TagStationList from './TagStationList';
import TagStationMap from './TagStationMap';
import { FindInMedia, ItemRow, STATION_KEY, STATION_KEY_ON, Thumb, TitleLine, WordChip, WordFacets } from './TagStationParts';
import TagStationSearch from './TagStationSearch';

const PAGE_PATH = '/tag-station';
const ITEMS_STEP = 12;
const RELATED_SHOWN = 12;

/**
 * TEXT SIZE (SPEC-tag-station.md): S is the site's own sizes; the rest point the page's small text at a larger token, so every
 * label on this page grows together. Remembered per browser; a browser that won't remember just gets M.
 */
const TEXT_SIZES = {
  S: {},
  M: { '--text-label': 'var(--text-title)', '--text-key': 'var(--text-title)', '--text-prose': 'var(--text-title)' },
  L: { '--text-label': 'var(--text-display)', '--text-key': 'var(--text-display)', '--text-prose': 'var(--text-display)', '--text-title': 'var(--text-display)' },
  XL: { '--text-label': 'var(--text-headline)', '--text-key': 'var(--text-headline)', '--text-prose': 'var(--text-headline)', '--text-title': 'var(--text-headline)' },
} as const;
type TextSize = keyof typeof TEXT_SIZES;
const TEXT_SIZE_KEY = 'tag-station-text-size';
const sizeListeners = new Set<() => void>();

function readTextSize(): TextSize {
  try {
    const stored = window.localStorage.getItem(TEXT_SIZE_KEY);
    return stored !== null && stored in TEXT_SIZES ? (stored as TextSize) : 'M';
  } catch {
    return 'M';
  }
}

function writeTextSize(size: TextSize): void {
  try {
    window.localStorage.setItem(TEXT_SIZE_KEY, size);
  } catch {
    // A browser that refuses storage keeps the default.
  }
  sizeListeners.forEach((listener) => listener());
}

function subscribeTextSize(listener: () => void): () => void {
  sizeListeners.add(listener);
  return () => {
    sizeListeners.delete(listener);
  };
}

/** Loads the map once, with the reader's session. */
function useGraph(): { index: StationIndex | null; error: string | null } {
  const [state, setState] = useState<{ index: StationIndex | null; error: string | null }>({ index: null, error: null });
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const headers = await webSessionHeaders();
        if (headers === null) throw new Error('Sign in to use Tag Station.');
        const response = await fetch('/api/tag-station/graph', { headers });
        const body = (await response.json()) as StationGraph & { error?: string };
        if (!response.ok) throw new Error(body.error ?? 'The map could not be loaded.');
        if (live) setState({ index: buildIndex(body), error: null });
      } catch (problem) {
        if (live) setState({ index: null, error: problem instanceof Error ? problem.message : 'The map could not be loaded.' });
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  return state;
}

/** The PeerTube instances outside MEDIA's fixed three, as MEDIA reads them, so those rows draw their links and pictures. */
function useExtraHosts(items: readonly StationItem[]): ExtraHosts {
  const [hosts, setHosts] = useState<string[]>([]);
  const need = hosts.length === 0 && items.some((item) => needsPeertubeHosts(item as WebItem));
  useEffect(() => {
    if (!need) return;
    let live = true;
    void loadPeertubeHosts().then((found) => {
      if (live) setHosts([...found]);
    });
    return () => {
      live = false;
    };
  }, [need]);
  return useMemo(() => ({ peertube: hosts }), [hosts]);
}

const WHERE = { origin: 'shelf', href: PAGE_PATH, where: 'TAG STATION' } as const;

/** PLAY: audio goes to the site's music bar as on MEDIA; anything else the platform's own player, only once it's asked for. */
function PlayKeys({ item, extraHosts }: { item: StationItem; extraHosts: ExtraHosts }) {
  const player = useMusicPlayer();
  const [state, setState] = useState<'idle' | 'finding' | 'none'>('idle');
  const [playerFor, setPlayerFor] = useState<string | null>(null);
  const open = playerFor === item.id;
  const { link, embed } = rowAddresses(item as WebItem, extraHosts);
  const source = PLATFORM_LABELS[item.platform];
  const onBar = player.track ? parseWebAudioSrc(player.track.src) : null;
  const mine = onBar !== null && onBar.platform === item.platform && onBar.externalId === item.externalId;
  const sounding = mine && player.playing;
  const inBar = playsInBar(item);

  const pressBar = async () => {
    if (mine) {
      player.toggle();
      return;
    }
    if (state === 'finding') return;
    setState('finding');
    const tracks = isBarAudioPlatform(item.platform) ? await loadWebItem(item.platform, item.externalId) : null;
    if (tracks) {
      setState('idle');
      player.playList(tracks, WHERE);
    } else if (embed) {
      setState('idle');
      setPlayerFor(item.id);
    } else {
      setState('none');
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        {inBar && !open ? (
          <button type="button" onClick={() => void pressBar()} aria-pressed={sounding} aria-busy={state === 'finding'} aria-label={sounding ? `Pause "${item.title}" in the music player` : `Play "${item.title}" in the music player`} className={sounding ? STATION_KEY_ON : STATION_KEY}>
            {state === 'finding' ? '[ … FINDING ]' : sounding ? '❚❚ PAUSE' : '[ ▶ PLAY ]'}
          </button>
        ) : embed ? (
          <button type="button" onClick={() => setPlayerFor(open ? null : item.id)} aria-expanded={open} aria-label={open ? `Close the ${source} player for "${item.title}"` : `Play "${item.title}" (loads the ${source} player)`} className={open ? STATION_KEY_ON : STATION_KEY}>
            {open ? '■ CLOSE' : '[ ▶ PLAY ]'}
          </button>
        ) : null}
        {link ? (
          <a href={link} target="_blank" rel="noopener noreferrer nofollow" aria-label={`Open "${item.title}" on ${source} (new tab)`} className={STATION_KEY}>
            [ OPEN ↗ ]
          </a>
        ) : null}
        {state === 'none' ? (
          <span role="status" className="text-label font-bold text-ink">
            NO PLAYABLE FILE
          </span>
        ) : null}
      </div>
      {/* Nothing from the platform loads until the reader asks; the same sandbox as MEDIA's rows (WebStream.tsx). */}
      {open && embed ? (
        <iframe
          src={startingEmbed(embed, item.platform, contentLanguage(item as WebItem))}
          title={`${source} player: ${item.title}`}
          loading="lazy"
          referrerPolicy={item.platform === 'youtube' ? 'strict-origin' : 'no-referrer'}
          sandbox="allow-scripts allow-same-origin"
          allow={item.kind === 'video' ? 'autoplay; fullscreen' : 'autoplay'}
          className={`block w-full border border-ink-plate bg-paper ${item.kind === 'video' ? 'aspect-video' : item.kind === 'text' ? 'h-96' : 'h-tap'}`}
        />
      ) : null}
    </div>
  );
}

/** The input panel with an item chosen: its picture, player, words, each marked with where it came from. */
function ItemInput({ item, extraHosts, onPick, onAdd }: { item: StationItem; extraHosts: ExtraHosts; onPick: (word: string) => void; onAdd: (word: string) => void }) {
  const { thumb, licence } = rowAddresses(item as WebItem, extraHosts);
  return (
    <div className="flex flex-col gap-2">
      <Thumb src={thumb} wide />
      <p className="break-words text-title font-bold text-ink">{item.title}</p>
      <p className="break-words text-label text-ink">
        {PLATFORM_LABELS[item.platform]} · {item.kind.toUpperCase()}
        {Number.isFinite(Date.parse(item.publishedAt)) ? ` · ${item.publishedAt.slice(0, 10)}` : ''}
        {item.creator ? ` · ${item.creator}` : ''}
      </p>
      {item.seenOnly ? <FindInMedia item={item} /> : <PlayKeys item={item} extraHosts={extraHosts} />}
      {item.description ? <p className="break-words text-prose text-ink">{item.description}</p> : null}
      {licence ? (
        <a href={licence} target="_blank" rel="noopener noreferrer nofollow" className={STATION_KEY}>
          [ LICENCE ↗ ]
        </a>
      ) : null}
      <h3 className="text-label font-bold text-ink-quiet">ITS WORDS</h3>
      {item.words.length === 0 ? <p className="text-prose text-ink">NO WORDS YET.</p> : null}
      <ul className="flex flex-wrap gap-1">
        {item.words.map((word) => (
          <li key={word.word}>
            <WordChip word={word.word} from={word} onPick={onPick} onAdd={onAdd} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Facts about a word: only ever about our own saved items. */
function WordFacts({ index, word, onPick, onAdd }: { index: StationIndex; word: string; onPick: (word: string) => void; onAdd: (word: string) => void }) {
  const tag = index.tagByName.get(word);
  if (tag === undefined) return null;
  const year = (iso: string | null) => (iso === null ? '?' : iso.slice(0, 4));
  return (
    <div className="flex flex-col gap-1 text-prose text-ink">
      <p>{tag.count === 1 ? 'ON 1 ITEM' : `ON ${tag.count} ITEMS`}</p>
      <p>
        FIRST {year(tag.first)} · LATEST {year(tag.latest)}
      </p>
      {tag.era !== null ? <p>ERA: {tag.era.toUpperCase()}</p> : null}
      <p>
        {tag.claude > 0 ? `FROM CLAUDE ON ${tag.claude}` : ''}
        {tag.claude > 0 && tag.platform > 0 ? ' · ' : ''}
        {tag.platform > 0 ? `FROM THE PLATFORM ON ${tag.platform}` : ''}
      </p>
      <h3 className="text-label font-bold text-ink-quiet">OFTEN WITH</h3>
      <ul className="flex flex-wrap gap-1">
        {[...tag.partners]
          .sort((a, b) => b.shared - a.shared || (a.name < b.name ? -1 : 1))
          .slice(0, 5)
          .map((partner) => (
            <li key={partner.name}>
              <WordChip word={partner.name} onPick={onPick} onAdd={onAdd} />
            </li>
          ))}
      </ul>
    </div>
  );
}

const SORTS: readonly { value: Sort; label: string }[] = [
  { value: 'close', label: 'CLOSEST' },
  { value: 'rare', label: 'RAREST' },
  { value: 'new', label: 'NEWEST' },
  { value: 'tagged', label: 'MOST WORDS' },
];

export function Station({ index }: { index: StationIndex }) {
  const router = useRouter();
  const params = useSearchParams();
  const recipe = useMemo(() => parseRecipe(params), [params]);
  const searchBox = useRef<HTMLInputElement>(null);
  const textSize = useSyncExternalStore(subscribeTextSize, readTextSize, () => 'M' as TextSize);
  const [shownFor, setShownFor] = useState<{ key: string; count: number }>({ key: '', count: ITEMS_STEP });
  const [copied, setCopied] = useState(false);

  const go = useCallback(
    (next: Recipe, how: 'push' | 'replace' = 'replace') => {
      const query = recipeQuery(next);
      router[how](query ? `${PAGE_PATH}?${query}` : PAGE_PATH, { scroll: false });
    },
    [router],
  );
  const pickTag = useCallback((name: string) => go({ ...recipe, tag: name, item: null, link: null }, 'push'), [go, recipe]);
  const pickItem = useCallback((id: string) => go({ ...recipe, item: id, tag: null, link: null }, 'push'), [go, recipe]);
  const addWord = useCallback((word: string) => go(withWordIn(recipe, word, listOf(recipe, word) ?? 'must')), [go, recipe]);

  const link = useLinkAnswer(recipe.link);
  const linkWords = useMemo(() => {
    const { matched, fromText } = linkMapWords(index, link?.answer ?? null);
    return [...matched, ...fromText];
  }, [index, link]);
  // A link to something already saved is that saved item: its Claude words, its place on the map.
  const savedId = link?.answer?.item?.id ?? null;
  useEffect(() => {
    if (savedId !== null && index.itemById.has(savedId)) go({ ...recipe, item: savedId, link: null, tag: null });
  }, [savedId, index, go, recipe]);
  const { focus, matched, results } = useMemo(() => neighbourhood(index, recipe, linkWords), [index, recipe, linkWords]);
  const related = useMemo(() => relatedTags(index, recipe, focus, 60), [index, recipe, focus]);
  const visibleNames = useMemo(
    () =>
      new Set(
        index.graph.tags
          .filter((tag) => tagPassesNiche(tag, recipe, index.total) && tagPassesFacet(tag, recipe) && (recipe.src === 'both' || (recipe.src === 'claude' ? tag.claude > 0 : tag.platform > 0)) && !recipe.not.includes(tag.name))
          .map((tag) => tag.name),
      ),
    [index, recipe],
  );

  const recipeKey = recipeQuery(recipe);
  const shownCount = shownFor.key === recipeKey ? shownFor.count : ITEMS_STEP;
  const shownItems = results.slice(0, shownCount);
  const skip = useMemo(() => new Set(results.slice(0, ITEMS_STEP).map((item) => item.id)), [results]);
  const mix = useMemo(() => sameMix(index, matched, recipe, focus, skip), [index, matched, recipe, focus, skip]);
  const edge = useMemo(() => edgePicks(index, matched, focus, new Set([...skip, ...mix.map((one) => one.item.id)])), [index, matched, focus, skip, mix]);
  const hints = useMemo(() => (results.length < 5 ? loosenings(index, recipe, focus, results.length, linkWords) : []), [index, recipe, focus, results.length, linkWords]);
  const extraHosts = useExtraHosts(index.graph.items);

  const chosenTag = recipe.tag !== null ? findTag(index, recipe.tag) : null;
  const chosenItem = recipe.item !== null ? (index.itemById.get(recipe.item) ?? null) : null;
  const closest = related.slice(0, 3).map((one) => one.tag.name);
  const spoken = chosenTag !== null ? `${chosenTag.name}.` : chosenItem !== null ? `${chosenItem.title}.` : '';
  const announcement = spoken === '' ? '' : `${spoken}${closest.length > 0 ? ` CLOSEST: ${closest.join(', ')}.` : ''}`;

  const facetOf = useCallback((word: string) => index.tagByName.get(word)?.facet ?? null, [index]);

  const copyLink = () => {
    void navigator.clipboard?.writeText(window.location.href).then(() => setCopied(true));
  };

  return (
    <WordFacets.Provider value={facetOf}>
    <div style={TEXT_SIZES[textSize] as CSSProperties} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <TagStationSearch index={index} inputRef={searchBox} onTag={pickTag} onItem={pickItem} onLink={(link) => go({ ...recipe, link, tag: null, item: null }, 'push')} />
        <div role="group" aria-label="Text size" className="flex items-center gap-1">
          {(Object.keys(TEXT_SIZES) as TextSize[]).map((size) => (
            <button key={size} type="button" aria-pressed={size === textSize} aria-label={`Text size ${size}`} onClick={() => writeTextSize(size)} className={size === textSize ? STATION_KEY_ON : STATION_KEY}>
              {size === textSize ? size : `[ ${size} ]`}
            </button>
          ))}
        </div>
        <button type="button" onClick={copyLink} onBlur={() => setCopied(false)} className={STATION_KEY}>
          {copied ? '[ COPIED ]' : '[ COPY LINK ]'}
        </button>
        <InfoFold topic="Tag Station">
          C IS CLAUDE&apos;S WORD, P THE PLATFORM&apos;S OWN, L A PASTED LINK&apos;S OWN, T FROM ITS TITLE. G IS A GENRE, M A MOOD, W A PLACE, E AN ERA, F A FORM, S A SUBJECT. TWO WORDS ARE CLOSE WHEN THEY MEET ON AT LEAST 3 ITEMS, MORE OFTEN THAN CHANCE. {index.total} ITEMS, {index.graph.tags.length} WORDS. COUNTS ARE ONLY OF WHAT THIS SITE HAS SAVED OR SHOWN.
        </InfoFold>
      </div>

      {index.graph.limitReached ? <p className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">TAGGING STOPPED: THE $60 LIMIT IS REACHED.</p> : null}

      <TagStationFilters index={index} recipe={recipe} onChange={(next) => go(next)} />

      <p role="status" className="sr-only">
        {announcement}
      </p>

      <div className="flex flex-wrap items-start gap-4">
        {/* Input: what was chosen. */}
        <section aria-labelledby="ts-input" className="flex min-w-0 flex-1 basis-52 flex-col gap-2">
          <TitleLine id="ts-input">INPUT</TitleLine>
          {chosenItem !== null ? (
            <ItemInput key={chosenItem.id} item={chosenItem} extraHosts={extraHosts} onPick={pickTag} onAdd={addWord} />
          ) : chosenTag !== null ? (
            <div className="flex flex-col gap-2">
              <p className="break-words text-headline font-bold text-ink">{chosenTag.name}</p>
              {eraOf(chosenTag.name) !== null ? <p className="text-label text-ink">E · AN ERA</p> : null}
              <button type="button" onClick={() => addWord(chosenTag.name)} aria-label={`Add ${chosenTag.name} to the recipe`} className={STATION_KEY}>
                [ + ADD TO RECIPE ]
              </button>
            </div>
          ) : link !== null ? (
            <LinkInput
              key={link.link}
              index={index}
              state={link}
              extraHosts={extraHosts}
              onPick={pickTag}
              onAdd={addWord}
              play={(item) => <PlayKeys item={{ ...item, words: [] }} extraHosts={extraHosts} />}
            />
          ) : recipe.tag !== null ? (
            <div className="flex flex-col gap-2">
              <p className="w-fit break-words bg-bubble-pale px-1 text-label text-ink-bar">NO SUCH WORD: {recipe.tag}</p>
              <ul className="flex flex-wrap gap-1">
                {suggest(index, recipe.tag).tags.map((tag) => (
                  <li key={tag.name}>
                    <WordChip word={tag.name} onPick={pickTag} onAdd={addWord} />
                  </li>
                ))}
              </ul>
            </div>
          ) : recipe.item !== null ? (
            <p className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">THAT ITEM IS GONE.</p>
          ) : (
            <p className="text-prose text-ink">PICK A WORD OR AN ITEM, OR PASTE A LINK.</p>
          )}
        </section>

        {/* The words: map or list, one switch, the same data. */}
        <section aria-labelledby="ts-words" className="flex min-w-0 grow-3 basis-160 flex-col gap-2">
          <TitleLine id="ts-words">WORDS</TitleLine>
          <div role="group" aria-label="Show words as" className="flex flex-wrap items-center gap-1">
            {(['map', 'list'] as const).map((view) => (
              <button key={view} type="button" aria-pressed={recipe.view === view} onClick={() => go({ ...recipe, view })} className={recipe.view === view ? STATION_KEY_ON : STATION_KEY}>
                {recipe.view === view ? view.toUpperCase() : `[ ${view.toUpperCase()} ]`}
              </button>
            ))}
          </div>
          {recipe.view === 'map' ? (
            <TagStationMap index={index} focus={focus.words} related={related} visibleNames={visibleNames} inRecipe={(word) => listOf(recipe, word)} onPick={pickTag} onAdd={addWord} onEscape={() => searchBox.current?.focus()} />
          ) : (
            <TagStationList index={index} focus={focus.words} related={related} visibleNames={visibleNames} onPick={pickTag} onAdd={addWord} />
          )}
        </section>

        {/* The neighbourhood: what's around the choice. */}
        <section aria-labelledby="ts-near" className="flex min-w-0 flex-1 basis-64 flex-col gap-3">
          <TitleLine id="ts-near">NEIGHBOURHOOD</TitleLine>
          {/* Side by side when the panel has the width, one under another when it doesn't. */}
          <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1 basis-64">
            <h3 className="text-label font-bold text-ink-quiet">{focus.words.length > 0 ? 'RELATED WORDS' : 'MOST USED WORDS'}</h3>
            <ul>
              {related.slice(0, RELATED_SHOWN).map((one) => (
                <li key={one.tag.name} className="rule-pixel py-1">
                  <WordChip word={one.tag.name} onPick={pickTag} onAdd={addWord} />
                  <p className="break-words text-label text-ink">
                    {one.close ? 'CLOSE · ' : ''}
                    {one.reason}
                  </p>
                </li>
              ))}
            </ul>
            {related.length === 0 ? <p className="text-prose text-ink">NOTHING NEAR.</p> : null}
          </div>

          <div className="min-w-0 flex-1 basis-64">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <h3 role="status" className="text-label font-bold text-ink-quiet">
                {focus.words.length > 0 ? 'CLOSEST ITEMS' : 'ITEMS'}: {results.length}
              </h3>
              <label className="inline-flex items-center gap-1 text-label font-bold text-ink-quiet">
                SORT
                <select value={recipe.sort} onChange={(event) => go({ ...recipe, sort: event.target.value as Sort })} className={`${FIELD_TIGHT} min-h-tap`}>
                  {SORTS.map((sort) => (
                    <option key={sort.value} value={sort.value}>
                      {sort.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {results.length === 0 ? <p className="py-1 text-title text-ink">NOTHING FOUND.</p> : null}
            {hints.length > 0 ? (
              <ul aria-label="Ways to find more" className="flex flex-col items-start gap-1 py-1">
                {hints.map((hint) => (
                  <li key={hint.label}>
                    <button type="button" onClick={() => go(hint.recipe)} className={`${STATION_KEY} break-words text-left`}>
                      [ {hint.label}: {hint.more} MORE ]
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <ul>
              {shownItems.map((item) => (
                <ItemRow key={item.id} item={item} extraHosts={extraHosts} onPick={pickItem} />
              ))}
            </ul>
            {results.length > shownCount ? (
              <button type="button" onClick={() => setShownFor({ key: recipeKey, count: shownCount + ITEMS_STEP })} className={STATION_KEY}>
                [ MORE ITEMS ]
              </button>
            ) : null}
          </div>

          {mix.length > 0 ? (
            <div className="min-w-0 flex-1 basis-64">
              <h3 className="text-label font-bold text-ink-quiet">SAME MIX, DIFFERENT FLAVOUR</h3>
              <ul>
                {mix.map((one) => (
                  <ItemRow key={one.item.id} item={one.item} note={one.note} extraHosts={extraHosts} onPick={pickItem} />
                ))}
              </ul>
            </div>
          ) : null}

          {edge.length > 0 ? (
            <div className="min-w-0 flex-1 basis-64">
              <h3 className="text-label font-bold text-ink-quiet">EDGE PICKS</h3>
              <ul>
                {edge.map((item) => (
                  <ItemRow key={item.id} item={item} extraHosts={extraHosts} onPick={pickItem} />
                ))}
              </ul>
            </div>
          ) : null}

          {chosenTag !== null ? (
            <div className="min-w-0 flex-1 basis-64">
              <h3 className="text-label font-bold text-ink-quiet">ABOUT THIS WORD</h3>
              <WordFacts index={index} word={chosenTag.name} onPick={pickTag} onAdd={addWord} />
            </div>
          ) : null}
          </div>
        </section>
      </div>
    </div>
    </WordFacets.Provider>
  );
}

/** The page: the map once it has loaded. Its state is the address, so a shared link opens exactly the same search. */
export default function TagStation() {
  const { index, error } = useGraph();
  if (error !== null) return <p className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">{error}</p>;
  if (index === null) {
    return (
      <p role="status" className="text-title font-bold text-ink">
        LOADING THE MAP...
      </p>
    );
  }
  if (index.graph.tags.length === 0) return <p className="text-title text-ink">NO WORDS YET.</p>;
  return <Station index={index} />;
}
