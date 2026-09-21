'use client';

import { LOW_CONTRAST_NAME_COLOURS, NAME_COLOURS, nameColourLabel } from '../lib/profile/name-colours';
import { MAX_BIO_LENGTH } from '../lib/profile/types';
import type { ProfileVisibility, PublicProfile } from '../lib/profile/types';

/** Shared Win95 field styling for the customiser tabs. */
export const CUSTOMISER_FIELD =
  'mt-1 w-full rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-2 font-mono text-xs text-black outline-none';

export const CUSTOMISER_BUTTON =
  'cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-3 py-1 text-xs font-bold text-black hover:bg-gray-300 disabled:cursor-wait disabled:opacity-60';

export const CUSTOMISER_NOTE = 'text-[10px] font-bold text-black';

export type ProfileVisibilityDraft = Partial<ProfileVisibility>;

export type ProfileIdentityTabProps = {
  profile: PublicProfile;
  name: string;
  bio: string;
  location: string;
  /** Swatch hex for the username, or '' for the default black. */
  nameColour: string;
  onNameChange: (value: string) => void;
  onBioChange: (value: string) => void;
  onLocationChange: (value: string) => void;
  onNameColourChange: (hex: string) => void;
  onSave: () => void;
  busy: boolean;
  bioProblem: string | undefined;
  locationProblem: string | undefined;
};

/** Public name, its colour, place line and bio: the text half of the public face. */
export function ProfileIdentityTab({
  profile,
  name,
  bio,
  location,
  nameColour,
  onNameChange,
  onBioChange,
  onLocationChange,
  onNameColourChange,
  onSave,
  busy,
  bioProblem,
  locationProblem,
}: ProfileIdentityTabProps) {
  const preview = name.trim().length === 0 ? profile.displayName : name;

  return (
    <div className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] p-3">
      <label htmlFor="customise-name" className={CUSTOMISER_NOTE}>
        PUBLIC NAME: SIGNS YOUR PROFILE PAGE AND YOUR ACCOUNT
      </label>
      <input
        id="customise-name"
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
        placeholder={profile.displayName}
        className={CUSTOMISER_FIELD}
      />

      <p className={`${CUSTOMISER_NOTE} mt-2`}>NAME COLOUR: PICK ONE OF THE SIXTEEN SWATCHES</p>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {NAME_COLOURS.map((colour) => {
          const chosen = nameColour === colour.hex;

          return (
            <button
              key={colour.id}
              type="button"
              onClick={() => onNameColourChange(colour.hex)}
              aria-pressed={chosen}
              title={
                LOW_CONTRAST_NAME_COLOURS.includes(colour.hex)
                  ? `${colour.label} - HARD TO READ ON THE WHITE PAGES`
                  : colour.label
              }
              style={{ backgroundColor: colour.hex }}
              className={`h-6 w-6 shrink-0 cursor-pointer rounded-none border border-black ${
                chosen ? 'outline-2 outline-black' : 'hover:outline-1 hover:outline-gray-600'
              }`}
            />
          );
        })}

        <span
          className="ml-2 text-xs font-bold"
          style={nameColour.length === 0 ? undefined : { color: nameColour }}
        >
          {preview}
        </span>
      </div>
      <p className="mt-1 text-[10px] text-gray-700">
        PREVIEW :: {nameColourLabel(nameColour)}. WHITE, SILVER, LIME AND YELLOW SIT CLOSE TO THE PAGE
        BACKGROUND - PICK ONE OF THOSE AND THE NAME IS MEANT TO BE HARD TO READ.
      </p>

      <label className={`${CUSTOMISER_NOTE} mt-2 block`} htmlFor="customise-location">
        PLACE LINE: SHOWN NEXT TO YOUR NAME ON YOUR POSTS (LEAVE EMPTY TO HIDE IT)
      </label>
      <input
        id="customise-location"
        value={location}
        onChange={(event) => onLocationChange(event.target.value)}
        placeholder="e.g. Sweden"
        className={CUSTOMISER_FIELD}
      />
      {locationProblem === undefined ? null : (
        <p className="mt-1 text-[10px] font-bold text-[#800000]">{locationProblem}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <label htmlFor="customise-bio" className={CUSTOMISER_NOTE}>
          BIO: SHOWN AT THE TOP OF YOUR PUBLIC PROFILE
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
        className={CUSTOMISER_FIELD}
      />
      {bioProblem === undefined ? null : <p className="mt-1 text-[10px] font-bold text-[#800000]">{bioProblem}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onSave} disabled={busy} className={CUSTOMISER_BUTTON}>
          {busy ? '[ WORKING... ]' : '[ SAVE NAME, COLOUR AND BIO ]'}
        </button>
        <p className="text-[10px] text-gray-700">
          THE NAME IS PUSHED TO YOUR ACCOUNT TOO, SO POSTS AND THE PROFILE AGREE.
        </p>
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

  const rows: { key: keyof ProfileVisibility; label: string; note: string }[] = [
    {
      key: 'showTags',
      label: 'SHOW THE TAGS OTHER USERS GAVE ME',
      note: 'ARRIVES HIDDEN. EACH TAG ALSO HAS ITS OWN SWITCH IN THE TAGS TAB.',
    },
    {
      key: 'showProfileComments',
      label: 'SHOW COMMENTS LEFT ON MY PROFILE',
      note: 'ARRIVES HIDDEN. WHILE IT IS OFF NOBODY CAN ADD ONE EITHER.',
    },
    {
      key: 'showAvatarComments',
      label: 'SHOW COMMENTS LEFT ON MY PICTURE',
      note: 'ON BY DEFAULT - EVERY COMMENT KEEPS THE VERSION IT WAS WRITTEN AGAINST.',
    },
  ];

  return (
    <div className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] p-3">
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.key} className="rounded-none border border-gray-500 bg-[#f0f0f0] p-2">
            <label className="flex items-start gap-2 text-[10px] font-bold text-black">
              <input
                type="checkbox"
                checked={visibility[row.key]}
                onChange={(event) => onToggle(row.key, event.target.checked)}
                className="mt-[2px]"
              />
              <span>
                {row.label}
                <span className="mt-1 block font-normal text-gray-700">{row.note}</span>
              </span>
            </label>
            <p className="mt-1 text-[10px] text-gray-700">
              CURRENTLY: {visibility[row.key] ? 'VISIBLE TO VISITORS' : 'HIDDEN FROM VISITORS'}
              {visibility[row.key] === profile.visibility[row.key] ? '' : ' :: UNSAVED CHANGE'}
            </p>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onSave} disabled={busy} className={CUSTOMISER_BUTTON}>
          {busy ? '[ WORKING... ]' : '[ SAVE PRIVACY ]'}
        </button>
        <p className="text-[10px] text-gray-700">PRIVACY SETTINGS APPLY THE MOMENT THEY ARE SAVED.</p>
      </div>
    </div>
  );
}
