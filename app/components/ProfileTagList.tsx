'use client';

import { useState } from 'react';
import { authorLabel } from '../lib/auth/author';
import { tagColour } from '../lib/forum/tag-vocabulary';
import type { ForumAuthor } from '../lib/forum/types';
import type { GivenTag, ProfileRepository, PublicProfile } from '../lib/profile/types';
import {
  approvedTags,
  canGiveTag,
  isSelfGivenTag,
  pendingTags,
  TAGS_BEFORE_EXPANDING,
  validateTagLabel,
} from '../lib/profile/visibility';
import ProfileName from './ProfileName';
import { tagChipClasses, tagChipStyleFromColour } from './TagBadge';

const BUTTON =
  'cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-2 py-[2px] text-[10px] font-bold text-black hover:bg-gray-300 disabled:cursor-wait disabled:opacity-60';

const FIELD =
  'rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-1 text-xs text-black outline-none';

type ProfileTagListProps = {
  profile: PublicProfile;
  repository: ProfileRepository;
  /** The viewer, or the guest author: anybody may give a tag. */
  viewer: ForumAuthor;
  /** Owner view: waiting tags are listed with their approval buttons. */
  owner: boolean;
};

/**
 * The profile's tags, listed under the details they belong with.
 *
 * A tag is not shown until the owner approves it - `hidden` in the store is that
 * flag, which is what the column has always meant (see app/lib/profile/visibility.ts).
 * Two things follow from the rules there:
 *
 *   - the house account's tags arrive approved, because the admin does not wait on
 *     an approval, and may give as many as they like;
 *   - the owner may show exactly one tag they gave themselves: approving a second
 *     one retires the first, which the store does rather than this list.
 *
 * A few tags are listed and the rest are behind `[ SHOW ALL ]`, and the box for
 * giving one lives behind its own `[ ADD TAG ]`, so a profile with a great many
 * tags does not push the rest of the page around.
 */
export default function ProfileTagList({ profile, repository, viewer, owner }: ProfileTagListProps) {
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const approved = approvedTags(profile);
  const waiting = pendingTags(profile);
  // A visitor only sees what is switched on and approved; the owner sees everything,
  // because they are the one doing the approving.
  const listed = owner ? [...waiting, ...approved] : profile.visibility.showTags ? approved : [];
  const shown = expanded ? listed : listed.slice(0, TAGS_BEFORE_EXPANDING);

  async function run(action: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setError(null);
    setStatus(null);

    try {
      await action();
      setStatus(ok);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'UNKNOWN ERROR');
    } finally {
      setBusy(false);
    }
  }

  async function give() {
    const problem = validateTagLabel(label);
    if (problem !== undefined) {
      setError(problem);
      setStatus(null);
      return;
    }

    await run(
      () =>
        repository.giveTag(profile.userId, {
          label: label.trim().toUpperCase(),
          givenBy: viewer,
          colour: tagColour(label),
        }),
      owner
        ? 'TAG GIVEN - APPROVE IT WHEN YOU WANT IT SHOWN.'
        : 'TAG GIVEN - THE OWNER DECIDES WHETHER IT SHOWS.',
    );
    setLabel('');
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <span className="text-[10px] font-bold">
          TAGS :: {approved.length} SHOWING
          {owner && waiting.length > 0 ? ` :: ${waiting.length} WAITING` : ''}
          {!owner && !profile.visibility.showTags ? ' :: SWITCHED OFF' : ''}
        </span>

        {canGiveTag(owner, profile.visibility) ? (
          <button type="button" onClick={() => setAdding(!adding)} disabled={busy} className={BUTTON}>
            {adding ? '[ CANCEL ]' : '[ ADD TAG ]'}
          </button>
        ) : null}
      </div>

      {shown.length === 0 ? (
        <p className="text-[10px] text-gray-700">
          {owner
            ? 'NOBODY HAS GIVEN YOU A TAG YET. YOU CAN GIVE YOURSELF ONE, BUT ONLY ONE OF YOUR OWN SHOWS AT A TIME.'
            : 'NO TAGS TO SHOW.'}
        </p>
      ) : (
        <ul className="space-y-1">
          {shown.map((tag: GivenTag) => (
            <li key={tag.id} className="flex flex-wrap items-center gap-1 text-[10px] font-bold">
              <span
                className={`${tagChipClasses({ id: tag.id, kind: 'user', label: tag.label })} ${
                  tag.hidden ? 'opacity-60' : ''
                }`}
                style={tagChipStyleFromColour(tag.colour ?? tagColour(tag.label))}
              >
                {tag.label}
              </span>

              {tag.hidden ? <span className="border border-black bg-[#800000] px-1 text-white">[ WAITING ]</span> : null}

              <span className="text-gray-700">
                {isSelfGivenTag(tag, profile.userId) ? (
                  'YOURS'
                ) : (
                  <>
                    FROM{' '}
                    <ProfileName author={tag.givenBy} lamp={false}>
                      {authorLabel(tag.givenBy)}
                    </ProfileName>
                  </>
                )}
              </span>

              {/* Only the owner approves, and only the owner can clear their page. */}
              {owner ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      void run(
                        () => repository.setTagVisibility(profile.userId, tag.id, !tag.hidden),
                        tag.hidden ? 'TAG APPROVED - VISITORS CAN SEE IT NOW.' : 'TAG TAKEN BACK OFF THE PAGE.',
                      )
                    }
                    disabled={busy}
                    className={BUTTON}
                  >
                    {tag.hidden ? '[ APPROVE ]' : '[ HIDE ]'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void run(() => repository.removeTag(profile.userId, tag.id), 'TAG REMOVED.')}
                    disabled={busy}
                    className={BUTTON}
                  >
                    [ REMOVE ]
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {listed.length > TAGS_BEFORE_EXPANDING ? (
        <button type="button" onClick={() => setExpanded(!expanded)} className={BUTTON}>
          {expanded ? '[ SHOW FEWER ]' : `[ SHOW ALL ${listed.length} TAGS ]`}
        </button>
      ) : null}

      {adding ? (
        <div className="space-y-1 border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-2">
          <label htmlFor={`give-tag-${profile.userId}`} className="block text-[10px] font-bold text-black">
            {owner ? 'GIVE YOUR OWN PROFILE A TAG:' : 'GIVE THIS PROFILE A TAG:'}
          </label>

          <div className="flex flex-wrap items-center gap-1">
            <input
              id={`give-tag-${profile.userId}`}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="e.g. LORE KEEPER"
              className={`${FIELD} w-44`}
            />
            <button type="button" onClick={() => void give()} disabled={busy} className={BUTTON}>
              {busy ? '[ WORKING... ]' : '[ GIVE TAG ]'}
            </button>
          </div>

          <p className="text-[10px] text-gray-700">
            {owner
              ? 'YOUR OWN TAGS WAIT FOR YOUR APPROVAL TOO, AND ONLY ONE OF THEM SHOWS AT A TIME.'
              : 'TAGS WAIT UNTIL THE OWNER APPROVES THEM. THE HOUSE ACCOUNT DOES NOT HAVE TO WAIT.'}
          </p>
        </div>
      ) : null}

      {error === null ? null : <p className="text-[10px] font-bold text-[#800000]">{error}</p>}
      {status === null ? null : <p className="text-[10px] font-bold text-black">{status}</p>}
    </div>
  );
}
