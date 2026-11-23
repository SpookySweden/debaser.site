import type { Lens } from './lens';

/** 04 X-RAY: outlines by kind in the theme's accent inks, and beside the page what is pointed at and what the page is made of. */
export const xray: Lens = {
  id: 'xray',
  form: 'page',
  beside: 'xray',
  css({ tokens }) {
    const line = (what: string, colour: string, style = 'solid') => `${what}{outline:1px ${style} ${colour}!important;outline-offset:-1px!important}`;
    return [
      line('p,h1,h2,h3,h4,h5,h6,li,td,th,dt,dd,blockquote,figcaption,pre', tokens['queue-next-ink'], 'dotted'),
      line('a[href]', tokens['queue-now-ink']),
      line('img,picture,svg,canvas,video', tokens.bubble),
      line('[data-see-frame],[data-see-ad]', tokens['queue-played-ink'], 'dashed'),
      line('form,input,button,select,textarea', tokens.acid, 'dashed'),
      `[data-see-pointed]{outline:3px solid ${tokens.bubble}!important;outline-offset:-3px!important}`,
    ].join('\n');
  },
  tools: () => ({ xray: true }),
};
