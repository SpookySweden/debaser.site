'use client';

import { tagColour } from '../lib/forum/tag-vocabulary';
import type { PublicProfile } from '../lib/profile/types';
import { PLATE_LARGE } from '../lib/ui/controls';
import { CUSTOMISER_NOTE } from './ProfileCustomiserOptionsTabs';
import ProfileName from './ProfileName';
import { TagMark, tagChipClasses, tagMarkColourFromColour } from './TagBadge';

export type ProfileTagsTabProps = {
  profile: PublicProfile;
  busy: boolean;
  onSetHidden: (tagId: string, hidden: boolean) => void;
  onRemove: (tagId: string) => void;
  onSetAllHidden: (hidden: boolean) => void;
};

/**
 * The tags other users gave you, and which of them visitors may see.
 *
 * The global switch is said once, at the top, as the tab and switch it names (SHOW / HIDE, TAGS).
 * Each tag's own key says what it will do, so there is no visible/hidden readback beside it.
 */
export function ProfileTagsTab({ profile, busy, onSetHidden, onRemove, onSetAllHidden }: ProfileTagsTabProps) {
  return (
    <div className="p-3">
      <p className={CUSTOMISER_NOTE}>SHOW / HIDE :: TAGS: {profile.visibility.showTags ? 'ON' : 'OFF'}</p>

      {profile.tags.length === 0 ? (
        <p className="mt-2 text-label font-bold text-ink">NONE YET.</p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-1">
            <button type="button" onClick={() => onSetAllHidden(false)} disabled={busy} className={PLATE_LARGE}>
              [ SHOW ALL ]
            </button>
            <button type="button" onClick={() => onSetAllHidden(true)} disabled={busy} className={PLATE_LARGE}>
              [ HIDE ALL ]
            </button>
          </div>

          <ul className="mt-2 space-y-2">
            {profile.tags.map((tag) => (
              <li key={tag.id} className="rule-pixel p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={tagChipClasses({ id: tag.id, kind: 'user', label: tag.label })}>
                    <TagMark colour={tagMarkColourFromColour(tag.colour ?? tagColour(tag.label))} />
                    {tag.label}
                  </span>
                </div>

                <p className="mt-1 text-label text-ink">
                  FROM <ProfileName author={tag.givenBy}>{tag.givenBy.displayName.toUpperCase()}</ProfileName>
                </p>

                <div className="mt-1 flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => onSetHidden(tag.id, !tag.hidden)}
                    disabled={busy}
                    className={PLATE_LARGE}
                  >
                    {tag.hidden ? '[ SHOW ]' : '[ HIDE ]'}
                  </button>
                  <button type="button" onClick={() => onRemove(tag.id)} disabled={busy} className={PLATE_LARGE}>
                    [ REMOVE ]
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
