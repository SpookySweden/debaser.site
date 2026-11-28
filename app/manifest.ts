import type { MetadataRoute } from 'next';
import { FALLBACK_THEME } from './lib/ui/themes';

/**
 * What lets a browser install the site as an app, in its own window (Luke, 2026-11-28: "Yes, yellow text icon").
 * No service worker on purpose: nothing is kept offline, so an installed copy is always the live site.
 * The icons are words, made by `scripts/make-text-icon.cjs` (swap the files in `public/` for a drawing later).
 */
export default function manifest(): MetadataRoute.Manifest {
  // The theme a first visit wears: one manifest for everybody, so it can't follow a reader's choice.
  const ground = FALLBACK_THEME.tokens.desktop;
  return {
    id: '/',
    name: 'DEBASER.SITE',
    short_name: 'DEBASER',
    description:
      "An archive of comic book lore and concept art, run like a Web 1.0 desktop: a board, an account directory, comms and the debaser project's shelves.",
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: ground,
    theme_color: ground,
    icons: [
      { src: '/app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/app-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
