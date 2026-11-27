'use client';

import { useState } from 'react';
import { BLOCKS, PALETTES, PAPERS, recipeFrom, recipeText, TEXT_SIZES, type BlockId, type LensSettings, type Palette, type TextSize } from '../../lib/seeing/lenses/lens';
import { LENS_NAMES, type LensId } from '../../lib/seeing/lenses/names';
import { lensById } from '../../lib/seeing/lenses/registry';
import { FIELD_TIGHT, PLATE, PLATE_PRESSED } from '../../lib/ui/controls';
import { explain } from '../../lib/ui/explain';

type Props = { lens: LensId; settings: LensSettings; onSettings: (settings: LensSettings) => void; onLens: (lens: LensId) => void };

/** What each lens key says while EXPLAIN is on. */
const LENS_WORDS: Record<LensId, { what: string; why: string }> = {
  standard: { what: 'Shows the page as its makers sent it, wearing nothing of your theme.', why: 'The plain page, to come back to after any other lens.' },
  reader: { what: 'Shows only the main words and pictures, in reading order, on a paper and size you choose.', why: 'For reading a long page without menus, adverts and clutter.' },
  watchers: { what: 'Shows the page as it was sent, with the outside companies that were on it listed beside it, and what was refused.', why: 'To see who else is on a page: facts about the page, never about people. Only through the house\'s eye.' },
  xray: { what: 'Outlines the parts of the page by kind and lists what the page is made of beside it.', why: 'To see how a page is built; rest on a part to name it.' },
  lowfi: { what: 'Shows the page as if on an old screen: a few colours, blocky pictures and scanlines.', why: 'For fun, or a calmer page; pick the colours under the lens keys.' },
  dye: { what: 'Moves every colour on the page to the nearest colour of your theme, pictures included.', why: 'To read any site in the colours of your own DEBASER theme.' },
  glass: { what: 'Makes the page\'s background clear, so your moving background shows through behind the words.', why: 'For the look of it; each line of words keeps a solid strip so it stays readable. Only through the house\'s eye.' },
  custom: { what: 'Your own lens, made from the building blocks shown under the lens keys.', why: 'Mix the blocks you want, then copy the recipe to send to somebody. Only through the house\'s eye.' },
};
const BLOCK_WORDS: Record<BlockId, string> = {
  words: 'Leaves only the words of the page.',
  pictures: 'Leaves only the pictures of the page.',
  links: 'Leaves only the links of the page.',
  invert: 'Turns light colours dark and dark ones light.',
  mono: 'Takes all colour out of the page, leaving greys.',
  contrast: 'Makes the page much stronger in contrast, for easier reading.',
  recolour: 'Sets the page in your theme\'s colours.',
  nomenus: 'Hides the page\'s menus and navigation bars.',
  noforms: 'Hides the page\'s forms and boxes to type in.',
  large: 'Makes the words of the page larger.',
};
const PALETTE_WORDS: Record<Palette, string> = {
  theme: 'your theme\'s own colours',
  mono: 'black and white with greys',
  terminal: 'an old green terminal\'s colours',
  amber: 'an old amber screen\'s colours',
  '1-bit': 'two colours only, like the first computers',
};

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
    <div className="contents" data-seeing-lenses>
      <span className="flex flex-wrap items-center gap-1" role="group" aria-label="Lens">
        {LENS_NAMES.map(({ id, label }) => {
          const built = lensById(id) !== null;
          return (
            <button key={id} type="button" aria-pressed={lens === id} disabled={!built} title={built ? undefined : 'Not built yet'} onClick={() => onLens(id)} className={on(lens === id)} {...explain(LENS_WORDS[id].what, LENS_WORDS[id].why, 'A LENS CHANGES HOW THE PAGE LOOKS HERE, NEVER THE PAGE ITSELF.')}>
              [ {label} ]
            </button>
          );
        })}
      </span>
      {lens === 'reader' ? (
        <span className="flex flex-wrap items-center gap-1" role="group" aria-label="Reader">
          {PAPERS.map((paper) => (
            <button key={paper} type="button" aria-pressed={reader.paper === paper} aria-label={`Paper: ${paper}`} onClick={() => onSettings({ ...settings, reader: { ...reader, paper } })} className={on(reader.paper === paper)} {...explain(paper === 'theme' ? 'Sets READER on your theme\'s own paper and ink.' : `Sets READER on the book reader's ${paper} paper.`, 'Pick the paper that is easiest on your eyes.')}>
              [ {paper.toUpperCase()} ]
            </button>
          ))}
          <button type="button" aria-label="Smaller words" disabled={sizeBy(-1) === undefined} onClick={() => toSize(sizeBy(-1))} className={PLATE} {...explain('Makes READER\'s words a step smaller.', 'Six sizes; your choice is remembered.')}>
            [ A− ]
          </button>
          <button type="button" aria-label="Larger words" disabled={sizeBy(1) === undefined} onClick={() => toSize(sizeBy(1))} className={PLATE} {...explain('Makes READER\'s words a step larger.', 'Six sizes; your choice is remembered.')}>
            [ A+ ]
          </button>
        </span>
      ) : null}
      {lens === 'lowfi' ? (
        <span className="flex flex-wrap items-center gap-1" role="group" aria-label="Palette">
          {PALETTES.map((each) => (
            <button key={each} type="button" aria-pressed={palette === each} onClick={() => onSettings({ ...settings, palette: each })} className={on(palette === each)} {...explain(`Sets LOW-FI in ${PALETTE_WORDS[each]}.`, 'LOW-FI paints the page in a few colours, like an old screen.')}>
              [ {each === 'theme' ? 'YOURS' : each.toUpperCase()} ]
            </button>
          ))}
        </span>
      ) : null}
      {lens === 'custom' ? (
        <span className="flex flex-wrap items-center gap-1" role="group" aria-label="Recipe">
          {BLOCKS.map(({ id, label }) => (
            <button key={id} type="button" aria-pressed={recipe.includes(id)} onClick={() => onSettings({ ...settings, recipe: recipe.includes(id) ? recipe.filter((each) => each !== id) : BLOCKS.map((block) => block.id).filter((each) => each === id || recipe.includes(each)) })} className={on(recipe.includes(id))} {...explain(`${BLOCK_WORDS[id]} Press to put it in your recipe or take it out.`, 'CUSTOM wears every block that is pressed in, all at once.')}>
              [ {label} ]
            </button>
          ))}
          <button type="button" title="Copy the recipe, to send to somebody" onClick={() => void navigator.clipboard?.writeText(recipeText(recipe)).catch(() => undefined)} className={PLATE} {...explain('Copies your CUSTOM recipe as a short line of words.', 'Send it to somebody, who pastes it with PASTE RECIPE to wear the same lens.')}>
            [ COPY RECIPE ]
          </button>
          <button type="button" aria-expanded={pasting !== null} onClick={() => setPasting(pasting === null ? '' : null)} className={PLATE} {...explain('Opens a box to paste a recipe somebody sent you.', 'A recipe is the line COPY RECIPE makes; pasting one sets CUSTOM to it.')}>
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
              <button type="submit" disabled={recipeFrom(pasting) === null} className={PLATE} {...explain('Sets CUSTOM to the recipe pasted in the box.', 'It only works once the box holds a recipe it can read.')}>
                [ USE ]
              </button>
            </form>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
