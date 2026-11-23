import type { ThemeTokens } from '../../ui/themes';
import type { Lens } from './lens';

/** The theme's own dyes: the few its windows, words and keys are made of. */
export function themeDyes(tokens: ThemeTokens): string[] {
  return [...new Set([tokens.paper, tokens.ink, tokens['sun-pale'], tokens['accent-ink'], tokens['ink-quiet'], tokens.sun, tokens.ena, tokens['ena-deep'], tokens.bubble, tokens['bubble-pale'], tokens.acid, tokens.pointed, tokens['ink-plate'], tokens['ink-bar']])];
}

/** THEME DYE (xiv): every colour on the page moved to the nearest of your theme's dyes, light and dark kept apart; pictures dithered to them. */
export const dye: Lens = {
  id: 'dye',
  form: 'page',
  beside: null,
  css: () => '',
  tools({ tokens }) {
    const dyes = themeDyes(tokens);
    return { dye: { dyes, paper: tokens.paper }, pictures: { dyes, most: 480 } };
  },
};
