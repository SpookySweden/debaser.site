'use client';

import type { ForumAuthor } from '../lib/forum/types';
import type { ProfileRepository, PublicProfile } from '../lib/profile/types';
import {
  currentSongVersion,
  songAsPlayerTrack,
  songVersionById,
  songVersionsNewestFirst,
} from '../lib/profile/visibility';
import { useMusicPlayer } from './MusicPlayerProvider';
import PopoutWindow from './PopoutWindow';
import ProfileCommentBox from './ProfileCommentBox';

const BUTTON =
  'cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-2 py-[2px] text-[10px] font-bold text-black hover:bg-gray-300 disabled:cursor-wait disabled:opacity-60';

type ProfileSongCommentWindowProps = {
  profile: PublicProfile;
  repository: ProfileRepository;
  /** Who the comment is filed under. */
  viewer: ForumAuthor;
  owner: boolean;
  /** The version on screen, which is the one being commented on. */
  selectedId: string;
  /** Picking another version switches the track *and* the page behind the window. */
  onSelect: (versionId: string) => void;
  onClose: () => void;
};

/**
 * Commenting on the account's track, in a window of its own.
 *
 * The track stays on screen while you type - and it can be played from here, through
 * the site's own player - and choosing another version from the list switches both the
 * track and the thread, so a comment can never end up under the wrong mix.
 */
export default function ProfileSongCommentWindow({
  profile,
  repository,
  viewer,
  owner,
  selectedId,
  onSelect,
  onClose,
}: ProfileSongCommentWindowProps) {
  const player = useMusicPlayer();
  const versions = songVersionsNewestFirst(profile);
  const selected = songVersionById(profile, selectedId) ?? currentSongVersion(profile);

  // Nothing to comment on: the window closes itself rather than showing an empty frame.
  if (selected === undefined) return null;

  const isCurrent = selected.id === profile.song.currentVersionId;
  const playing = player.track?.src === selected.src && player.playing;

  return (
    <PopoutWindow
      title="COMMENT ON THE TRACK"
      badge="[ PROFILE ]"
      onClose={onClose}
      status={`V${selected.version}${isCurrent ? ' :: CURRENT' : ''} :: THE TRACK CAN PLAY WHILE YOU WRITE :: ESC CLOSES`}
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="shrink-0 space-y-1">
          <div className="w-64 rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-black px-2 py-1">
            <p className="truncate text-[11px] font-bold text-[#33ff33]">{selected.title}</p>
            <p className="mt-1 truncate text-[9px] text-[#1f9f1f]">
              V{selected.version}
              {isCurrent ? ' (CURRENT)' : ''} :: {selected.credit.length === 0 ? profile.displayName : selected.credit}
            </p>
          </div>

          <button
            type="button"
            onClick={() => (playing ? player.toggle() : player.play(songAsPlayerTrack(profile, selected)))}
            className={BUTTON}
          >
            {playing ? '[ ❚❚ PAUSE ]' : '[ ▶ PLAY ]'}
          </button>

          {selected.note.length === 0 ? null : (
            <p className="w-64 whitespace-pre-line text-[10px] text-black">{selected.note}</p>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <ProfileCommentBox
            id={`song-comment-${profile.userId}`}
            title={owner ? 'COMMENT ON YOUR OWN TRACK' : 'COMMENT ON THIS TRACK'}
            placeholder="What do you make of this one?"
            submitLabel="[ FILE COMMENT ]"
            versionLabel="ABOUT WHICH VERSION?"
            versions={versions.map((version) => ({
              id: version.id,
              label: version.id === profile.song.currentVersionId ? `V${version.version} (CURRENT)` : `V${version.version}`,
            }))}
            versionId={selected.id}
            onVersionChange={onSelect}
            onSubmit={async (body) => {
              await repository.addComment(profile.userId, {
                kind: 'song',
                author: viewer,
                body,
                songVersionId: selected.id,
              });
            }}
          />
        </div>
      </div>
    </PopoutWindow>
  );
}
