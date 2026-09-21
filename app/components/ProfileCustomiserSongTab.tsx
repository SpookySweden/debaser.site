'use client';

import { MUSIC_ACCEPT, MAX_TRACK_BYTES } from '../lib/audio/catalogue';
import type { PublicProfile } from '../lib/profile/types';
import { commentCountForSongVersion, currentSongVersion, songVersionsNewestFirst } from '../lib/profile/visibility';
import { FIELD, PLATE_LARGE } from '../lib/ui/controls';
import { CUSTOMISER_NOTE } from './ProfileCustomiserOptionsTabs';
import TimeStamp from './TimeStamp';

export type ProfileCustomiserSongTabProps = {
  profile: PublicProfile;
  /** Uploaded (or chosen) but not yet filed as a version. */
  pendingSrc: string | null;
  title: string;
  credit: string;
  note: string;
  onTitleChange: (value: string) => void;
  onCreditChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onUpload: (file: File) => void;
  onFileVersion: () => void;
  onRestore: (versionId: string) => void;
  busy: boolean;
  uploadMessage: string | null;
};

/**
 * The track tab: choose the audio, say what it is, file it as a version (`M1`, `M2`, ...).
 *
 * The twin of the picture tab, one shelf over. Filing never overwrites: the new track
 * becomes the next version and the older ones stay in the history with the comments
 * that were written against them - which is what lets a note about a rough mix keep
 * pointing at the rough mix.
 *
 * The file itself goes to the `mp3` bucket (or the project's own `assets/audio/` when
 * the mock store is in use), so the music shelf and the profile player both reach it.
 */
export default function ProfileCustomiserSongTab({
  profile,
  pendingSrc,
  title,
  credit,
  note,
  onTitleChange,
  onCreditChange,
  onNoteChange,
  onUpload,
  onFileVersion,
  onRestore,
  busy,
  uploadMessage,
}: ProfileCustomiserSongTabProps) {
  const current = currentSongVersion(profile);
  const versions = songVersionsNewestFirst(profile);
  const nextVersion = profile.song.versions.length + 1;

  return (
    <div className="space-y-3">
      <div className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] p-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="w-64">
            <p className={CUSTOMISER_NOTE}>ON THE PAGE NOW</p>
            <div className="mt-1 rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-black px-2 py-1">
              <p className="truncate text-[11px] font-bold text-[#33ff33]">
                {current === undefined ? 'NOTHING FILED YET' : current.title}
              </p>
              <p className="mt-1 truncate text-[9px] text-[#1f9f1f]">
                {current === undefined ? 'THE PROFILE SHOWS AN EMPTY TRACK SLOT' : `V${current.version}`}
              </p>
            </div>
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <p className={CUSTOMISER_NOTE}>WAITING TO BE FILED</p>
            <p className="text-[10px] text-black">
              {pendingSrc === null ? 'NO AUDIO CHOSEN YET.' : `READY: ${pendingSrc}`}
            </p>

            <label className={`${CUSTOMISER_NOTE} block`} htmlFor="customise-song-upload">
              UPLOAD A TRACK (MP3 / M4A / OGG / WAV / FLAC, UP TO {Math.round(MAX_TRACK_BYTES / (1024 * 1024))}MB):
            </label>
            <input
              id="customise-song-upload"
              type="file"
              accept={MUSIC_ACCEPT}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file !== undefined) onUpload(file);
              }}
              className="mt-1 block w-full cursor-pointer rounded-none border border-gray-500 bg-white p-1 text-[10px] font-bold text-black"
            />

            {uploadMessage === null ? null : <p className="text-[10px] font-bold text-black">{uploadMessage}</p>}

            <label className={`${CUSTOMISER_NOTE} block`} htmlFor="customise-song-title">
              TITLE
            </label>
            <input
              id="customise-song-title"
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder="e.g. WARD THEME"
              className={FIELD}
            />

            <label className={`${CUSTOMISER_NOTE} block`} htmlFor="customise-song-credit">
              CREDITED TO (EMPTY MEANS YOUR NAME)
            </label>
            <input
              id="customise-song-credit"
              value={credit}
              onChange={(event) => onCreditChange(event.target.value)}
              placeholder={profile.displayName}
              className={FIELD}
            />

            <label className={`${CUSTOMISER_NOTE} block`} htmlFor="customise-song-note">
              WHAT IS IT? (KEPT AS THE NOTE FOR THIS VERSION)
            </label>
            <textarea
              id="customise-song-note"
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
              rows={2}
              placeholder="e.g. the rough mix that goes with issue three"
              className={FIELD}
            />

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onFileVersion}
                disabled={busy || pendingSrc === null || title.trim().length === 0}
                className={PLATE_LARGE}
              >
                {busy ? '[ WORKING... ]' : `[ FILE AS M${nextVersion} ]`}
              </button>
              <p className="text-[10px] text-gray-700">THE PROFILE CHANGES THE MOMENT IT IS FILED.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] p-3">
        <p className={CUSTOMISER_NOTE}>TRACK HISTORY ({versions.length} VERSIONS) :: APPEND ONLY</p>

        {versions.length === 0 ? (
          <p className="mt-2 text-[10px] font-bold text-black">NOTHING HAS EVER BEEN FILED.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {versions.map((version) => (
              <li
                key={version.id}
                className="flex flex-wrap items-start gap-3 rounded-none border border-gray-500 bg-[#f0f0f0] p-2"
              >
                <div className="min-w-0 flex-1 text-[10px] text-black">
                  <p className="font-bold">
                    M{version.version}
                    {version.id === profile.song.currentVersionId ? ' [ CURRENT ]' : ''} :: {version.title} ::{' '}
                    <TimeStamp at={version.createdAt} /> :: {commentCountForSongVersion(profile, version)} COMMENTS
                  </p>
                  {version.note.length === 0 ? null : <p className="mt-1">{version.note}</p>}
                  {version.restoredFromVersion === undefined ? null : (
                    <p className="mt-1">COPIED FROM M{version.restoredFromVersion}</p>
                  )}
                  <p className="mt-1 truncate text-gray-700">{version.src}</p>
                </div>

                {version.id === profile.song.currentVersionId ? null : (
                  <button
                    type="button"
                    onClick={() => onRestore(version.id)}
                    disabled={busy}
                    className={PLATE_LARGE}
                    title="Files a new version that copies this track"
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
