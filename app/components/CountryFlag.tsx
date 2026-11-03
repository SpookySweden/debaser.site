import { countryFlagPath, countryName, isCountryCode } from '../lib/profile/countries';
import SpriteSlot from './SpriteSlot';

type CountryFlagProps = {
  /** An ISO 3166-1 alpha-2 code, or `''` for no country - in which case this draws nothing. */
  code: string;
  /** Width in whole pixels. Flags are drawn 3:2, so a wider slot wants a taller one too. */
  width?: number;
  height?: number;
  /** What the flag is called, when it stands for something other than the country (a language: `LanguageFlag`). */
  label?: string;
};

/**
 * A country, drawn as a flag beside a name.
 *
 * **It replaced a place line, and what it is has to be a picture.** `PLACE: GOTHENBURG` was a
 * sentence; a profile now says *which country*, a code off a closed list with a flag that belongs
 * to it (`assets/flags/<code>.png`, served at `/assets/flags/<code>.png`; the folder's README is the
 * contract).
 *
 * **The flags are the one ready-made set on the site, by Luke's choice (2026-11-03).** They were
 * waiting to be hand-drawn, none had been, and every profile showed two tiny letters instead. The
 * files are drawn from the MIT-licensed `country-flag-icons` set (the official national designs,
 * not anybody's artwork; licence and source in `assets/flags/README.txt`). A flag Luke draws himself
 * simply replaces its file. Code still draws none: no CSS, no SVG, no emoji.
 *
 * **Drawn smoothly, unlike every other picture here.** The site's pictures are pixel drawings shown
 * at whole multiples (`img { image-rendering: pixelated }`); a flag is a 72x48 file shown at 18x12,
 * and nearest-neighbour shrinking eats a coat of arms or a star field. `.country-flag` in
 * globals.css hands it back to ordinary smoothing.
 *
 * **The two letters stay as the fallback.** A file that fails to load would leave a profile's
 * country readable only from a tooltip, and a phone has no tooltip, so SpriteSlot's `fallback`
 * draws the code the country is filed under.
 *
 * **Nothing is rendered when there is no country.** Not a placeholder, not a dash: the callers that
 * need to say "not given" say it in words (`PublicProfileWindow`).
 */
export default function CountryFlag({ code, width = 18, height = 12, label }: CountryFlagProps) {
  // The list, not a length test: a row hand-edited to "Sw" or "SWEDEN" is not a country this site
  // knows, and rendering it would be the free-text field creeping back in one plate at a time.
  if (!isCountryCode(code)) return null;

  const name = label ?? countryName(code);

  return (
    <SpriteSlot
      src={countryFlagPath(code)}
      alt={name}
      width={width}
      height={height}
      title={name}
      className="country-flag"
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
