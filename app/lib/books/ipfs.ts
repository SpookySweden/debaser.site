/**
 * Books on IPFS (Luke, 2026-11-11): a book named `ipfs:<CID>` is fetched by the reader's own browser straight from a public
 * IPFS gateway, one gateway at a time, and handed to the reader as a Blob in memory. Nothing passes through our server
 * here and nothing is kept. IPFS is a peer-to-peer file network; a CID is the code for one exact file on it, and a gateway
 * is a website that serves IPFS files by their CID. Luke chose any CID over a list of allowed ones (2026-11-11).
 *
 * Browser-safe: no server code, no keys. Browser code may fetch outside sites directly since 2026-11-11 (CLAUDE.md).
 * Proof: `Temp/check-ipfs-gateways.cjs` (a stalled gateway is cancelled and the next asked, a slow trickle is cut off, a
 * redirect off the gateway is refused, a file past the cap stops at once, leaving the page stops everything).
 *
 * Where the first plan's blanks connect:
 * - `[INSERT_IDENTIFIER_MAPPING_LOGIC_OR_ENDPOINT]` -> `ipfsCid()`: a book ref to its CID, or null.
 * - `[INSERT_CONTENT_GATEWAY_URL]`, `[INSERT_FALLBACK_GATEWAY_1]`, `[INSERT_FALLBACK_GATEWAY_2]` -> `IPFS_GATEWAYS`, in order.
 * - The reader's state -> `fetchFromGateways()`'s `onProgress` (LOADING n%) and its `IpfsFetchError` (the line it shows).
 */

/**
 * The gateways, asked in this order. Tested live on 2026-11-11 with a known file and an `Origin` header: both answer with
 * `Access-Control-Allow-Origin: *` (browsers may read them) and 4everland redirects to its own `<cid>.ipfs.4everland.io`.
 * ipfs.io and dweb.link, the best-known two, now answer 429 "switching to a service worker gateway only", so they are kept
 * last, in case they come back. Each is only `https://<host>/ipfs/<cid>`; a redirect may stay on the host or go to
 * `<anything>.ipfs.<host>`, nowhere else (`onGateway`).
 */
export const IPFS_GATEWAYS: readonly { name: string; host: string }[] = [
  { name: '4EVERLAND', host: '4everland.io' }, // [INSERT_CONTENT_GATEWAY_URL]
  { name: 'PINATA', host: 'gateway.pinata.cloud' }, // [INSERT_FALLBACK_GATEWAY_1]
  { name: 'DWEB.LINK', host: 'dweb.link' }, // [INSERT_FALLBACK_GATEWAY_2]
  { name: 'IPFS.IO', host: 'ipfs.io' },
];

/** How long a gateway has to start answering before it is cancelled and the next is asked. */
export const IPFS_START_MS = 8_000;
/** Once a book is arriving: how long it may go with no new bytes before that gateway is cancelled. */
export const IPFS_STALL_MS = 15_000;
/** The largest book read this way, in memory. A file announcing more stops before a byte is read. */
export const IPFS_MAX_BYTES = 100 * 1024 * 1024;

/**
 * A CID the reader takes: version 0 (`Qm` and 44 base58 letters) or version 1 in base32 (`b` and lower-case letters and
 * 2-7, e.g. `bafy...`, `bafk...`). Nothing else, so a CID can't carry a path, a query or another address.
 */
const CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,120})$/;

export function isCid(value: string): boolean {
  return CID.test(value);
}

/** A book ref's CID (`ipfs:<CID>`), or null for any other ref. */
export function ipfsCid(bookRef: string): string | null {
  if (!bookRef.startsWith('ipfs:')) return null;
  const cid = bookRef.slice('ipfs:'.length);
  return isCid(cid) ? cid : null;
}

/** One gateway's address for a CID: `https://<host>/ipfs/<cid>`. */
export function gatewayUrl(host: string, cid: string): string {
  return `https://${host}/ipfs/${cid}`;
}

/** Whether an answer's final address (after redirects) is still that gateway: its own host, or `<x>.ipfs.<host>`. */
export function onGateway(address: string, host: string): boolean {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const name = url.hostname.toLowerCase();
  return name === host || (name.endsWith(`.ipfs.${host}`) && /^[a-z0-9]+$/.test(name.slice(0, -`.ipfs.${host}`.length)));
}

/** The lines the reader shows when no gateway gave the book. Fixed words only: never a gateway's message or address. */
export type IpfsProblem = 'NOT A BOOK ADDRESS' | 'NO COPY FOUND' | 'SOURCE NOT ANSWERING' | 'BLOCKED BY THE SOURCE' | 'TOO BIG TO READ HERE';

export class IpfsFetchError extends Error {
  constructor(readonly problem: IpfsProblem) {
    super(problem);
    this.name = 'IpfsFetchError';
  }
}

export type IpfsProgress = { gateway: string; loaded: number; total: number | null };

type FetchImpl = (input: string, init: RequestInit) => Promise<Response>;

export type IpfsFetchOptions = {
  /** Aborted when the reader leaves the page: the gateway being read is cancelled and no other is asked. */
  signal?: AbortSignal;
  onProgress?: (progress: IpfsProgress) => void;
  fetchImpl?: FetchImpl;
  gateways?: readonly { name: string; host: string }[];
  startMs?: number;
  stallMs?: number;
  maxBytes?: number;
};

/** How one gateway went: the book, or why not (which decides the line shown when every gateway failed). */
type Attempt = { book: { blob: Blob; type: string | null; gateway: string } } | { failed: 'missing' | 'slow' | 'blocked' | 'refused' };

/**
 * The book for a CID, from the first gateway that gives all of it. Gateways are asked one after another, never at once
 * (racing them would download the book several times). Each has its own AbortController: it is cancelled, closing its
 * connection, when it doesn't start answering within `startMs`, when the book stops arriving for `stallMs`, when it
 * answers from somewhere other than itself, or when the page is left.
 */
export async function fetchFromGateways(cid: string, options: IpfsFetchOptions = {}): Promise<{ blob: Blob; type: string | null; gateway: string }> {
  if (!isCid(cid)) throw new IpfsFetchError('NOT A BOOK ADDRESS');
  const { signal, gateways = IPFS_GATEWAYS } = options;
  const outcomes: string[] = [];
  for (const gateway of gateways) {
    if (signal?.aborted) throw abortError();
    const attempt = await askGateway(cid, gateway, options);
    if ('book' in attempt) return attempt.book;
    outcomes.push(attempt.failed);
  }
  if (signal?.aborted) throw abortError();
  // Every gateway said it has no such file: it is not on IPFS (or nobody holds it any more).
  if (outcomes.length > 0 && outcomes.every((outcome) => outcome === 'missing')) throw new IpfsFetchError('NO COPY FOUND');
  // Every gateway refused the browser outright (no permission header, or a network block): step 3's server fallback goes here.
  if (outcomes.length > 0 && outcomes.every((outcome) => outcome === 'blocked')) throw new IpfsFetchError('BLOCKED BY THE SOURCE');
  throw new IpfsFetchError('SOURCE NOT ANSWERING');
}

async function askGateway(cid: string, gateway: { name: string; host: string }, options: IpfsFetchOptions): Promise<Attempt> {
  const { signal, onProgress, fetchImpl = fetch, startMs = IPFS_START_MS, stallMs = IPFS_STALL_MS, maxBytes = IPFS_MAX_BYTES } = options;
  const controller = new AbortController();
  const leave = () => controller.abort();
  signal?.addEventListener('abort', leave, { once: true });
  let timer = setTimeout(() => controller.abort(), startMs);
  const restartTimer = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), ms);
  };
  try {
    let response: Response;
    try {
      response = await fetchImpl(gatewayUrl(gateway.host, cid), {
        signal: controller.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        redirect: 'follow',
      });
    } catch {
      // Cancelled (too slow, or the page was left) or refused before any answer: a browser reports a missing permission
      // header and a dropped connection the same way, as a TypeError with nothing in it.
      return { failed: controller.signal.aborted ? 'slow' : 'blocked' };
    }
    if (response.url && !onGateway(response.url, gateway.host)) {
      controller.abort();
      return { failed: 'refused' };
    }
    if (response.status === 404 || response.status === 410) {
      controller.abort();
      return { failed: 'missing' };
    }
    if (response.status !== 200 || !response.body) {
      controller.abort();
      return { failed: 'refused' };
    }
    const announced = Number(response.headers.get('content-length'));
    const total = Number.isFinite(announced) && announced > 0 ? announced : null;
    // The same file is the same size on every gateway, so a book past the cap stops here rather than trying the rest.
    if (total !== null && total > maxBytes) {
      controller.abort();
      throw new IpfsFetchError('TOO BIG TO READ HERE');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    restartTimer(stallMs);
    onProgress?.({ gateway: gateway.name, loaded, total });
    for (;;) {
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await reader.read();
      } catch {
        return { failed: controller.signal.aborted ? 'slow' : 'refused' };
      }
      if (next.done) break;
      loaded += next.value.byteLength;
      if (loaded > maxBytes) {
        controller.abort();
        throw new IpfsFetchError('TOO BIG TO READ HERE');
      }
      chunks.push(next.value);
      restartTimer(stallMs);
      onProgress?.({ gateway: gateway.name, loaded, total });
    }
    if (total !== null && loaded !== total) return { failed: 'refused' };
    const type = response.headers.get('content-type');
    return { book: { blob: new Blob(chunks as BlobPart[], type ? { type } : undefined), type, gateway: gateway.name } };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', leave);
  }
}

function abortError(): Error {
  const error = new Error('The reader left the page.');
  error.name = 'AbortError';
  return error;
}
