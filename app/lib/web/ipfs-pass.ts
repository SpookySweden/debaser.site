import { gatewayUrl, isCid, IPFS_GATEWAYS } from '../books/ipfs';
import { SafeFetchError, safeFetchStream, type FetchLike } from './safe-fetch';

/**
 * IPFS books, step 3 (Luke, 2026-11-11): the server's way round a gateway that refuses the reader's browser. When every
 * gateway refused the browser itself (`BLOCKED BY THE SOURCE` in `lib/books/ipfs.ts`), the reader asks
 * `/api/web/book/epub?ref=ipfs:<CID>`, and the book passes through our server as it streams, never kept, like the
 * Gutenberg and Archive books. SERVER ONLY.
 *
 * Luke chose any CID over a list (2026-11-11), so the server would otherwise relay any file on IPFS for anyone. What
 * keeps it to books: the first bytes must be an EPUB (a zip: `PK\x03\x04`) or a PDF (`%PDF-`), or nothing is passed on;
 * a file is at most `IPFS_PASS_MAX_BYTES`; the route allows few per address a minute; and the answer is a download of a
 * book for the reader, never shown by the browser as a page (`nosniff`, the book's own type, `private, no-store`).
 *
 * The same gateways as the browser's, in the same order, one at a time, each through `safe-fetch` on its own host (and its
 * own `<cid>.ipfs.<host>` subdomain, where 4everland redirects). A gateway that hasn't started answering in 8 seconds is
 * cancelled and the next asked; the whole book must come within 50 (the route lives at most 60).
 */
export const IPFS_PASS_MAX_BYTES = 50 * 1024 * 1024;
export const IPFS_PASS_START_MS = 8_000;
export const IPFS_PASS_WHOLE_MS = 50_000;

export type IpfsPassed = { body: ReadableStream<Uint8Array>; length: number | null; type: 'application/epub+zip' | 'application/pdf' };

/** What the first bytes of a file say it is: an EPUB (a zip), a PDF, or neither. */
export function bookType(head: Uint8Array): IpfsPassed['type'] | null {
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return 'application/epub+zip';
  if (head.length >= 5 && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 && head[4] === 0x2d) return 'application/pdf';
  return null;
}

/** A gateway's own CID subdomains (`<cid>.ipfs.4everland.io`), the only place a redirect from it may lead. */
function subdomainsOf(host: string): RegExp {
  return new RegExp(`^[a-z0-9]{10,120}\\.ipfs\\.${host.replace(/[.]/g, '\\.')}$`);
}

/**
 * The stream with its first bytes looked at: the book's type and the whole stream again (those bytes first), or null and the
 * stream cancelled when it isn't an EPUB or a PDF.
 */
export async function gateBook(body: ReadableStream<Uint8Array>): Promise<{ type: IpfsPassed['type']; body: ReadableStream<Uint8Array> } | null> {
  const reader = body.getReader();
  const held: Uint8Array[] = [];
  let size = 0;
  while (size < 5) {
    const next = await reader.read();
    if (next.done) break;
    held.push(next.value);
    size += next.value.byteLength;
  }
  const head = new Uint8Array(size);
  let at = 0;
  for (const chunk of held) {
    head.set(chunk, at);
    at += chunk.byteLength;
  }
  const type = bookType(head);
  if (type === null) {
    await reader.cancel().catch(() => undefined);
    return null;
  }
  return {
    type,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of held) controller.enqueue(chunk);
      },
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        } catch (error) {
          controller.error(error);
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    }),
  };
}

/**
 * The book for a CID from the first gateway that gives one, passed on as it streams: `'missing'` when every gateway says it
 * has no such file, `'not-a-book'` when the file isn't an EPUB or a PDF (the same file on every gateway, so no other is
 * asked), and null when none answered in time.
 */
export async function openIpfsBook(
  cid: string,
  fetchImpl: FetchLike,
  options: { gateways?: readonly { name: string; host: string }[]; startMs?: number; wholeMs?: number; maxBytes?: number } = {},
): Promise<IpfsPassed | 'missing' | 'not-a-book' | 'too-big' | null> {
  if (!isCid(cid)) return null;
  const { gateways = IPFS_GATEWAYS, startMs = IPFS_PASS_START_MS, wholeMs = IPFS_PASS_WHOLE_MS, maxBytes = IPFS_PASS_MAX_BYTES } = options;
  // One deadline for the whole answer, shared by every gateway asked (the route lives at most 60 seconds).
  const deadline = Date.now() + wholeMs;
  let missing = 0;
  for (const gateway of gateways) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    const controller = new AbortController();
    // Cancelled unless the book's first bytes have come within `startMs`: its headers alone are not enough.
    const timer = setTimeout(() => controller.abort(), Math.min(startMs, left));
    try {
      let opened: Awaited<ReturnType<typeof safeFetchStream>>;
      try {
        opened = await safeFetchStream(gatewayUrl(gateway.host, cid), {
          allowedHosts: [gateway.host],
          redirectHosts: subdomainsOf(gateway.host),
          fetchImpl,
          timeoutMs: left,
          maxBytes,
          accept: 'application/epub+zip, application/pdf, */*',
          signal: controller.signal,
        });
      } catch (error) {
        // A file past the cap is the same size everywhere: no other gateway is asked for it.
        if (error instanceof SafeFetchError && error.message === 'response too large') return 'too-big';
        if (error instanceof SafeFetchError && (error.status === 404 || error.status === 410)) missing += 1;
        continue;
      }
      let gated: Awaited<ReturnType<typeof gateBook>>;
      try {
        gated = await gateBook(opened.body);
      } catch {
        // Cancelled before its first bytes came (or the stream broke): the next gateway.
        continue;
      }
      if (gated === null) return 'not-a-book';
      return { body: gated.body, length: opened.length, type: gated.type };
    } finally {
      // The first bytes came (or the attempt is over): from here only the shared deadline holds.
      clearTimeout(timer);
    }
  }
  return missing === gateways.length ? 'missing' : null;
}
