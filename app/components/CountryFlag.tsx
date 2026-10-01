import { countryFlagPath, countryName, isCountryCode } from '../lib/profile/countries';
import SpriteSlot from './SpriteSlot';

type CountryFlagProps = {
  /** An ISO 3166-1 alpha-2 code, or `''` for no country - in which case this draws nothing. */
  code: string;
  /** Width in whole pixels. Flags are drawn 3:2, so a wider slot wants a taller one too. */
  width?: number;
  height?: number;
};

/**
 * A country, drawn as a flag beside a name.
 *
 * **It replaced a place line, and what it is has to be a drawing.** `PLACE: GOTHENBURG` was a
 * sentence, and the site cannot draw a sentence - so a profile that once said a place now says
 * *which country*, which is a code off a closed list and a picture that belongs to it. The picture
 * is a hand-drawn file (`assets/flags/<code>.png`, served at `/assets/flags/<code>.png`; the
 * folder's own README is the contract) because AGENTS.md's asset rules say code never draws
 * artwork: not a CSS gradient, not an SVG, and not an emoji standing in for the drawing either.
 *
 * **So the slot is the whole component, and the code is what fills it until the file lands.** That
 * is the one deliberate difference from every other `SpriteSlot` on the site: a missing sprite may
 * honestly be an empty field, but a missing *flag* would leave a profile's country readable only
 * from a tooltip - and a tooltip is exactly what a phone does not have. `fallback` is SpriteSlot's
 * hook for this, and it draws the two letters the country is filed under, which is the same
 * text-mode answer `app/lib/ui/icons.ts` gives for an icon whose drawing is not made yet.
 *
 * **Nothing is rendered when there is no country.** Not a placeholder, not a dash: a reader with no
 * flag chosen shows a name with nothing beside it, and the callers that need to say "not given"
 * say it in words (`PublicProfileWindow`) rather than by pointing at an empty box.
 */
export default function CountryFlag({ code, width = 18, height = 12 }: CountryFlagProps) {
  // The list, not a length test: a row hand-edited to "Sw" or "SWEDEN" is not a country this site
  // knows, and rendering it would be the free-text field creeping back in one plate at a time.
  if (!isCountryCode(code)) return null;

  const name = countryName(code);

  return (
    <SpriteSlot
      src={countryFlagPath(code)}
      alt={name}
      width={width}
      height={height}
      title={`${name} - the flag is a hand-drawn file at ${countryFlagPath(code)}`}
      fallback={
        /* The outer span is already the field, so this only centres the letters in it. The name is
           carried in the alt-lookalike rather than left to the tooltip, for the same reason. */
        <span className="flex h-full w-full items-center justify-center text-[9px] leading-none">
          <span aria-hidden="true">{code}</span>
          <span className="sr-only">{name}</span>
        </span>
      }
    />
  );
}
