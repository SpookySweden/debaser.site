/**
 * LEAGUEBOT's advice log (SPEC-leaguebot.md, Luke's 6A): short plain-English lines, the weightiest first, each with a text
 * mark: `!` a problem, `+` a strength, `>` a thing to try. Shared by every tab. Advice is what LEAGUEBOT is for, so it reads
 * at the prose size (15px), not the label size.
 */

import type { AdviceLine } from '../lib/leaguebot/advice';

const MARK_WORD = { '!': 'Problem:', '+': 'Strength:', '>': 'Try:' } as const;

export default function LeagueAdvice({ lines, empty }: { lines: AdviceLine[]; empty: string }) {
  if (lines.length === 0) return <p className="px-2 py-1 text-label text-ink">{empty}</p>;
  return (
    <ol className="px-2" data-leaguebot-advice>
      {lines.map((line) => (
        <li key={line.key} className="rule-pixel flex gap-3 py-2 text-prose text-ink" data-advice={line.key}>
          <span aria-hidden="true" className={`h-fit shrink-0 px-1.5 font-mono ${line.mark === '!' ? 'bg-ena text-ink-bar' : line.mark === '+' ? 'bg-sun text-ink-plate' : 'text-ink'}`}>
            {line.mark}
          </span>
          <span className="min-w-0">
            <span className="sr-only">{MARK_WORD[line.mark]} </span>
            {line.text}
          </span>
        </li>
      ))}
    </ol>
  );
}
