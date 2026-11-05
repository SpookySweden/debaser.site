'use client';

import { useMemo, useState } from 'react';
import { clearedFilters, suggest, type StationIndex } from '../lib/tag-station/query';
import { hasFilters, listOf, withWordIn, type Near, type Niche, type Recipe, type Strict, type WordSourceFilter } from '../lib/tag-station/recipe';
import type { Facet } from '../lib/tag-station/word-facts';
import { FIELD_TIGHT } from '../lib/ui/controls';
import { PLATFORM_LABELS, type WebItemKind, type WebPlatform } from '../lib/web/types';
import { KeyGroup, presentChoices, STATION_KEY, STATION_KEY_ON, STATION_RING } from './TagStationParts';

type WordList = 'must' | 'any' | 'not';
const LISTS: readonly { list: WordList; label: string; title: string }[] = [
  { list: 'must', label: 'MUST', title: 'MUST HAVE' },
  { list: 'any', label: 'ANY', title: 'ANY OF' },
  { list: 'not', label: 'NOT', title: 'EXCLUDE' },
];

/** A word in the recipe: three keys say which list it's in, and one takes it out. */
function RecipeWord({ recipe, word, onChange }: { recipe: Recipe; word: string; onChange: (next: Recipe) => void }) {
  const current = listOf(recipe, word);
  return (
    <li className="flex flex-wrap items-center gap-1">
      <span className="min-w-0 break-words text-prose text-ink">{word}</span>
      {LISTS.map(({ list, label }) => (
        <button key={list} type="button" aria-pressed={current === list} aria-label={`${word}: ${label}`} onClick={() => onChange(withWordIn(recipe, word, list))} className={current === list ? STATION_KEY_ON : STATION_KEY}>
          {current === list ? label : `[ ${label} ]`}
        </button>
      ))}
      <button type="button" aria-label={`Take ${word} out of the recipe`} onClick={() => onChange(withWordIn(recipe, word, null))} className={STATION_KEY}>
        [ × ]
      </button>
    </li>
  );
}

function YearField({ label, value, onChange }: { label: string; value: number | null; onChange: (year: number | null) => void }) {
  // What's being typed shows until it is a whole year; after that the recipe's own value, so CLEAR and a shared link empty it.
  const [text, setText] = useState('');
  const shown = text.length > 0 && text.length < 4 ? text : value === null ? '' : String(value);
  return (
    <label className="inline-flex items-center gap-1 text-label font-bold text-ink-quiet">
      {label}
      <input
        type="text"
        inputMode="numeric"
        maxLength={4}
        value={shown}
        onChange={(event) => {
          const typed = event.target.value.replace(/[^0-9]/g, '');
          setText(typed);
          if (typed.length === 0) onChange(null);
          else if (typed.length === 4) onChange(Number(typed));
        }}
        className={`${FIELD_TIGHT} min-h-tap w-16`}
      />
    </label>
  );
}

function Pick({ label, value, options, onChange }: { label: string; value: string; options: readonly { value: string; label: string }[]; onChange: (value: string) => void }) {
  return (
    <label className="inline-flex items-center gap-1 text-label font-bold text-ink-quiet">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className={`${FIELD_TIGHT} min-h-tap ${STATION_RING}`}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The recipe (SPEC-tag-station.md): what results must have, may have and must not have, how strict, how obscure, how far out.
 * Every change goes straight into the address. Folded until it's asked for or something is already set.
 */
export default function TagStationFilters({ index, recipe, onChange }: { index: StationIndex; recipe: Recipe; onChange: (next: Recipe) => void }) {
  const [open, setOpen] = useState(hasFilters(recipe));
  const [typed, setTyped] = useState('');
  const offers = useMemo(() => (typed.trim().length === 0 ? [] : suggest(index, typed, { tags: 5, items: 0 }).tags), [index, typed]);
  const { platforms, kinds } = useMemo(() => presentChoices(index), [index]);
  const addWord = (word: string, list: WordList) => {
    setTyped('');
    onChange(withWordIn(recipe, word, list));
  };

  return (
    <section aria-label="Recipe" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)} className={open ? STATION_KEY_ON : STATION_KEY}>
          {open ? 'FILTERS' : '[ FILTERS ]'}
        </button>
        {hasFilters(recipe) ? (
          <button type="button" onClick={() => onChange(clearedFilters(recipe))} className={STATION_KEY}>
            [ CLEAR ]
          </button>
        ) : null}
        <ul aria-label="Words in the recipe" className="flex flex-wrap items-center gap-x-2 text-label text-ink">
          {LISTS.flatMap(({ list, title }) => recipe[list].map((word) => <li key={`${list}:${word}`}>{`${title}: ${word}`}</li>))}
        </ul>
      </div>

      {open ? (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col gap-1">
            {[...recipe.must, ...recipe.any, ...recipe.not].map((word) => (
              <RecipeWord key={word} recipe={recipe} word={word} onChange={onChange} />
            ))}
          </ul>
          <div>
            <label className="flex flex-wrap items-center gap-1 text-label font-bold text-ink-quiet">
              ADD A WORD
              <input type="text" value={typed} autoComplete="off" spellCheck={false} maxLength={40} onChange={(event) => setTyped(event.target.value)} className={`${FIELD_TIGHT} min-h-tap min-w-0 flex-1 basis-40`} />
            </label>
            {offers.length > 0 ? (
              <ul aria-label="Words to add" className="flex flex-col gap-1 pt-1">
                {offers.map((tag) => (
                  <li key={tag.name} className="flex flex-wrap items-center gap-1">
                    <span className="min-w-0 break-words text-prose text-ink">{tag.name}</span>
                    {LISTS.map(({ list, label }) => (
                      <button key={list} type="button" aria-label={`Add ${tag.name}: ${label}`} onClick={() => addWord(tag.name, list)} className={STATION_KEY}>
                        [ {label} ]
                      </button>
                    ))}
                  </li>
                ))}
              </ul>
            ) : typed.trim().length > 0 ? (
              <p className="pt-1 text-label text-ink">NO SUCH WORD.</p>
            ) : null}
          </div>

          <KeyGroup<Strict>
            label="STRICT"
            value={recipe.strict}
            onChange={(strict) => onChange({ ...recipe, strict })}
            options={[
              { value: 'all', label: 'ALL' },
              { value: 'most', label: 'MOST' },
              { value: 'any', label: 'ANY' },
            ]}
          />
          <KeyGroup<Niche>
            label="NICHE"
            value={recipe.niche}
            onChange={(niche) => onChange({ ...recipe, niche })}
            options={[
              { value: 'all', label: 'ALL' },
              { value: 'main', label: 'MAINSTREAM' },
              { value: 'mid', label: 'MIDDLE' },
              { value: 'rare', label: 'OBSCURE' },
            ]}
          />
          <KeyGroup<Near>
            label="HOW FAR"
            value={recipe.near}
            onChange={(near) => onChange({ ...recipe, near })}
            options={[
              { value: 'near', label: 'NEAR' },
              { value: 'wider', label: 'WIDER' },
              { value: 'far', label: 'FAR' },
            ]}
          />
          <KeyGroup<WordSourceFilter>
            label="WORDS FROM"
            value={recipe.src}
            onChange={(src) => onChange({ ...recipe, src })}
            options={[
              { value: 'both', label: 'BOTH' },
              { value: 'claude', label: 'CLAUDE' },
              { value: 'platform', label: 'PLATFORM' },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Pick
              label="ERA"
              value={recipe.era ?? ''}
              onChange={(era) => onChange({ ...recipe, era: era === '' ? null : era })}
              options={[{ value: '', label: 'ANY' }, ...index.eras.map((era) => ({ value: era, label: era.toUpperCase() }))]}
            />
            {/* Only once the word pass has said something. */}
            {index.facets.length > 0 ? (
              <Pick
                label="WORD TYPE"
                value={recipe.facet ?? ''}
                onChange={(facet) => onChange({ ...recipe, facet: facet === '' ? null : (facet as Facet) })}
                options={[{ value: '', label: 'ANY' }, ...index.facets.map((facet) => ({ value: facet, label: facet.toUpperCase() }))]}
              />
            ) : null}
            <Pick
              label="TYPE"
              value={recipe.kind ?? ''}
              onChange={(kind) => onChange({ ...recipe, kind: kind === '' ? null : (kind as WebItemKind) })}
              options={[{ value: '', label: 'ANY' }, ...kinds.map((kind) => ({ value: kind, label: kind.toUpperCase() }))]}
            />
            <Pick
              label="SOURCE"
              value={recipe.site ?? ''}
              onChange={(site) => onChange({ ...recipe, site: site === '' ? null : (site as WebPlatform) })}
              options={[{ value: '', label: 'ANY' }, ...platforms.map((platform) => ({ value: platform, label: PLATFORM_LABELS[platform] }))]}
            />
            <YearField label="FROM" value={recipe.from} onChange={(from) => onChange({ ...recipe, from })} />
            <YearField label="TO" value={recipe.to} onChange={(to) => onChange({ ...recipe, to })} />
          </div>
        </div>
      ) : null}
    </section>
  );
}
