'use client';

import { AVATAR_ACCEPT, MAX_AVATAR_BYTES, SITE_PICTURES } from '../lib/profile/avatar-catalogue';
import type { PublicProfile } from '../lib/profile/types';
import { avatarVersionsNewestFirst, commentCountForVersion, currentAvatarVersion } from '../lib/profile/visibility';
import { FIELD, PLATE_LARGE } from '../lib/ui/controls';
import ProfileAvatar from './ProfileAvatar';
import { CUSTOMISER_NOTE } from './ProfileCustomiserOptionsTabs';
import SheetImage from './SheetImage';
import TimeStamp from './TimeStamp';
import { displayCrop, versionCrop } from '../lib/profile/avatar-crop';
import AvatarCropEditor from './AvatarCropEditor';
import ChooseFileKey from './ChooseFileKey';
import type { AvatarCrop } from '../lib/profile/avatar-crop';

export type ProfileCustomiserPictureTabProps = {
  profile: PublicProfile;
  /** Slot path or upload chosen but not yet filed as a version. */
  pendingSrc: string | null;
  /**
   * Square-ish pictures from the media catalogue (SPEC-media-catalogue.md, decision 5): what other
   * people and this account have filed, offered beside the site's own sheets. The sheets are in this
   * list too once the catalogue holds them, so a sheet is never drawn twice.
   */
  cataloguePictures?: { id: string; label: string; preview: { src: string; alt: string; width: number; height: number } }[];
  onSelectSrc: (src: string) => void;
  note: string;
  onNoteChange: (value: string) => void;
  onUpload: (file: File) => void;
  onFileVersion: () => void;
  onRestore: (versionId: string) => void;
  /** Saves the crop at once (the switch, or the square when it is let go). */
  onCropChange: (patch: Partial<AvatarCrop>) => Promise<void>;
  busy: boolean;
  uploadMessage: string | null;
};

/**
 * The picture tab: choose the drawing, describe the change, file it as a version.
 *
 * Filing never overwrites: the new drawing becomes the next version and the old
 * ones stay in the history with the comments that were written against them.
 */
export default function ProfileCustomiserPictureTab({
  profile,
  pendingSrc,
  cataloguePictures = [],
  onSelectSrc,
  note,
  onNoteChange,
  onUpload,
  onFileVersion,
  onRestore,
  onCropChange,
  busy,
  uploadMessage,
}: ProfileCustomiserPictureTabProps) {
  /** debaser.site's picture is never cut, so it has no crop to set. */
  const crop = displayCrop(profile);
  const current = currentAvatarVersion(profile);
  const versions = avatarVersionsNewestFirst(profile);
  /** The site's sheets, then the catalogue's pictures that are not those same sheets. */
  const offered = [
    ...SITE_PICTURES,
    ...cataloguePictures
      .filter((tile) => !SITE_PICTURES.some((picture) => picture.src === tile.preview.src))
      .map((tile) => ({ id: tile.id, label: tile.label, src: tile.preview.src, alt: tile.preview.alt, width: tile.preview.width, height: tile.preview.height })),
  ];
  const nextVersion = profile.avatar.versions.length + 1;

  return (
    <div className="space-y-3">
      <div className="p-3">
        <div className="flex flex-wrap items-start gap-3">
          <div>
            <p className={CUSTOMISER_NOTE}>CURRENT</p>
            <ProfileAvatar version={current} displayName={profile.displayName} size={140} crop={displayCrop(profile)} />
          </div>

          <div>
            <p className={CUSTOMISER_NOTE}>NEW</p>
            {pendingSrc === null ? (
              <div className="mt-1 flex h-[130px] w-[140px] items-center justify-center frame bg-ice-pale p-2 text-center">
                <span className="text-label font-bold text-ink">NOTHING CHOSEN</span>
              </div>
            ) : (
              <ProfileAvatar
                version={{
                  id: 'pending',
                  version: nextVersion,
                  src: pendingSrc,
                  alt: 'Pending profile picture',
                  note,
                  createdAt: new Date().toISOString(),
                }}
                displayName={profile.displayName}
                size={140}
                crop={versionCrop(profile, 'pending')}
              />
            )}
          </div>

          {/* basis-64: room to read or onto its own line (34px wide beside the two pictures on a 430px phone). */}
          {/* HOW IT WORKS is the [ ? ] under the PICTURE heading (ProfileCustomiserWindow). */}
          <div className="min-w-0 flex-1 basis-64 space-y-2">
            <p className={CUSTOMISER_NOTE}>UPLOAD (MAX {Math.round(MAX_AVATAR_BYTES / (1024 * 1024))}MB)</p>
            <ChooseFileKey
              id="customise-upload"
              accept={AVATAR_ACCEPT}
              label={`Choose a picture to upload, up to ${Math.round(MAX_AVATAR_BYTES / (1024 * 1024))}MB`}
              onChoose={onUpload}
            />
            {uploadMessage === null ? null : <p className="text-label font-bold text-ink">{uploadMessage}</p>}
          </div>
        </div>
      </div>

      <div className="p-3">
        <p className={CUSTOMISER_NOTE}>OR PICK ONE:</p>

        {offered.length === 0 ? (
          <p className="mt-2 text-label text-ink">NONE YET.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {offered.map((picture) => (
              <li key={picture.id}>
                <button
                  type="button"
                  onClick={() => onSelectSrc(picture.src)}
                  className={`flex cursor-pointer items-center gap-2 p-1 text-label ${
                    pendingSrc === picture.src
                      ? 'key key-fill [--key-fill:var(--color-ink)] text-paper'
                      : 'key'
                  }`}
                >
                  <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-none border border-ink-plate bg-paper">
                    <SheetImage
                      src={picture.src}
                      alt={picture.alt}
                      width={picture.width}
                      height={picture.height}
                      sizes="48px"
                    />
                  </span>
                  {picture.label}
                </button>
              </li>
            ))}
          </ul>
        )}

        <label className={`${CUSTOMISER_NOTE} mt-3 block`} htmlFor="customise-note">
          NOTE
        </label>
        <textarea
          id="customise-note"
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          rows={2}
          placeholder="what changed?"
          className={FIELD}
        />

        {/* The wrapper span once held a hover tip (a disabled key shows none); kept so the row lays out as before. */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span>
            <button
              type="button"
              onClick={onFileVersion}
              disabled={busy || pendingSrc === null}
              className={PLATE_LARGE}
            >
              {busy ? '[ WORKING... ]' : `[ FILE AS P${nextVersion} ]`}
            </button>
          </span>
        </div>
      </div>

      {current === undefined || crop === null || crop === undefined ? null : (
        <div className="p-3">
          <p className={CUSTOMISER_NOTE}>CROP</p>
          <div className="mt-1">
            <AvatarCropEditor src={current.src} crop={crop} onChange={onCropChange} disabled={busy} />
          </div>
        </div>
      )}

      <div className="p-3">
        <p className={CUSTOMISER_NOTE}>HISTORY</p>

        {versions.length === 0 ? (
          <p className="mt-2 text-label font-bold text-ink">NONE YET.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {versions.map((version) => (
              <li
                key={version.id}
                className="flex flex-wrap items-start gap-3 p-2"
              >
                <ProfileAvatar version={version} displayName={profile.displayName} size={80} hideVersionLabel crop={versionCrop(profile, version.id)} />

                <div className="min-w-0 flex-1 text-label text-ink">
                  <p className="font-bold">
                    P{version.version}
                    {version.id === profile.avatar.currentVersionId ? ' (CURRENT)' : ''} ::{' '}
                    <TimeStamp at={version.createdAt} /> :: {commentCountForVersion(profile, version)} COMMENTS
                  </p>
                  {version.note.length === 0 ? null : <p className="mt-1">{version.note}</p>}
                  {version.restoredFromVersion === undefined ? null : (
                    <p className="mt-1">COPIED FROM P{version.restoredFromVersion}</p>
                  )}
                </div>

                {version.id === profile.avatar.currentVersionId ? null : (
                  <button
                    type="button"
                    onClick={() => onRestore(version.id)}
                    disabled={busy}
                    className={PLATE_LARGE}
                  >
                    [ USE THIS ONE ]
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
