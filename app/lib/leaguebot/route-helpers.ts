/**
 * What LEAGUEBOT's routes share (SPEC-leaguebot.md): one memory keeper for this server, who a visitor is for the per-minute
 * limit, and a JSON answer. Server-side only.
 */

import { createKeeper } from './cache';

/** One keeper per server instance, shared by every LEAGUEBOT route. */
export const keeper = createKeeper();

/**
 * The visitor's address, only ever used as a counter's key. `x-real-ip` first (Vercel sets it, and a visitor can't); then
 * the last `x-forwarded-for` entry, the one the nearest proxy added (a visitor can write the first ones themselves).
 */
export function visitorOf(request: Request): string {
  const real = request.headers.get('x-real-ip')?.trim();
  if (real) return real;
  const forwarded = (request.headers.get('x-forwarded-for') ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  return forwarded[forwarded.length - 1] ?? 'unknown';
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    // Answers depend on the Riot ID asked for and change every few minutes: the browser and Vercel's edge keep none of them.
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
