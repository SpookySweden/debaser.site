/**
 * The DEBASER extension's ids in the two stores (Luke, 2026-11-27: "need the extension to be easier to download and update", and "Edge Add-ons
 * store too"). Each store gives an extension its own id when it is published, so the site talks to whichever copy is in: the zip's (its key,
 * `EXTENSION_ID` in own-eye.ts), the Chrome Web Store's or the Edge Add-ons store's. Empty until Luke publishes it and sends the id; filled in,
 * the EXTENSION window offers that store instead of the zip, and the store updates it by itself. An id is public, not a secret.
 * Temp/check-see-extension.cjs holds each to the shape of an id (32 letters a to p) or empty.
 */
export const CHROME_STORE_ID = '';
export const EDGE_STORE_ID = '';

export type ExtensionFrom = 'zip' | 'chrome' | 'edge';

/** Each store's page for it, where it is put in with one press. */
export const STORE_PAGE: Record<'chrome' | 'edge', (id: string) => string> = {
  chrome: (id) => `https://chromewebstore.google.com/detail/${id}`,
  edge: (id) => `https://microsoftedge.microsoft.com/addons/detail/${id}`,
};

export const isExtensionId = (id: string): boolean => /^[a-p]{32}$/.test(id);

/** The store id for this browser, or null while that store has none. */
export function storeIdFor(browser: 'chrome' | 'edge'): string | null {
  const id = browser === 'edge' ? EDGE_STORE_ID : CHROME_STORE_ID;
  return isExtensionId(id) ? id : null;
}
