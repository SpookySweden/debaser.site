import { readBrief } from '../../../lib/web/brief';
import type { BriefAnswer, BriefRow } from '../../../lib/web/brief/feeds';

/**
 * The reading mixed into MEDIA's default feed (SPEC-media-feed.md; Luke's decision 1A, 2026-11-16):
 *
 *   GET /api/web/brief  ->  { rows: [{ kind: 'paper' | 'news' | 'longread' | 'tech', item: WebItem }] }
 *
 * Papers, news, long reads and tech links, read live from the feeds listed in lib/web/brief/feeds.ts and stored nowhere.
 * It takes no input at all (no person, no words), so Vercel's edge gives everyone the same answer and each feed is read
 * about once every half hour however many people visit; this instance also keeps its last answer for that long.
 * Metadata only: no counts or ratings are read from any feed.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const KEEP_MS = 30 * 60 * 1000;
let kept: { rows: BriefRow[]; at: number } | null = null;
let reading: Promise<BriefRow[]> | null = null;

export async function GET(): Promise<Response> {
  const now = Date.now();
  if (kept === null || now - kept.at > KEEP_MS) {
    // One read at a time in this instance: a second visitor waits for the same read.
    reading ??= readBrief().finally(() => {
      reading = null;
    });
    kept = { rows: await reading, at: now };
  }
  const body: BriefAnswer = { rows: kept.rows };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300, s-maxage=1800, stale-while-revalidate=3600' },
  });
}
