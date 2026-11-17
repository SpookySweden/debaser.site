/**
 * LEAGUEBOT's advice log (SPEC-leaguebot.md, Luke's 6A): short plain-English lines, the weightiest first, each with a text
 * mark: `!` a problem, `+` a strength, `>` a thing to try. Shared by every tab.
 */

import type { AdviceLine } from '../lib/leaguebot/advice';

const MARK_WORD = { '!': 'Problem', '+': 'Strength', '>': 'Try' } as const;

export default function LeagueAdvice({ lines, empty }: { lines: AdviceLine[]; empty: string }) {
  if (lines.length === 0) return <p className="px-2 py-1 text-label text-ink">{empty}</p>;
  return (
    <ol className="px-2" data-leaguebot-advice>
      {lines.map((line) => (
        <li key={line.key} className="rule-pixel flex gap-2 py-1.5 text-label text-ink" data-advice={line.key}>
          <span className={`shrink-0 px-1 font-mono ${line.mark === '!' ? 'bg-ena text-ink-bar' : line.mark === '+' ? 'bg-sun text-ink-plate' : 'text-ink'}`} aria-label={MARK_WORD[line.mark]}>
            {line.mark}
          </span>
          <span className="min-w-0">{line.text}</span>
        </li>
      ))}
    </ol>
  );
}
