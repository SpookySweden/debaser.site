'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadStationIndex } from '../lib/tag-station/client';
import { digLine, useMoreItems, type PoolAsk } from '../lib/tag-station/more';
import { discoverList, POOL_TARGET, poolReady, recommendedList, type PickSort } from '../lib/tag-station/picks';
import { getPresetStore, withPreset, type Preset } from '../lib/tag-station/presets';
import type { StationIndex } from '../lib/tag-station/query';
import { EMPTY_RECIPE, type Recipe } from '../lib/tag-station/recipe';
import { keepShownFirst } from '../lib/tag-station/title-quality';
import type { StationItem } from '../lib/tag-station/types';
import { ANON_PERSON, getRecommendationStore, RECOMMEND_NOTE, type RecommendedPick } from '../lib/web/recommendations';
import { readTaste } from '../lib/web/taste-store';
import type { WebItem } from '../lib/web/types';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import InfoFold from './InfoFold';
import ProfileAvatarLink from './ProfileAvatarLink';
import ProfileName from './ProfileName';
import { STATION_KEY } from './TagStationParts';
import { FindInMedia } from './TagStationParts';

const STEP = 25;

/** Someone who recommended a row: their picture, their name, their status line. Their lamp only follows their own switch, as everywhere. */
function PersonBeside({ person }: { person: { id: string; name: string } }) {
  // A visitor is told no one's name (recommendations.ts `ANON_PERSON`): a plain ANON, with no picture or profile to open.
  if (person.id.startsWith(ANON_PERSON)) {
    return (
      <span className="text-label font-bold text-ink-quiet" data-recommended-by="anon">
        ANON
      </span>
    );
  }
  return <NamedPerson person={person} />;
}

function NamedPerson({ person }: { person: { id: string; name: string } }) {
  const { profile } = usePublicProfile(person.id);
  const status = profile.status.trim();
  const author = { id: person.id, displayName: person.name };
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-label text-ink" data-recommended-by={person.id}>
      <ProfileAvatarLink author={author} size={20} showName={false} variant="plain" className="shrink-0" />
      <ProfileName author={author} />
      {status.length > 0 ? <span className="min-w-0 truncate text-ink-quiet">{status}</span> : null}
    </span>
  );
}

/** A film or show has no player here: its name, its source, and MEDIA's own search to find one. */
export function NoPlayerRow({ item }: { item: StationItem }) {
  return (
    <li className="rule-pixel py-2">
      <p className="break-words text-sm font-bold text-ink">{item.title}</p>
      <p className="break-words text-label text-ink">
        {item.kind.toUpperCase()}
        {Number.isFinite(Date.parse(item.publishedAt)) ? ` · ${item.publishedAt.slice(0, 4)}` : ''}
        {item.creator ? ` · ${item.creator}` : ''}
      </p>
      <FindInMedia item={item} />
    </li>
  );
}

/**
 * MEDIA's RECOMMENDED and DISCOVER filters (SPEC-discover.md). Each stays blank, with a line showing how far along the pool is, until 10,000 items are
 * tagged: never a fake list. Words and scores only order the list and are never shown here.
 */
export default function WebPickedList({ list, sort, renderRow }: { list: 'recommended' | 'discover'; sort: PickSort; renderRow: (item: WebItem) => ReactNode }) {
  const [loaded, setIndex] = useState<StationIndex | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [picks, setPicks] = useState<readonly RecommendedPick[]>([]);
  const [recipe, setRecipe] = useState<Recipe>(EMPTY_RECIPE);
  const [shown, setShown] = useState(STEP);
  // Fixed for this visit, so a list doesn't shuffle under the reader while they look at it.
  const [{ taste, now }] = useState(() => ({ taste: readTaste(), now: Date.now() }));

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [map, feed, presets] = await Promise.all([loadStationIndex(), getRecommendationStore().feed(300).catch((): RecommendedPick[] => []), getPresetStore().list().catch((): Preset[] => [])]);
        if (!live) return;
        setIndex(map);
        setPicks(feed);
        const active = presets.find((one) => one.active);
        if (active) setRecipe(withPreset(EMPTY_RECIPE, active.settings));
      } catch (problem) {
        if (live) setFault(problem instanceof Error ? problem.message : 'That list could not be loaded.');
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // What the preset's words or the reader's own taste find in the pool's files, or else whatever the files hold, so the list isn't limited to what's on the map.
  const ask = useMemo((): PoolAsk | null => {
    if (loaded === null || !poolReady(loaded)) return null;
    const own = Object.entries(taste.tags).sort(([, a], [, b]) => b - a).map(([word]) => word);
    const wanted = list === 'discover' && recipe.must.length + recipe.any.length > 0 ? [...recipe.must, ...recipe.any] : own;
    return wanted.length > 0 ? { words: wanted.slice(0, 12) } : { browse: true };
  }, [loaded, list, recipe, taste]);
  const digging = useMoreItems(loaded, ask);
  const { index } = digging;

  const computed = useMemo(() => {
    if (index === null || !poolReady(index)) return [];
    return list === 'recommended' ? recommendedList(index, picks, taste, sort, now) : discoverList(index, recipe, taste, sort, now).map((item) => ({ item, people: [] as { id: string; name: string }[] }));
  }, [index, list, picks, recipe, taste, sort, now]);
  // What's on the screen stays put when more arrives. A new list or SORT starts again.
  const order = `${list}|${sort}`;
  const [pinned, setPinned] = useState<{ order: string; ids: readonly string[] }>({ order, ids: [] });
  const rows = useMemo(
    () => keepShownFirst(pinned.order === order ? pinned.ids : [], computed.map((row) => ({ ...row, id: row.item.id }))),
    [pinned, order, computed],
  );

  if (fault !== null) return <p className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">{fault}</p>;
  if (index === null || digging.loading) {
    return (
      <p role="status" className="py-2 text-title font-bold text-ink">
        LOADING...
      </p>
    );
  }
  if (!poolReady(index)) {
    const tagged = index.graph.tagged ?? 0;
    return (
      <p role="status" className="py-2 text-title font-bold text-ink" data-pool-progress>
        NOT YET: {tagged.toLocaleString('en-GB')} OF {POOL_TARGET.toLocaleString('en-GB')} ITEMS TAGGED.
      </p>
    );
  }
  if (rows.length === 0) return <p className="py-2 text-title font-bold text-ink">NOTHING HERE.</p>;

  return (
    <div>
      {list === 'recommended' ? <InfoFold topic="Recommended">{RECOMMEND_NOTE}</InfoFold> : null}
      <ul aria-label={list === 'recommended' ? 'Recommended' : 'Discover'}>
        {rows.slice(0, shown).map(({ item, people }) => (
          <li key={item.id} className="list-none">
            {people.length > 0 ? (
              <ul aria-label={`Recommended by ${people.map((one) => one.name).join(', ')}`} className="flex flex-wrap items-center gap-2 pt-2">
                {people.slice(0, 6).map((person) => (
                  <li key={person.id}>
                    <PersonBeside person={person} />
                  </li>
                ))}
              </ul>
            ) : null}
            {item.seenOnly ? <ul><NoPlayerRow item={item} /></ul> : <ul>{renderRow({ ...item, tags: item.words.map((word) => word.word) })}</ul>}
          </li>
        ))}
      </ul>
      {rows.length > shown || digging.more ? (
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            disabled={digging.digging}
            onClick={() => {
              // These rows and the ones this press brings into view: what arrives from the files comes after them.
              setPinned({ order, ids: rows.slice(0, shown + STEP).map((row) => row.id) });
              setShown(shown + STEP);
              // Before the list runs out: a press never shows nothing while the next files are read.
              if (rows.length < shown + 2 * STEP) digging.dig();
            }}
            className={STATION_KEY}
          >
            {digging.digging ? '[ DIGGING... ]' : '[ MORE ]'}
          </button>
          <span className="text-label text-ink-quiet" data-dig-line>
            {digLine(digging.answer)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
