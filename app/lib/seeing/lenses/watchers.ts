import type { Lens } from './lens';

/** WATCHERS: the page as it was sent, with who was on it listed beside it. Facts about the page, never about people. */
export const watchers: Lens = { id: 'watchers', form: 'page', beside: 'watchers', css: () => '' };
