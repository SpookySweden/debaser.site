/**
 * Whether the site's own fullscreen can work in this browser: one that can fullscreen any box. An iPhone's cannot (it only
 * fullscreens a video, its own way), so there another site's player keeps its own fullscreen key: it is the only one that works.
 *
 * In a file of its own, with nothing else in it, so the room's Twitch and Vimeo players can ask without importing the floating
 * player's store (./floating-player.ts re-exports it): that import made the production build meet a component that was not
 * there yet on the root layout (2026-11-16).
 */
export function siteFullscreenWorks(): boolean {
  return typeof document !== 'undefined' && document.fullscreenEnabled === true;
}
