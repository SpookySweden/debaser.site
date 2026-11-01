import type { FetchLike } from '../safe-fetch';
import type { WebItem, WebPlatform, WebSource } from '../types';

/** What an adapter is handed, so a check can run it offline with a fake fetch and a fixed clock. */
export type WebAdapterDeps = {
  fetch?: FetchLike;
  now?: () => Date;
};

/**
 * One platform's reader. Server-side only (it fetches through `safe-fetch`).
 *
 * `allowedHosts` is the whole list of hosts the adapter may request from *and* may put in an item's
 * `url`, `canonicalUrl` and `embedUrl`. `linkHosts` adds hosts an item may link to without being
 * fetched (a licence page, say). The UI shows an outbound link only when it passes this list again.
 */
export type WebAdapter = {
  platform: WebPlatform;
  allowedHosts: readonly string[];
  linkHosts: readonly string[];
  fetchItems(source: WebSource, deps?: WebAdapterDeps): Promise<WebItem[]>;
};
