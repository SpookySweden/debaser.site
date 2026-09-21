'use client';

import { tagColour } from '../lib/forum/tag-vocabulary';
import type { PublicProfile } from '../lib/profile/types';
import { CUSTOMISER_BUTTON, CUSTOMISER_NOTE } from './ProfileCustomiserOptionsTabs';
import ProfileName from './ProfileName';
import { tagChipClasses, tagChipStyleFromColour } from './TagBadge';
import TimeStamp from './TimeStamp';

export type ProfileTagsTabProps = {
  profile: PublicProfile;
  busy: boolean;
  onSetHidden: (tagId: string, hidden: boolean) => void;
  onRemove: (tagId: string) => void;
  onSetAllHidden: (hidden: boolean) => void;
};

/** The tags other users gave you, and which of them visitors may see. */
export function ProfileTagsTab({ profile, busy, onSetHidden, onRemove, onSetAllHidden }: ProfileTagsTabProps) {
  return (
    <div className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] p-3">
      <p className={CUSTOMISER_NOTE}>
        GLOBAL TAG SWITCH: {profile.visibility.showTags ? 'VISIBLE' : 'HIDDEN'} (SEE THE PRIVACY TAB). EVERY TAG BELOW
        STARTS HIDDEN.
      </p>

      {profile.tags.length === 0 ? (
        <p className="mt-2 text-[10px] font-bold text-black">
          NO TAGS GIVEN YET. GIVE YOURSELF ONE FROM YOUR PUBLIC PROFILE PAGE, OR LET A VISITOR GIVE YOU ONE THERE.
        </p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-1">
            <button type="button" onClick={() => onSetAllHidden(false)} disabled={busy} className={CUSTOMISER_BUTTON}>
              [ SHOW ALL ]
            </button>
            <button type="button" onClick={() => onSetAllHidden(true)} disabled={busy} className={CUSTOMISER_BUTTON}>
              [ HIDE ALL ]
            </button>
          </div>

          <ul className="mt-2 space-y-2">
            {profile.tags.map((tag) => (
              <li key={tag.id} className="rounded-none border border-gray-500 bg-[#f0f0f0] p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={tagChipClasses({ id: tag.id, kind: 'user', label: tag.label })}
                    style={tagChipStyleFromColour(tag.colour ?? tagColour(tag.label))}
                  >
                    {tag.label}
                  </span>
                  <span className={CUSTOMISER_NOTE}>
                    {tag.hidden ? '[ HIDDEN FROM VISITORS ]' : '[ VISIBLE TO VISITORS ]'}
                  </span>
                </div>

                <p className="mt-1 text-[10px] text-gray-700">
                  GIVEN BY{' '}
                  <ProfileName author={tag.givenBy}>{tag.givenBy.displayName.toUpperCase()}</ProfileName> ON{' '}
                  <TimeStamp at={tag.givenAt} />
                </p>

                <div className="mt-1 flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => onSetHidden(tag.id, !tag.hidden)}
                    disabled={busy}
                    className={CUSTOMISER_BUTTON}
                  >
                    {tag.hidden ? '[ SHOW THIS TAG ]' : '[ HIDE THIS TAG ]'}
                  </button>
                  <button type="button" onClick={() => onRemove(tag.id)} disabled={busy} className={CUSTOMISER_BUTTON}>
                    [ REMOVE ]
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-2 text-[10px] text-gray-700">
        THE GLOBAL SWITCH IN THE PRIVACY TAB HAS TO BE ON BEFORE ANY OF THESE REACH A VISITOR
        {profile.visibility.showTags ? '' : ' - IT IS OFF RIGHT NOW'}.
      </p>
    </div>
  );
}
