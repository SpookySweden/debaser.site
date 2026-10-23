'use client';

import { tagColour } from '../lib/forum/tag-vocabulary';
import type { PublicProfile } from '../lib/profile/types';
import { PLATE_LARGE } from '../lib/ui/controls';
import { CUSTOMISER_NOTE } from './ProfileCustomiserOptionsTabs';
import ProfileName from './ProfileName';
import { TagMark, tagChipClasses, tagMarkColourFromColour } from './TagBadge';
import TimeStamp from './TimeStamp';

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
 * The global switch is said once, at the top (it was said at the top and again at the foot, both
 * pointing at a PRIVACY tab that is labelled SHOW / HIDE); how it works is the line's hover tip.
 */
export function ProfileTagsTab({ profile, busy, onSetHidden, onRemove, onSetAllHidden }: ProfileTagsTabProps) {
  return (
    <div className="p-3">
      <p
        className={CUSTOMISER_NOTE}
        title="EVERY TAG STARTS HIDDEN. THE SWITCH ON THE SHOW / HIDE TAB HAS TO BE ON BEFORE ANY OF THESE REACH A VISITOR."
      >
        GLOBAL TAG SWITCH (SHOW / HIDE TAB): {profile.visibility.showTags ? 'ON' : 'OFF - NO TAG REACHES A VISITOR'}
      </p>

      {profile.tags.length === 0 ? (
        <p className="mt-2 text-label font-bold text-ink">
          NO TAGS GIVEN YET. GIVE YOURSELF ONE FROM YOUR PUBLIC PROFILE PAGE, OR LET A VISITOR GIVE YOU ONE THERE.
        </p>
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
                  <span className={CUSTOMISER_NOTE}>
                    {tag.hidden ? 'HIDDEN FROM VISITORS' : 'VISIBLE TO VISITORS'}
                  </span>
                </div>

                <p className="mt-1 text-label text-ink">
                  GIVEN BY{' '}
                  <ProfileName author={tag.givenBy}>{tag.givenBy.displayName.toUpperCase()}</ProfileName> ON{' '}
                  <TimeStamp at={tag.givenAt} />
                </p>

                <div className="mt-1 flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => onSetHidden(tag.id, !tag.hidden)}
                    disabled={busy}
                    className={PLATE_LARGE}
                  >
                    {tag.hidden ? '[ SHOW THIS TAG ]' : '[ HIDE THIS TAG ]'}
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
