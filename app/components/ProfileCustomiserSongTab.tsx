'use client';

import { MUSIC_ACCEPT, MAX_TRACK_BYTES } from '../lib/audio/catalogue';
import type { PublicProfile } from '../lib/profile/types';
import { commentCountForSongVersion, currentSongVersion, songVersionsNewestFirst } from '../lib/profile/visibility';
import { FIELD, PLATE_LARGE } from '../lib/ui/controls';
import { CUSTOMISER_NOTE } from './ProfileCustomiserOptionsTabs';
import ChooseFileKey from './ChooseFileKey';
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
      <div className="p-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="w-64">
            <p className={CUSTOMISER_NOTE}>CURRENT</p>
            <div className="mt-1 frame bg-hardware px-2 py-1">
              <p className="truncate text-key font-bold text-acid">
                {current === undefined ? 'NONE YET' : current.title}
              </p>
              {/* On the Black readout, so the bar ink: the quiet ink is Nigrosine here, 1.18:1 on Black.
                  Only the version line: an empty slot is the one line above. M, as in the history below. */}
              {current === undefined ? null : (
                <p className="mt-1 text-label text-ink-bar">{`M${current.version}`}</p>
              )}
            </div>
          </div>

          {/* basis-64: at least as wide as the readout or onto its own line. With no basis the column
              never wrapped, and on a phone it sat beside the readout 30px wide. */}
          <div className="min-w-0 flex-1 basis-64 space-y-2">
            <p className={CUSTOMISER_NOTE}>NEW</p>
            <p className="text-label text-ink">
              {pendingSrc === null ? 'NOTHING CHOSEN.' : `READY: ${pendingSrc}`}
            </p>

            <p className={CUSTOMISER_NOTE}>UPLOAD (MAX {Math.round(MAX_TRACK_BYTES / (1024 * 1024))}MB)</p>
            <ChooseFileKey
              id="customise-song-upload"
              accept={MUSIC_ACCEPT}
              label={`Choose a track to upload, up to ${Math.round(MAX_TRACK_BYTES / (1024 * 1024))}MB`}
              onChoose={onUpload}
            />

            {uploadMessage === null ? null : <p className="text-label font-bold text-ink">{uploadMessage}</p>}

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
              CREDIT
            </label>
            <input
              id="customise-song-credit"
              value={credit}
              onChange={(event) => onCreditChange(event.target.value)}
              placeholder={profile.displayName}
              className={FIELD}
            />

            <label className={`${CUSTOMISER_NOTE} block`} htmlFor="customise-song-note">
              NOTE
            </label>
            <textarea
              id="customise-song-note"
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
              rows={2}
              placeholder="what is it?"
              className={FIELD}
            />

            {/* The wrapper span once held a hover tip (a disabled key shows none); kept so the row lays out as before. */}
            <div className="flex flex-wrap items-center gap-2">
              <span>
                <button
                  type="button"
                  onClick={onFileVersion}
                  disabled={busy || pendingSrc === null || title.trim().length === 0}
                  className={PLATE_LARGE}
                >
                  {busy ? '[ WORKING... ]' : `[ FILE AS M${nextVersion} ]`}
                </button>
              </span>
            </div>
          </div>
        </div>
      </div>

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
                <div className="min-w-0 flex-1 text-label text-ink">
                  <p className="font-bold">
                    M{version.version}
                    {version.id === profile.song.currentVersionId ? ' (CURRENT)' : ''} :: {version.title} ::{' '}
                    <TimeStamp at={version.createdAt} /> :: {commentCountForSongVersion(profile, version)} COMMENTS
                  </p>
                  {version.note.length === 0 ? null : <p className="mt-1">{version.note}</p>}
                  {version.restoredFromVersion === undefined ? null : (
                    <p className="mt-1">COPIED FROM M{version.restoredFromVersion}</p>
                  )}
                </div>

                {version.id === profile.song.currentVersionId ? null : (
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
