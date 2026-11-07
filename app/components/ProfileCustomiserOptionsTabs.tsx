'use client';

import { useMemo } from 'react';
import { countryName, countryOptions } from '../lib/profile/countries';
import { SITE_COLOUR_LABEL, nameColourWearsStrip, nameColourWords } from '../lib/profile/name-colours';
import { MAX_BIO_LENGTH, MAX_STATUS_LENGTH } from '../lib/profile/types';
import type { PublicProfile } from '../lib/profile/types';
import { FIELD, PLATE_LARGE } from '../lib/ui/controls';
import CountryFlag from './CountryFlag';
import { nameInkStyle } from './NameColourWindow';

export const CUSTOMISER_NOTE = 'text-label font-bold text-ink';

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
  /** Opens the colour window, which the editor draws so its ESC can be told apart from its own. */
  onChangeColour: () => void;
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
  onChangeColour,
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
      <div className="flex flex-wrap items-center gap-x-2">
        <span className="min-w-0 flex-1 basis-56">
          <input
            id="customise-name"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder={profile.displayName}
            className={FIELD}
          />
        </span>
        <button type="button" onClick={onChangeColour} aria-haspopup="dialog" data-change-colour className={PLATE_LARGE}>
          [ CHANGE COLOUR ]
        </button>
      </div>
      {/* The name as it stands, in the colour it will be read in, and that colour in words. */}
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-label text-ink">
        <span
          className={`text-title ${nameColour.length === 0 ? 'text-ink' : 'name-ink'} ${nameColourWearsStrip(nameColour) ? 'name-strip' : ''}`}
          style={nameColour.length === 0 ? undefined : nameInkStyle(nameColour)}
        >
          {preview}
        </span>
        <span>{nameColour.length === 0 ? SITE_COLOUR_LABEL : nameColourWords(nameColour)}</span>
      </p>

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

