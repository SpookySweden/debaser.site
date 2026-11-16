/**
 * URL rules WEB shares between the server (safe-fetch, adapters) and the page (which re-checks every
 * link, thumbnail and player address before it draws one). Pure functions; no fetching here, so a
 * browser file may import this one.
 */

/** An identifier safe to put in a URL path or query: starts alphanumeric, then [A-Za-z0-9._-]. */
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isSafeIdentifier(value: unknown, maxLength = 200): value is string {
  return typeof value === 'string' && value.length <= maxLength && IDENTIFIER.test(value);
}

/** True for an https URL whose host is exactly one of `allowedHosts`. */
export function isAllowedUrl(value: unknown, allowedHosts: readonly string[]): value is string {
  if (typeof value !== 'string') return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.port === '' &&
    allowedHosts.includes(url.hostname.toLowerCase())
  );
}

/**
 * An https URL on an allow-listed host, built from fixed path segments and validated identifiers.
 * Path segments are percent-encoded; query values go through URLSearchParams.
 */
export function buildUrl(
  host: string,
  pathSegments: readonly string[],
  query: readonly (readonly [string, string])[] = [],
): string {
  const url = new URL(`https://${host}/`);
  url.pathname = `/${pathSegments.map(encodeURIComponent).join('/')}`;
  for (const [key, value] of query) url.searchParams.append(key, value);
  return url.toString();
}

