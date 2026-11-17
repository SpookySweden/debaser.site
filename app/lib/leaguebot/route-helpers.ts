/**
 * What LEAGUEBOT's routes share (SPEC-leaguebot.md): one memory keeper for this server, who a visitor is for the per-minute
 * limit, and a JSON answer. Server-side only.
 */

import { createKeeper } from './cache';

/** One keeper per server instance, shared by every LEAGUEBOT route. */
export const keeper = createKeeper();

/** The visitor's address as Vercel (or the home server's proxy) passes it on; only ever used as a counter's key. */
export function visitorOf(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  return forwarded.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    // Answers depend on the Riot ID asked for and change every few minutes: the browser and Vercel's edge keep none of them.
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
