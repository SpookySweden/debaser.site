/**
 * The whole site fullscreen (Luke, 2026-11-23: "The site itself should have a full screen button in the top right, which you can exit
 * with f11 or escape or by pressing the button again").
 *
 * The site's own fullscreen is the page's root element, so everything on it stays where it was. A picture inside it (a room, a video,
 * the remote view) can go fullscreen on top of that and come back to it: so whoever asks "is a picture fullscreen" asks
 * `fullscreenBox`, which the site itself never counts as.
 */

/** What is fullscreen on its own: a picture, a room. Null when nothing is, or when it is only the whole site. */
export function fullscreenBox(): Element | null {
  const full = document.fullscreenElement;
  return full === document.documentElement ? null : full;
}

export function siteIsFullscreen(): boolean {
  return document.fullscreenElement === document.documentElement;
}

/** The server never knows; a browser that has no fullscreen (an iPhone) has no key. */
export function siteCanFullscreen(): boolean {
  return document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === 'function';
}

export function toggleSiteFullscreen(): void {
  const going = siteIsFullscreen() ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  going.catch(() => {
    /* refused by the browser: the key stays as it was */
  });
}

/**
 * Esc leaves it by itself. F11 is the browser's own key: where it hands the press to the page, it leaves the site's fullscreen
 * instead of putting the browser's on top of it.
 */
export function subscribeToSiteFullscreen(changed: () => void): () => void {
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'F11' || !siteIsFullscreen()) return;
    event.preventDefault();
    toggleSiteFullscreen();
  };
  document.addEventListener('fullscreenchange', changed);
  document.addEventListener('keydown', onKey);
  return () => {
    document.removeEventListener('fullscreenchange', changed);
    document.removeEventListener('keydown', onKey);
  };
}
