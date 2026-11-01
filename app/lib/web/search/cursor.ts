import type { WebPlatform } from '../types';
import type { ProviderPage } from './types';

/**
 * The cursor LOAD MORE sends back: each provider's own next page, base64url-encoded JSON, opaque to the page.
 * A provider missing from it has no more results. Decoding accepts exactly what encoding writes - known
 * platforms, small integers or short page tokens - so a cursor can never carry anything else to a platform.
 */

export type SearchCursor = Partial<Record<WebPlatform, ProviderPage>>;

const MAX_CURSOR_LENGTH = 1500;
/** Short page tokens, or YouTube's InnerTube `it_<token>` (about 600 characters, with %3D padding). */
const TOKEN = /^(?:[A-Za-z0-9_-]{1,120}|it_[A-Za-z0-9_%=-]{20,800})$/;
const MAX_NUMBER = 100_000;

function toBase64Url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}

function fromBase64Url(text: string): string {
  return Buffer.from(text, 'base64url').toString('utf8');
}

export function isProviderPage(value: unknown): value is ProviderPage {
  return (
    (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_NUMBER) ||
    (typeof value === 'string' && TOKEN.test(value))
  );
}

/** Null when no provider has more. */
export function encodeSearchCursor(cursor: SearchCursor): string | null {
  const entries = Object.entries(cursor).filter(([, page]) => isProviderPage(page));
  return entries.length === 0 ? null : toBase64Url(JSON.stringify(Object.fromEntries(entries)));
}

/** The cursor, or null when it is not one this module made. */
export function decodeSearchCursor(value: unknown, platforms: readonly WebPlatform[]): SearchCursor | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(value));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const cursor: SearchCursor = {};
  for (const [key, page] of Object.entries(parsed as Record<string, unknown>)) {
    if (!platforms.includes(key as WebPlatform) || !isProviderPage(page)) return null;
    cursor[key as WebPlatform] = page;
  }
  return Object.keys(cursor).length > 0 ? cursor : null;
}
