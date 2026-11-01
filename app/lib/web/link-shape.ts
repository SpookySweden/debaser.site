/**
 * Whether what someone typed in the /web search box is a pasted address rather than words (SPEC-web-search.md,
 * paste-a-link). Pure and client-safe: the page uses it to send a link to the server in either scope; the
 * server (`app/lib/web/search/link.ts`) decides what, if anything, the link is.
 */

/** Long enough for a real address with its tracking parameters; the server cuts nothing, it refuses. */
export const MAX_LINK_LENGTH = 600;

export function looksLikeLink(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const text = raw.trim();
  return text.length > 0 && text.length <= MAX_LINK_LENGTH && !/\s/.test(text) && /^(https?:\/\/|www\.|m\.|youtu\.be\/|vimeo\.com\/|archive\.org\/|commons\.wikimedia\.org\/)/i.test(text);
}
