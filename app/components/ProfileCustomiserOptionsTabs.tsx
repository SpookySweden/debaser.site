'use client';

import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import { countryName, countryOptions } from '../lib/profile/countries';
import {
  NAME_COLOURS_THAT_GLOW,
  NAME_COLOURS_THAT_READ,
  nameColourDark,
  nameColourLabel,
} from '../lib/profile/name-colours';
import { MAX_BIO_LENGTH, MAX_STATUS_LENGTH } from '../lib/profile/types';
import type { ProfileVisibility, PublicProfile } from '../lib/profile/types';
import { FIELD, PLATE_MAIN } from '../lib/ui/controls';
import CountryFlag from './CountryFlag';
import InfoFold from './InfoFold';
import { TagMark } from './TagBadge';

export const CUSTOMISER_NOTE = 'text-label font-bold text-ink';

/**
 * A swatch is offered as the site's own chip: a small key of the colour with the swatch's *name* in
 * readable ink beside it, rather than a 24px square of the colour itself. Eight saturated squares in
 * a grid is the loudest thing a customiser can do, and it tells a visitor nothing except that the
 * colours exist; the same eight as named keys is quiet, and the preview line underneath still shows
 * the name drawn in the colour that was picked - which is the only part that has to be loud.
 */
const SWATCH_CHIP =
  'inline-flex cursor-pointer items-center gap-1 rounded-none border border-bubble-pale bg-bubble-pale px-1.5 py-0.25 text-label font-bold text-ink-bar uppercase hover:bg-sun hover:text-ink-plate max-sm:min-h-tap max-sm:px-3 max-sm:text-sm';

/** The sixteen, in the two rows the arithmetic produces (see app/lib/profile/name-colours.ts). */
const NAME_COLOUR_ROWS = [
  { label: 'INK', colours: NAME_COLOURS_THAT_READ },
  { label: 'GLOW', colours: NAME_COLOURS_THAT_GLOW },
];

export type ProfileVisibilityDraft = Partial<ProfileVisibility>;

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
  onSave: () => void;
  busy: boolean;
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
  onSave,
  busy,
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

      {/* What INK and GLOW mean is behind the [ ? ] (SPEC-less-text.md); the flag's asset note stays its
          label's hover tip (Luke keeps the missing-artwork wording). */}
      <p className={`${CUSTOMISER_NOTE} mt-2`}>NAME COLOUR</p>
      <InfoFold topic="name colours" className="mt-1">
        INK READS IN EITHER THEME: ON A DARK FIELD THE COLOUR IS RESTATED (BLACK BECOMES PURE WHITE, ROYAL BLUE
        BECOMES DAFFODIL). GLOW IS HARD TO READ ON PURPOSE.
      </InfoFold>

      {NAME_COLOUR_ROWS.map((row) => (
        <div key={row.label} className="mt-1">
          <p className="text-label font-bold text-ink">{row.label}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {row.colours.map((colour) => {
              const chosen = nameColour === colour.hex;

              return (
                <button
                  key={colour.id}
                  type="button"
                  onClick={() => onNameColourChange(colour.hex)}
                  aria-pressed={chosen}
                  className={`${SWATCH_CHIP} ${chosen ? 'outline-2 outline-ink' : ''}`}
                >
                  <TagMark colour={colour.hex} />
                  {colour.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-ink pt-1">
        {/* The preview is drawn through the same pair the board uses, so what an account sees here is
            what a reader sees: the swatch on the field it is standing on. `name-ink` is what picks
            between the two on `[data-theme='dark']` - see the rule in globals.css. */}
        <span
          className="name-ink text-sm font-bold"
          style={
            nameColour.length === 0
              ? undefined
              : ({ '--name-ink': nameColour, '--name-ink-dark': nameColourDark(nameColour) } as CSSProperties)
          }
        >
          {preview}
        </span>
        <span className="text-label text-ink">PREVIEW :: {nameColourLabel(nameColour)}</span>
      </div>

      {/* A select rather than a text box, and that is the whole change: a place line was a sentence
          the site could not draw, and a country is a code off the list below, which it can. */}
      <label
        className={`${CUSTOMISER_NOTE} mt-2 block`}
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

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span>
          <button type="button" onClick={onSave} disabled={busy} className={PLATE_MAIN}>
            {busy ? '[ WORKING... ]' : '[ SAVE ]'}
          </button>
        </span>
      </div>
    </div>
  );
}

export type ProfilePrivacyTabProps = {
  profile: PublicProfile;
  draft: ProfileVisibilityDraft;
  onToggle: (key: keyof ProfileVisibility, value: boolean) => void;
  onSave: () => void;
  busy: boolean;
};

/** The switches that decide what visitors get to see. */
export function ProfilePrivacyTab({ profile, draft, onToggle, onSave, busy }: ProfilePrivacyTabProps) {
  const visibility: ProfileVisibility = { ...profile.visibility, ...draft };

  // A note only where the rule is not visible from the switch, and then behind a [ ? ] (SPEC-less-text.md).
  const rows: { key: keyof ProfileVisibility; label: string; note?: string }[] = [
    {
      key: 'showTags',
      label: 'TAGS',
      note: 'TAGS ARRIVE HIDDEN. EACH TAG ALSO HAS ITS OWN SWITCH ON THE PROFILE TAB.',
    },
    {
      key: 'showProfileComments',
      label: 'PROFILE COMMENTS',
      note: 'THEY ARRIVE HIDDEN. WHILE THIS IS OFF, NOBODY CAN ADD ONE EITHER.',
    },
    { key: 'showAvatarComments', label: 'PICTURE COMMENTS' },
    { key: 'showSongComments', label: 'TRACK COMMENTS' },
  ];

  return (
    <div className="p-3">
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.key} className="rule-pixel p-2">
            <label className="flex items-start gap-2 text-label font-bold text-ink">
              <input
                type="checkbox"
                checked={visibility[row.key]}
                onChange={(event) => onToggle(row.key, event.target.checked)}
                className="mt-0.5"
              />
              <span>
                {row.label}
                {visibility[row.key] === profile.visibility[row.key] ? '' : ' *'}
              </span>
            </label>
            {row.note === undefined ? null : (
              <InfoFold topic={`the ${row.label.toLowerCase()} switch`} className="mt-1">
                {row.note}
              </InfoFold>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span>
          <button type="button" onClick={onSave} disabled={busy} className={PLATE_MAIN}>
            {busy ? '[ WORKING... ]' : '[ SAVE ]'}
          </button>
        </span>
      </div>
    </div>
  );
}
