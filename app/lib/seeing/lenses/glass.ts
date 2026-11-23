import type { Lens } from './lens';

/** GLASS (xv): the page's background clear, so FLUID, SAND or the sea shows behind; each line of words keeps a solid strip of the window's colour. */
export const glass: Lens = {
  id: 'glass',
  form: 'page',
  beside: null,
  clear: true,
  css({ tokens }) {
    return [
      '*,*::before,*::after{background-color:transparent!important;box-shadow:none!important;text-shadow:none!important}*:not(img){background-image:none!important}',
      `see-strip{background-color:${tokens.paper}!important;color:${tokens.ink}!important;-webkit-box-decoration-break:clone;box-decoration-break:clone;padding:.05em .25em}`,
      `a see-strip{color:${tokens['accent-ink']}!important}`,
      `input,textarea,select,button{background-color:${tokens.paper}!important;color:${tokens.ink}!important;border-color:${tokens.ink}!important}`,
    ].join('\n');
  },
  tools: () => ({ strips: true }),
};
