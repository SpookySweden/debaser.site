import { languageFlag, type LanguageTag } from '../lib/web/language';
import { subtitleFlag } from '../lib/web/subtitles';
import CountryFlag from './CountryFlag';

/**
 * The language a piece of content is in, as a flag after its title (Luke, 2026-11-03).
 *
 * Which flag is `languageFlag`'s rule (app/lib/web/language.ts): none for English or an unknown language,
 * the tag's region when it has one, else the language's home country. A language with no one country
 * (Catalan, Latin) gets its two letters on a plate instead, so it is still said. Either way it is named by
 * the language ("SPANISH"), on hover and to a screen reader, never by the country.
 *
 * `subtitles`: a subtitle language (SPEC-subtitles.md), where English is flagged too (`subtitleFlag`); `note`
 * is added to its name (`AUTO`). `onBar`: on the stream player's black bar, where a letter plate is drawn in its Daffodil.
 */
export default function LanguageFlag({ tag, className, subtitles = false, note, onBar = false }: { tag: LanguageTag | null; className?: string; subtitles?: boolean; note?: string; onBar?: boolean }) {
  const found = subtitles ? subtitleFlag(tag) : languageFlag(tag);
  if (found === null) return null;
  const flag = note === undefined ? found : { ...found, name: `${found.name} (${note})` };

  return (
    <span className={`inline-flex align-middle${className ? ` ${className}` : ''}`}>
      {flag.country !== null ? (
        <CountryFlag code={flag.country} label={flag.name} />
      ) : (
        <span title={flag.name} className={`inline-flex items-center border px-0.5 text-label leading-none ${onBar ? 'border-sun text-sun' : 'border-ink-plate text-ink'}`}>
          <span aria-hidden="true">{flag.language.toUpperCase()}</span>
          <span className="sr-only">{flag.name}</span>
        </span>
      )}
    </span>
  );
}
