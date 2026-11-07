'use client';

import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import { countryName, countryOptions } from '../lib/profile/countries';
import {
  NAME_COLOURS_THAT_GLOW,
  NAME_COLOURS_THAT_READ,
  SITE_COLOUR_LABEL,
  nameColourDark,
  nameColourPairLabel,
  nameColourWearsStrip,
  nameOnThemes,
} from '../lib/profile/name-colours';
import { MAX_BIO_LENGTH, MAX_STATUS_LENGTH } from '../lib/profile/types';
import type { PublicProfile } from '../lib/profile/types';
import { FIELD, KEY_FOCUS } from '../lib/ui/controls';
import CountryFlag from './CountryFlag';

export const CUSTOMISER_NOTE = 'text-label font-bold text-ink';

/**
 * A choice of name colour is a whole row: a tick, a block of the colour, its name in the window's own ink, then
 * the reader's own name in that colour on the window itself. It doesn't fill under the pointer as a key does,
 * because the fill would cover the very thing the row is showing.
 */
const COLOUR_ROW = `${KEY_FOCUS} flex w-full cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 px-1 py-1 text-left text-prose text-ink min-h-9 active:translate-y-press pointer-coarse:min-h-tap`;

/** The two groups the arithmetic produces (see app/lib/profile/name-colours.ts). */
const NAME_COLOUR_GROUPS = [
  { label: 'READS ON ITS OWN', colours: NAME_COLOURS_THAT_READ },
  { label: 'DARK STRIP ON BRIGHT THEMES', colours: NAME_COLOURS_THAT_GLOW },
];

/** The pair `.name-ink` picks between (globals.css), so this draws exactly what the board draws. */
function nameInkStyle(hex: string): CSSProperties {
  return { '--name-ink': hex, '--name-ink-dark': nameColourDark(hex) } as CSSProperties;
}

function NameColourRow({ hex, label, sample, chosen, onChoose }: { hex: string; label: string; sample: string; chosen: boolean; onChoose: (hex: string) => void }) {
  // No swatch means the theme's own ink, which has no pair to pick between.
  const ink = hex.length === 0 ? { className: 'text-ink', style: undefined } : { className: 'name-ink', style: nameInkStyle(hex) };
  // The block shows what the name is drawn in. A colour on the strip takes its dark reading on every theme.
  const stripped = nameColourWearsStrip(hex);
  const dark = nameColourDark(hex);
  const blockStyle = stripped ? ({ '--name-ink': dark, '--name-ink-dark': dark } as CSSProperties) : ink.style;

  return (
    <button
      type="button"
      onClick={() => onChoose(hex)}
      aria-pressed={chosen}
      aria-label={label}
      className={`${COLOUR_ROW} ${chosen ? 'outline-2 -outline-offset-2 outline-ink' : 'hover:outline-2 hover:-outline-offset-2 hover:outline-dotted hover:outline-ink'}`}
    >
      {/* A fixed width: the tick falls back to a wider face, and picking a row must not nudge its words. */}
      <span aria-hidden="true" className="w-12 shrink-0 whitespace-pre">
        {chosen ? '[ ✓ ]' : '[   ]'}
      </span>
      <span aria-hidden="true" className={`${ink.className} h-6 w-6 shrink-0 border-line border-ink bg-current`} style={blockStyle} />
      <span className="w-52 shrink-0">{label}</span>
      <span aria-hidden="true" className="min-w-0 flex-1 basis-40 truncate text-title">
        {/* Its own inline box, so a strip is as wide as the name and not the row. The block above never wears one. */}
        <span className={`${ink.className} ${stripped ? 'name-strip' : ''}`} style={ink.style}>
          {sample}
        </span>
      </span>
    </button>
  );
}

/** The choice on every theme, each line in that theme's own window colour. Says so in words if one ever fails. */
function NameOnEveryTheme({ hex, sample }: { hex: string; sample: string }) {
  return (
    <>
      <p className={`${CUSTOMISER_NOTE} mt-3`}>YOUR PICK ON EVERY THEME</p>
      <ul className="mt-1 border-line border-ink">
        {nameOnThemes(hex).map((theme) => (
          <li
            key={theme.id}
            className="flex min-h-8 flex-wrap items-center gap-x-2 px-2 py-1 text-key"
            style={{ backgroundColor: theme.field, color: theme.ink }}
          >
            <span className="w-24 shrink-0">{theme.label}</span>
            <span className="min-w-0 flex-1 basis-40 truncate text-title">
              <span className={theme.strip === null ? undefined : 'px-1'} style={{ color: theme.value, backgroundColor: theme.strip ?? undefined }}>
                {sample}
              </span>
            </span>
            {theme.readable ? null : <span className="shrink-0">HARD TO READ</span>}
          </li>
        ))}
      </ul>
    </>
  );
}

export type ProfileIdentityTabProps = {
  profile: PublicProfile;
  name: string;
  bio: string;
  /** An ISO 3166-1 alpha-2 code, or `''` for no flag. A list, not a sentence (./countries). */
  country: string;
  status: string;
  /** Swatch hex for the username, or '' for the default black. */
  nameColour: string;
  onNameChange: (value: string) => void;
  onBioChange: (value: string) => void;
  onCountryChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onNameColourChange: (hex: string) => void;
  bioProblem: string | undefined;
  countryProblem: string | undefined;
  statusProblem: string | undefined;
};

/** Public name, its colour, country flag, status and bio: the text half of the public face. */
export function ProfileIdentityTab({
  profile,
  name,
  bio,
  country,
  status,
  nameColour,
  onNameChange,
  onBioChange,
  onCountryChange,
  onStatusChange,
  onNameColourChange,
  bioProblem,
  countryProblem,
  statusProblem,
}: ProfileIdentityTabProps) {
  const preview = name.trim().length === 0 ? profile.displayName : name;
  // Built once per mount rather than per render: 249 names off a formatter, and the list cannot
  // change while a reader has the tab open (app/lib/profile/countries.ts).
  const countries = useMemo(() => countryOptions(), []);

  return (
    <div className="p-3">
      <label htmlFor="customise-name" className={CUSTOMISER_NOTE}>
        NAME
      </label>
      <input
        id="customise-name"
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
        placeholder={profile.displayName}
        className={FIELD}
      />

      <p className={`${CUSTOMISER_NOTE} mt-3`}>NAME COLOUR</p>
      <div className="mt-1">
        <NameColourRow hex="" label={SITE_COLOUR_LABEL} sample={preview} chosen={nameColour.length === 0} onChoose={onNameColourChange} />
      </div>

      {NAME_COLOUR_GROUPS.map((group) => (
        <div key={group.label} className="mt-2">
          <p className={CUSTOMISER_NOTE}>{group.label}</p>
          <div className="mt-1">
            {group.colours.map((colour) => (
              <NameColourRow
                key={colour.id}
                hex={colour.hex}
                label={nameColourPairLabel(colour)}
                sample={preview}
                chosen={nameColour === colour.hex}
                onChoose={onNameColourChange}
              />
            ))}
          </div>
        </div>
      ))}

      <NameOnEveryTheme hex={nameColour} sample={preview} />

      {/* A select rather than a text box, and that is the whole change: a place line was a sentence
          the site could not draw, and a country is a code off the list below, which it can. The flag's
          asset note stays its label's hover tip (Luke keeps the missing-artwork wording). */}
      <label
        className={`${CUSTOMISER_NOTE} mt-3 block`}
        htmlFor="customise-country"
        title="A FLAG IS A HAND-DRAWN FILE AT /ASSETS/FLAGS - UNTIL ONE IS DRAWN THE TWO LETTERS OF THE CODE STAND IN FOR IT."
      >
        COUNTRY
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <select
          id="customise-country"
          value={country}
          onChange={(event) => onCountryChange(event.target.value)}
          className={`${FIELD} min-w-56`}
        >
          <option value="">NONE</option>
          {countries.map((option) => (
            <option key={option.code} value={option.code}>
              {option.name}
            </option>
          ))}
        </select>
        {/* The preview, drawn through the same component the board's byline uses, so what an account
            sees here is what a reader sees. Reserved at a fixed size so choosing a country cannot
            reflow the row (`SpriteSlot` holds its box whether or not the drawing exists). */}
        <CountryFlag code={country} width={24} height={16} />
        <span className="text-label text-ink">{country.length === 0 ? '' : countryName(country)}</span>
      </div>
      {countryProblem === undefined ? null : (
        <p className="mt-1 w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">{countryProblem}</p>
      )}

      {/* The status, beside the country flag because the two are the same kind of thing: one short
          sentence about the account, shown next to the name. It is the owner's own words and not the
          presence lamp, which is why the label says so - the panel shows both, one above the other,
          and a reader should be able to tell which is which. */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <label htmlFor="customise-status" className={CUSTOMISER_NOTE}>
          STATUS
        </label>
        <span className={CUSTOMISER_NOTE}>
          {status.length} / {MAX_STATUS_LENGTH}
        </span>
      </div>
      <input
        id="customise-status"
        value={status}
        onChange={(event) => onStatusChange(event.target.value)}
        placeholder="e.g. drawing issue three"
        className={FIELD}
      />
      {statusProblem === undefined ? null : (
        <p className="mt-1 w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">{statusProblem}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <label htmlFor="customise-bio" className={CUSTOMISER_NOTE}>
          BIO
        </label>
        <span className={CUSTOMISER_NOTE}>
          {bio.length} / {MAX_BIO_LENGTH}
        </span>
      </div>
      <textarea
        id="customise-bio"
        value={bio}
        onChange={(event) => onBioChange(event.target.value)}
        rows={5}
        placeholder="Who is behind this account?"
        className={FIELD}
      />
      {bioProblem === undefined ? null : <p className="mt-1 w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">{bioProblem}</p>}
    </div>
  );
}

