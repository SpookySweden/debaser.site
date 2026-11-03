import { languageFlag, type LanguageTag } from '../lib/web/language';
import LanguageFlag from './LanguageFlag';

/** How many subtitle flags a row shows before `+N`. */
const SHOWN = 3;

/**
 * A row's languages (SPEC-subtitles.md, Luke 2026-11-03). With nothing known about subtitles it is the one
 * audio flag the rows have always worn. When subtitles are known it says which is which:
 * `AUDIO: [flag]  SUBS: [flag][flag][flag] +N` (English audio still unflagged, English subtitles flagged), or
 * `SUBS: [flag] IN PICTURE` for subtitles burned into the video.
 *
 * `subs`: subtitle languages (`en`, `ja:auto`); a language that is both human-made and AUTO shows once.
 */
export default function AudioSubsFlags({
  audio,
  subs = [],
  burnedIn = null,
  className,
}: {
  audio: LanguageTag | null;
  subs?: readonly string[];
  burnedIn?: LanguageTag | null;
  className?: string;
}) {
  const languages = [...new Set(subs.map((tag) => tag.replace(/:auto$/, '')))];
  if (languages.length === 0 && burnedIn === null) return <LanguageFlag tag={audio} className={className} />;
  const extra = languages.length - SHOWN;
  // Subtitles that can be switched say more than a word in the title ("subbed"): the list wins.
  const inPicture = languages.length === 0 && burnedIn !== null;

  return (
    <span className={`inline-flex flex-wrap items-center gap-x-1.5 align-middle text-label font-normal text-ink${className ? ` ${className}` : ''}`} data-language-flags>
      {languageFlag(audio) !== null ? (
        <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
          AUDIO: <LanguageFlag tag={audio} />
        </span>
      ) : null}
      <span className="inline-flex items-center gap-0.5 whitespace-nowrap" data-subs={inPicture ? 'in-picture' : languages.join(' ')}>
        SUBS:
        {inPicture ? (
          <>
            <LanguageFlag tag={burnedIn} subtitles />
            <span>IN PICTURE</span>
          </>
        ) : (
          <>
            {languages.slice(0, SHOWN).map((tag) => (
              <LanguageFlag key={tag} tag={tag} subtitles note={subs.includes(tag) ? undefined : 'AUTO'} />
            ))}
            {extra > 0 ? <span title={languages.slice(SHOWN).join(', ').toUpperCase()}>+{extra}</span> : null}
          </>
        )}
      </span>
    </span>
  );
}
