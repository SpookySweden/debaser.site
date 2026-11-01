import { createHash } from 'node:crypto';
import { serverListText } from '../../../../lib/web/media-servers';

/**
 * Which server list the live site runs, as a fingerprint only:
 *
 *   GET /api/web/media/servers-version   ->  { version: "<16 hex characters>" }
 *
 * The "Debaser Servers" program on Luke's desktop (tools/server-editor/) publishes a changed list, then asks
 * this until the fingerprint matches the list it saved: only then does it start the extra WEB update, so the
 * update reads the new servers rather than the old build's. A SHA-256 of `serverListText`, cut to 16 characters:
 * it says nothing about which servers are listed (friends' addresses stay private), which is why this one WEB
 * route answers signed-out callers.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): Response {
  const version = createHash('sha256').update(serverListText(), 'utf8').digest('hex').slice(0, 16);
  return new Response(JSON.stringify({ version }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
