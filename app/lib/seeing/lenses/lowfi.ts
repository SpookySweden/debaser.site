import { DYES, type ThemeTokens } from '../../ui/themes';
import type { Lens, Palette } from './lens';

export type LowFiColours = { paper: string; ink: string; link: string };

export function lowFiColours(tokens: ThemeTokens, palette: Palette): LowFiColours {
  switch (palette) {
    case 'theme':
      return { paper: tokens.paper, ink: tokens.ink, link: tokens['accent-ink'] };
    case 'mono':
      return { paper: tokens.paper, ink: tokens.ink, link: tokens.ink };
    case 'terminal':
      return { paper: DYES.black, ink: DYES.emerald, link: DYES.emerald };
    case 'amber':
      return { paper: DYES.black, ink: DYES.amber, link: DYES.amber };
    case '1-bit':
      return { paper: DYES.white, ink: DYES.black, link: DYES.black };
  }
}

/** 03 LOW-FI: a page on an old screen: a palette of a few dyes, blocky pictures, scanlines that step and stop under reduced motion. */
export const lowfi: Lens = {
  id: 'lowfi',
  form: 'page',
  beside: null,
  css({ tokens, settings, face }) {
    const { paper, ink, link } = lowFiColours(tokens, settings.palette);
    return [
      `*,*::before,*::after{background-color:transparent!important;color:${ink}!important;border-color:${ink}!important;border-radius:0!important;box-shadow:none!important;text-shadow:none!important;font-family:${face}!important;transition:none!important}`,
      `*:not(img){background-image:none!important}html,body,dialog,[role=dialog],[popover]{background-color:${paper}!important}`,
      `a,a *{color:${link}!important;text-decoration:underline!important}`,
      `svg *{fill:${ink}!important;stroke:none!important}img,video,canvas{image-rendering:pixelated!important}`,
      `html::after{content:"";position:fixed;inset:0;pointer-events:none;z-index:2147483647;background:repeating-linear-gradient(to bottom,color-mix(in srgb,${paper} 22%,transparent) 0 1px,transparent 1px 3px)!important}`,
      '@media (prefers-reduced-motion:no-preference){html::after{animation:see-lines 1.6s steps(3,end) infinite}@keyframes see-lines{0%{transform:translateY(0)}100%{transform:translateY(3px)}}}',
    ].join('\n');
  },
  tools({ tokens, settings }) {
    const { paper, ink, link } = lowFiColours(tokens, settings.palette);
    return { pictures: { dyes: [...new Set([paper, ink, link])], most: 160 } };
  },
};
