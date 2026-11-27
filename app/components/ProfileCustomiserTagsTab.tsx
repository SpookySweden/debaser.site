'use client';

import { tagColour } from '../lib/forum/tag-vocabulary';
import type { PublicProfile } from '../lib/profile/types';
import { PLATE_LARGE } from '../lib/ui/controls';
import { CUSTOMISER_NOTE } from './ProfileCustomiserOptionsTabs';
import ProfileName from './ProfileName';
import { TagMark, tagChipClasses, tagMarkColourFromColour } from './TagBadge';
import { explain, NOTE } from '../lib/ui/explain';

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
 * The global switch (the PRIVACY tab's) is said once, at the top, and only when it is hiding them.
 * Each tag's own key says what it will do, so there is no visible/hidden readback beside it.
 */
export function ProfileTagsTab({ profile, busy, onSetHidden, onRemove, onSetAllHidden }: ProfileTagsTabProps) {
  return (
    <div className="p-3">
      {profile.visibility.showTags ? null : <p className={`${CUSTOMISER_NOTE} mb-2`}>HIDDEN FROM VISITORS</p>}

      {profile.tags.length === 0 ? (
        <p className="text-label font-bold text-ink">NONE YET.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1">
            <button type="button" onClick={() => onSetAllHidden(false)} disabled={busy} className={PLATE_LARGE} {...explain('Shows every tag people gave you on your profile.', 'Saved at once. The TAGS switch in PRIVACY still hides them all while it is off.', NOTE.others)}>
              [ SHOW ALL ]
            </button>
            <button type="button" onClick={() => onSetAllHidden(true)} disabled={busy} className={PLATE_LARGE} {...explain('Hides every tag people gave you from your profile.', 'Saved at once. The tags stay here, and SHOW brings any back.')}>
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
                    {...explain(tag.hidden ? 'Shows this tag on your profile.' : 'Hides this tag from your profile; it stays here.', 'Saved at once.')}
                  >
                    {tag.hidden ? '[ SHOW ]' : '[ HIDE ]'}
                  </button>
                  <button type="button" onClick={() => onRemove(tag.id)} disabled={busy} className={PLATE_LARGE} {...explain('Removes this tag from your profile altogether.', 'To get it back, somebody would have to give it again.', NOTE.undo)}>
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
