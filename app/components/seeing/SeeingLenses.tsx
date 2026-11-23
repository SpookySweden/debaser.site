'use client';

import { useState } from 'react';
import { BLOCKS, PALETTES, PAPERS, recipeFrom, recipeText, TEXT_SIZES, type LensSettings, type TextSize } from '../../lib/seeing/lenses/lens';
import { LENS_NAMES, type LensId } from '../../lib/seeing/lenses/names';
import { lensById } from '../../lib/seeing/lenses/registry';
import { FIELD_TIGHT, PLATE, PLATE_PRESSED } from '../../lib/ui/controls';

type Props = { lens: LensId; settings: LensSettings; onSettings: (settings: LensSettings) => void; onLens: (lens: LensId) => void };

const on = (pressed: boolean): string => (pressed ? `${PLATE_PRESSED} cursor-pointer` : PLATE);

/** The lens keys, and the settings of the one in front. */
export default function SeeingLenses({ lens, settings, onSettings, onLens }: Props) {
  const { reader, palette, recipe } = settings;
  const [pasting, setPasting] = useState<string | null>(null);
  const sizeBy = (by: -1 | 1) => TEXT_SIZES.find((size) => size === reader.size + by);
  const toSize = (size: TextSize | undefined) => {
    if (size !== undefined) onSettings({ ...settings, reader: { ...reader, size } });
  };
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 pt-1" data-seeing-lenses>
      <span className="flex flex-wrap items-center gap-1" role="group" aria-label="Lens">
        {LENS_NAMES.map(({ id, label }) => {
          const built = lensById(id) !== null;
          return (
            <button key={id} type="button" aria-pressed={lens === id} disabled={!built} title={built ? undefined : 'Not built yet'} onClick={() => onLens(id)} className={on(lens === id)}>
              [ {label} ]
            </button>
          );
        })}
      </span>
      {lens === 'reader' ? (
        <span className="flex flex-wrap items-center gap-1" role="group" aria-label="Reader">
          {PAPERS.map((paper) => (
            <button key={paper} type="button" aria-pressed={reader.paper === paper} aria-label={`Paper: ${paper}`} onClick={() => onSettings({ ...settings, reader: { ...reader, paper } })} className={on(reader.paper === paper)}>
              [ {paper.toUpperCase()} ]
            </button>
          ))}
          <button type="button" aria-label="Smaller words" disabled={sizeBy(-1) === undefined} onClick={() => toSize(sizeBy(-1))} className={PLATE}>
            [ A− ]
          </button>
          <button type="button" aria-label="Larger words" disabled={sizeBy(1) === undefined} onClick={() => toSize(sizeBy(1))} className={PLATE}>
            [ A+ ]
          </button>
        </span>
      ) : null}
      {lens === 'lowfi' ? (
        <span className="flex flex-wrap items-center gap-1" role="group" aria-label="Palette">
          {PALETTES.map((each) => (
            <button key={each} type="button" aria-pressed={palette === each} onClick={() => onSettings({ ...settings, palette: each })} className={on(palette === each)}>
              [ {each === 'theme' ? 'YOURS' : each.toUpperCase()} ]
            </button>
          ))}
        </span>
      ) : null}
      {lens === 'custom' ? (
        <span className="flex flex-wrap items-center gap-1" role="group" aria-label="Recipe">
          {BLOCKS.map(({ id, label }) => (
            <button key={id} type="button" aria-pressed={recipe.includes(id)} onClick={() => onSettings({ ...settings, recipe: recipe.includes(id) ? recipe.filter((each) => each !== id) : BLOCKS.map((block) => block.id).filter((each) => each === id || recipe.includes(each)) })} className={on(recipe.includes(id))}>
              [ {label} ]
            </button>
          ))}
          <button type="button" title="Copy the recipe, to send to somebody" onClick={() => void navigator.clipboard?.writeText(recipeText(recipe)).catch(() => undefined)} className={PLATE}>
            [ COPY RECIPE ]
          </button>
          <button type="button" aria-expanded={pasting !== null} onClick={() => setPasting(pasting === null ? '' : null)} className={PLATE}>
            [ PASTE RECIPE ]
          </button>
          {pasting !== null ? (
            <form
              className="flex items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                const read = recipeFrom(pasting);
                if (read === null) return;
                onSettings({ ...settings, recipe: read });
                setPasting(null);
              }}
            >
              <input value={pasting} onChange={(event) => setPasting(event.target.value)} aria-label="Recipe" placeholder="SEE:words+recolour" maxLength={220} spellCheck={false} className={FIELD_TIGHT} />
              <button type="submit" disabled={recipeFrom(pasting) === null} className={PLATE}>
                [ USE ]
              </button>
            </form>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
