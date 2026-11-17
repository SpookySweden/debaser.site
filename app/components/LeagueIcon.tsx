'use client';

/**
 * One of Riot's icons (a champion, item, spell, rune, rank crest or profile icon), loaded straight from Riot's servers
 * (SPEC-leaguebot.md, the named exception for Riot's game art, Luke's 7A). Square, one of three sizes, with the name as its
 * alt text and tip. While the data hasn't loaded, or an address fails, it keeps its square empty so nothing moves.
 */

import { useState } from 'react';

const SIZES = { sm: 'h-6 w-6', md: 'h-8 w-8', lg: 'h-16 w-16' } as const;

export default function LeagueIcon({ src, name, size = 'md' }: { src: string | null | undefined; name: string; size?: keyof typeof SIZES }) {
  const [failed, setFailed] = useState<string | null>(null);
  const box = `${SIZES[size]} shrink-0`;
  if (!src || failed === src) return <span className={`${box} inline-block bg-chrome-dark`} title={name} aria-label={name} role="img" />;
  // eslint-disable-next-line @next/next/no-img-element -- Riot's own servers, at Riot's own sizes; nothing to optimise.
  return <img src={src} alt={name} title={name} width={64} height={64} loading="lazy" decoding="async" referrerPolicy="no-referrer" className={`${box} object-cover`} onError={() => setFailed(src)} />;
}
