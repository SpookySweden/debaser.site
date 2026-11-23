import { DYES } from '../../ui/themes';
import type { BlockId, Lens, LensLook } from './lens';

const PICTURES = 'img,picture,svg,canvas,video';

/** Each block as a stylesheet. Filters are gathered, since a page has one. */
const SHEETS: Record<BlockId, (look: LensLook) => string> = {
  words: () => `${PICTURES},[data-see-ad]{display:none!important}*{background-image:none!important}`,
  pictures: () => `body :not(${PICTURES}):not(:has(${PICTURES})):not(:is(${PICTURES}) *){display:none!important}body *{font-size:0!important}`,
  links: () => 'body :not(a):not(a *):not(:has(a)){display:none!important}',
  invert: () => '',
  mono: () => '',
  contrast: () => `*{color:${DYES.white}!important;background-color:${DYES.black}!important;border-color:${DYES.white}!important}a,a *{color:${DYES.daffodil}!important}`,
  recolour: ({ tokens }) => `*{color:${tokens.ink}!important;background-color:${tokens.paper}!important;border-color:${tokens.ink}!important}a,a *{color:${tokens['accent-ink']}!important}`,
  nomenus: () => 'nav,header,footer,aside,[role=navigation],[role=banner],[role=contentinfo],[role=complementary]{display:none!important}',
  noforms: () => 'form,input,button,select,textarea{display:none!important}',
  large: () => 'html{zoom:1.35}',
};

/** 05 CUSTOM: your own recipe, from the building blocks in `lens.ts`. */
export const custom: Lens = {
  id: 'custom',
  form: 'page',
  beside: null,
  css(look) {
    const { recipe } = look.settings;
    const filters = [recipe.includes('invert') ? 'invert(1) hue-rotate(180deg)' : '', recipe.includes('mono') ? 'grayscale(1)' : ''].filter(Boolean).join(' ');
    return [
      ...recipe.map((id) => SHEETS[id](look)),
      filters === '' ? '' : `html{filter:${filters}}`,
      // Turned back over, so a photograph is not a negative.
      recipe.includes('invert') ? 'img,video{filter:invert(1) hue-rotate(180deg)}' : '',
    ].join('\n');
  },
};
