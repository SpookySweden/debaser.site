import type { Lens } from './lens';

/** 01 STANDARD: the page as its makers sent it. It wears nothing of the theme. */
export const standard: Lens = { id: 'standard', form: 'page', beside: null, css: () => '' };
