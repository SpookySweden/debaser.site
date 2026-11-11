/**
 * The only way WEB reaches another site. Server-side only: no browser file may import this
 * (`scripts/check-web-types.cjs` holds that line).
 *
 * The rules (SPEC-web.md):
 * - https only, and only to the hosts the calling adapter allow-lists;
 * - a URL is built from validated identifiers (`buildUrl`), never taken from remote data;
 * - 10s timeout, a size cap enforced while the body streams, no retries;
 * - redirects are followed by hand, and only to allow-listed https hosts;
 * - a POST (`postJson`, for a JSON API that only takes POST, like YouTube's InnerTube) sends a JSON body
 *   built by the caller and follows no redirect at all.
 */

import { isAllowedUrl } from './urls';

export { buildUrl, isAllowedUrl, isSafeIdentifier } from './urls';

export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export class SafeFetchError extends Error {
  /** The HTTP status, when the platform answered with an error (a search tells "daily limit" from "not found"). */
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'SafeFetchError';
    if (status !== undefined) this.status = status;
  }
}

/** The `fetch` shape the adapters take, so checks can hand them a fake one and run offline. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Who is asking. Platforms ask for a descriptive agent; the contact is optional and comes from the
 * server-only `WEB_FETCH_CONTACT` (never a NEXT_PUBLIC value, never hard-coded).
 */
export function userAgent(): string {
  const contact = (process.env.WEB_FETCH_CONTACT ?? '').replace(/[^\x20-\x7e]/g, '').trim();
  return contact ? `DebaserSiteWEB/1.0 (+https://debaser.site; ${contact})` : 'DebaserSiteWEB/1.0 (+https://debaser.site)';
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new SafeFetchError('response too large');
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let next: ReadableStreamReadResult<Uint8Array>;
    try {
      next = await reader.read();
    } catch (error) {
      // A timeout mid-body, or a dropped connection: one error type for every failure here.
      throw new SafeFetchError(`body read failed: ${(error as Error).name}`);
    }
    const { done, value } = next;
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new SafeFetchError('response too large');
    }
    chunks.push(value);
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

export type SafeFetchOptions = {
  allowedHosts: readonly string[];
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxBytes?: number;
  accept?: string;
  /** Send this as a JSON POST body instead of a GET. */
  postJson?: unknown;
  /** Sent instead of `userAgent()`: the sweep names the project and never a person, as Archive's and Wikimedia's guidance ask. */
  userAgent?: string;
  /** Hosts a redirect may also lead to (https, the same checks), for a platform that hands downloads to numbered file servers. */
  redirectHosts?: RegExp;
  /** A byte range to ask for (`bytes=0-524287`), for a file read a slice at a time (the reader's PDFs). */
  range?: string;
  /** Cancels the request from outside as well as on the timeout: an IPFS gateway that doesn't start answering (ipfs-pass.ts). */
  signal?: AbortSignal;
};

/** A redirect's address on one of `redirectHosts`, with every other check `isAllowedUrl` makes. */
function redirectAllowed(value: string, redirectHosts: RegExp | undefined): boolean {
  if (redirectHosts === undefined) return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return redirectHosts.test(host) && isAllowedUrl(value, [host]);
  } catch {
    return false;
  }
}

/** GET (or `postJson`: POST) an allow-listed https URL and return its body as text. Throws `SafeFetchError` on any breach. */
export async function safeFetchText(url: string, options: SafeFetchOptions): Promise<string> {
  const response = await safeFetchResponse(url, options);
  return readCapped(response, options.maxBytes ?? MAX_RESPONSE_BYTES);
}

/**
 * GET an allow-listed https URL and hand its body on as a stream, without holding it: for a file passed straight through to
 * the browser (the reader's EPUB, SPEC-reader.md). The size cap is enforced as the bytes go by (a declared length over it is
 * refused before any are read; a body that runs past it is cut off with an error). The timeout covers the whole body.
 */
export async function safeFetchStream(
  url: string,
  options: SafeFetchOptions,
): Promise<{ body: ReadableStream<Uint8Array>; length: number | null; type: string | null; status: number; contentRange: string | null }> {
  const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES;
  const response = await safeFetchResponse(url, options);
  const declared = Number(response.headers.get('content-length'));
  const length = response.headers.has('content-length') && Number.isFinite(declared) ? declared : null;
  if (length !== null && length > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new SafeFetchError('response too large');
  }
  if (!response.body) throw new SafeFetchError('no body');
  let total = 0;
  const capped = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > maxBytes) controller.error(new SafeFetchError('response too large'));
      else controller.enqueue(chunk);
    },
  });
  return { body: response.body.pipeThrough(capped), length, type: response.headers.get('content-type'), status: response.status, contentRange: response.headers.get('content-range') };
}

/** The hops (each held to the allow-list), down to the answering response, which is returned unread. */
async function safeFetchResponse(url: string, options: SafeFetchOptions): Promise<Response> {
  const { allowedHosts, fetchImpl = fetch, timeoutMs = FETCH_TIMEOUT_MS } = options;
  const signal = options.signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), options.signal]) : AbortSignal.timeout(timeoutMs);
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const redirected = hop > 0 && redirectAllowed(current, options.redirectHosts);
    if (!redirected && !isAllowedUrl(current, allowedHosts)) throw new SafeFetchError('host not allowed');

    let response: Response;
    try {
      const headers: Record<string, string> = { 'User-Agent': options.userAgent ?? userAgent(), Accept: options.accept ?? 'application/json' };
      if (options.range !== undefined && /^bytes=\d{1,12}-\d{0,12}$/.test(options.range)) headers.Range = options.range;
      response = await fetchImpl(
        current,
        options.postJson === undefined
          ? { method: 'GET', redirect: 'manual', signal, credentials: 'omit', headers }
          : { method: 'POST', redirect: 'manual', signal, credentials: 'omit', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(options.postJson) },
      );
    } catch (error) {
      throw new SafeFetchError(signal.aborted ? 'timed out' : `request failed: ${(error as Error).name}`);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      if (options.postJson !== undefined) throw new SafeFetchError('redirect after a post');
      if (!location) throw new SafeFetchError('redirect without a location');
      // Resolved against the current URL, then held to the same allow-list on the next pass.
      try {
        current = new URL(location, current).toString();
      } catch {
        throw new SafeFetchError('redirect to a malformed location');
      }
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new SafeFetchError(`HTTP ${response.status}`, response.status);
    }

    return response;
  }

  throw new SafeFetchError('too many redirects');
}

/** `safeFetchText`, parsed as JSON. */
export async function safeFetchJson(url: string, options: SafeFetchOptions): Promise<unknown> {
  const text = await safeFetchText(url, options);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SafeFetchError('response was not JSON');
  }
}
