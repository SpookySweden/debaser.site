'use client';

import { AVATAR_ACCEPT, MAX_AVATAR_BYTES, SITE_PICTURES } from '../lib/profile/avatar-catalogue';
import type { PublicProfile } from '../lib/profile/types';
import { avatarVersionsNewestFirst, commentCountForVersion, currentAvatarVersion } from '../lib/profile/visibility';
import ProfileAvatar from './ProfileAvatar';
import { CUSTOMISER_BUTTON, CUSTOMISER_FIELD, CUSTOMISER_NOTE } from './ProfileCustomiserOptionsTabs';
import SheetImage from './SheetImage';
import TimeStamp from './TimeStamp';

export type ProfileCustomiserPictureTabProps = {
  profile: PublicProfile;
  /** Slot path or upload chosen but not yet filed as a version. */
  pendingSrc: string | null;
  onSelectSrc: (src: string) => void;
  note: string;
  onNoteChange: (value: string) => void;
  onUpload: (file: File) => void;
  onFileVersion: () => void;
  onRestore: (versionId: string) => void;
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
  onSelectSrc,
  note,
  onNoteChange,
  onUpload,
  onFileVersion,
  onRestore,
  busy,
  uploadMessage,
}: ProfileCustomiserPictureTabProps) {
  const current = currentAvatarVersion(profile);
  const versions = avatarVersionsNewestFirst(profile);
  const nextVersion = profile.avatar.versions.length + 1;

  return (
    <div className="space-y-3">
      <div className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] p-3">
        <div className="flex flex-wrap items-start gap-3">
          <div>
            <p className={CUSTOMISER_NOTE}>ON THE PAGE NOW</p>
            <ProfileAvatar version={current} displayName={profile.displayName} size={140} />
          </div>

          <div>
            <p className={CUSTOMISER_NOTE}>WAITING TO BE FILED</p>
            {pendingSrc === null ? (
              <div className="mt-1 flex h-[130px] w-[140px] items-center justify-center rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-[#f0f0f0] p-2 text-center">
                <span className="text-[10px] font-bold text-black">NOTHING CHOSEN</span>
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
              />
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <p className={CUSTOMISER_NOTE}>HOW IT WORKS</p>
            <p className="text-[10px] text-black">
              CHOOSE A PICTURE, SAY WHAT CHANGED, THEN FILE IT AS V{nextVersion}. THE OLD ONE STAYS IN THE HISTORY
              BELOW, TOGETHER WITH THE COMMENTS WRITTEN AGAINST IT.
            </p>

            <label className={`${CUSTOMISER_NOTE} block`} htmlFor="customise-upload">
              UPLOAD A PICTURE (PNG / JPG / WEBP / GIF, UP TO {Math.round(MAX_AVATAR_BYTES / (1024 * 1024))}MB):
            </label>
            <input
              id="customise-upload"
              type="file"
              accept={AVATAR_ACCEPT}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file !== undefined) onUpload(file);
              }}
              className="block w-full font-mono text-[10px] text-black"
            />
            {uploadMessage === null ? null : <p className="text-[10px] font-bold text-black">{uploadMessage}</p>}
          </div>
        </div>
      </div>

      <div className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] p-3">
        <p className={CUSTOMISER_NOTE}>OR PICK ONE OF THE PICTURES ALREADY ON THE SITE:</p>

        {SITE_PICTURES.length === 0 ? (
          <p className="mt-2 text-[10px] text-gray-700">
            NONE OF THE DRAWINGS ON THE SITE IS THE RIGHT SHAPE FOR A PROFILE PICTURE YET.
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {SITE_PICTURES.map((picture) => (
              <li key={picture.id}>
                <button
                  type="button"
                  onClick={() => onSelectSrc(picture.src)}
                  className={`flex cursor-pointer items-center gap-2 rounded-none border-2 p-1 text-[10px] font-bold ${
                    pendingSrc === picture.src
                      ? 'border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-[#000080] text-white'
                      : 'border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] text-black hover:bg-gray-300'
                  }`}
                  title={picture.src}
                >
                  <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-none border border-black bg-white">
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
          WHAT CHANGED? (KEPT AS THE NOTE FOR THIS VERSION)
        </label>
        <textarea
          id="customise-note"
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          rows={2}
          placeholder="e.g. reworked the eyes after the third read-through"
          className={CUSTOMISER_FIELD}
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onFileVersion}
            disabled={busy || pendingSrc === null}
            className={CUSTOMISER_BUTTON}
          >
            {busy ? '[ WORKING... ]' : `[ FILE AS V${nextVersion} ]`}
          </button>
          <p className="text-[10px] text-gray-700">THE PAGE CHANGES THE MOMENT IT IS FILED.</p>
        </div>
      </div>

      <div className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] p-3">
        <p className={CUSTOMISER_NOTE}>HISTORY ({versions.length} VERSIONS) :: APPEND ONLY</p>

        {versions.length === 0 ? (
          <p className="mt-2 text-[10px] font-bold text-black">NO PICTURE HAS EVER BEEN FILED.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {versions.map((version) => (
              <li
                key={version.id}
                className="flex flex-wrap items-start gap-3 rounded-none border border-gray-500 bg-[#f0f0f0] p-2"
              >
                <ProfileAvatar version={version} displayName={profile.displayName} size={80} hideVersionLabel />

                <div className="min-w-0 flex-1 text-[10px] text-black">
                  <p className="font-bold">
                    V{version.version}
                    {version.id === profile.avatar.currentVersionId ? ' [ CURRENT ]' : ''} ::{' '}
                    <TimeStamp at={version.createdAt} /> :: {commentCountForVersion(profile, version)} COMMENTS
                  </p>
                  {version.note.length === 0 ? null : <p className="mt-1">{version.note}</p>}
                  {version.restoredFromVersion === undefined ? null : (
                    <p className="mt-1">COPIED FROM V{version.restoredFromVersion}</p>
                  )}
                </div>

                {version.id === profile.avatar.currentVersionId ? null : (
                  <button
                    type="button"
                    onClick={() => onRestore(version.id)}
                    disabled={busy}
                    className={CUSTOMISER_BUTTON}
                    title="Files a new version that copies this drawing"
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
