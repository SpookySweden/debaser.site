'use client';

import { useState } from 'react';
import { authorTag } from '../lib/auth/author';
import type { PublicProfile } from '../lib/profile/types';
import {
  canCommentOnSong,
  currentSongVersion,
  songAsPlayerTrack,
  songComments,
  songVersionById,
  songVersionsNewestFirst,
  visibleSongComments,
} from '../lib/profile/visibility';
import { useMusicPlayer } from './MusicPlayerProvider';
import ProfileLink from './ProfileLink';
import ProfileName from './ProfileName';
import TimeStamp from './TimeStamp';

const BUTTON =
  'cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-2 py-[2px] text-[10px] font-bold text-black hover:bg-gray-300 disabled:cursor-wait disabled:opacity-60';

type ProfileSongPanelProps = {
  profile: PublicProfile;
  /** Owner view: hidden comments are listed too. */
  owner: boolean;
  /** The version being looked at, which is the one the comments below belong to. */
  selectedId: string;
  onSelect: (versionId: string) => void;
  /** Opens the comment window for the version being looked at. */
  onComment: () => void;
};

/**
 * The account's one track, beside the picture.
 *
 * It is the picture panel's twin, in the space the page gives it: the track being
 * looked at at the top (title, credit, version, and the button that plays it), its
 * conversation below it, and the history behind an expander. Picking an older version
 * switches the track *and* the conversation, so a remark about a mix stays with that
 * mix - the same append-only rule the drawings live by.
 *
 * Playing hands the track to the site's player rather than drawing an audio element
 * here: one player serves the whole site, so pressing play beside somebody's picture
 * puts their song in the bar at the bottom of the window and leaves it playing while
 * the reader walks away.
 *
 * The conversation is one summary line until `[ SHOW ]` is pressed: a profile is read
 * for its picture and its track, and a comment list sitting open under both would push
 * everything else off the screen.
 */
export default function ProfileSongPanel({ profile, owner, selectedId, onSelect, onComment }: ProfileSongPanelProps) {
  const player = useMusicPlayer();
  const versions = songVersionsNewestFirst(profile);
  const current = currentSongVersion(profile);
  const selected = songVersionById(profile, selectedId) ?? current;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [threadOpen, setThreadOpen] = useState(false);

  const listed = owner ? songComments(profile) : visibleSongComments(profile);
  const thread = selected === undefined ? [] : listed.filter((comment) => comment.songVersionId === selected.id);
  const commentsSwitchedOff = !canCommentOnSong(owner, profile.visibility);
  const playingThis = selected !== undefined && player.track?.src === selected.src && player.playing;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] p-2">
        <div className="flex items-center justify-between gap-2 text-[10px] font-bold text-black">
          <span>{owner ? 'YOUR TRACK' : 'THEIR TRACK'}</span>
          <span>
            [ {versions.length} VERSION{versions.length === 1 ? '' : 'S'} ]
          </span>
        </div>

        {/* The readout, in the player's own colours: the same shelf, one track over. */}
        <div className="mt-1 rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-black px-2 py-1">
          <p className="truncate text-[11px] font-bold text-[#33ff33]">
            {selected === undefined ? 'NOTHING FILED YET' : selected.title}
          </p>
          <p className="mt-1 truncate text-[9px] text-[#1f9f1f]">
            {selected === undefined
              ? owner
                ? 'FILE A TRACK IN THE CUSTOMISER AND IT PLAYS FROM THE BAR BELOW.'
                : 'THIS ACCOUNT HAS NOT PUT A TRACK UP.'
              : `V${selected.version}${selected.id === profile.song.currentVersionId ? ' (CURRENT)' : ''} :: ${
                  selected.credit.length === 0 ? profile.displayName : selected.credit
                }`}
          </p>
        </div>

        {selected === undefined ? null : (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => (playingThis ? player.toggle() : player.play(songAsPlayerTrack(profile, selected)))}
              className={BUTTON}
            >
              {playingThis ? '[ ❚❚ PAUSE ]' : '[ ▶ PLAY ]'}
            </button>

            {canCommentOnSong(owner, profile.visibility) ? (
              <button type="button" onClick={onComment} className={BUTTON}>
                [ COMMENT ]
              </button>
            ) : null}

            {selected.note.length === 0 ? null : <span className="text-[10px] text-gray-700">{selected.note}</span>}
          </div>
        )}
      </div>

      {/* The thread, one summary line until it is opened. */}
      {selected === undefined ? null : (
        <div className="rounded-none border border-gray-500 bg-white p-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold text-black">
            <span>
              COMMENTS ON V{selected.version} :: {thread.length}
              {commentsSwitchedOff ? ' :: HIDDEN BY THE OWNER' : ''}
            </span>

            <button type="button" onClick={() => setThreadOpen(!threadOpen)} className={BUTTON}>
              {threadOpen ? '[ HIDE ]' : '[ SHOW ]'}
            </button>
          </div>

          {!threadOpen ? null : commentsSwitchedOff || thread.length === 0 ? (
            <p className="mt-1 text-[10px] text-gray-700">
              {commentsSwitchedOff
                ? 'COMMENTS ON THE TRACK ARE SWITCHED OFF.'
                : 'NOTHING HAS BEEN SAID ABOUT THIS ONE YET.'}
            </p>
          ) : (
            <ul className="mt-1 space-y-1">
              {thread.map((comment) => (
                <li key={comment.id} className="rounded-none border border-gray-500 bg-[#f0f0f0] p-1">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold">
                    <span>
                      <ProfileLink author={comment.author}>
                        <ProfileName author={comment.author}>{authorTag(comment.author)}</ProfileName>
                      </ProfileLink>{' '}
                      <span className="text-gray-700">[ AT V{comment.songVersionNumber ?? selected.version} ]</span>
                    </span>
                    <TimeStamp at={comment.createdAt} />
                  </div>
                  <p className="mt-1 whitespace-pre-line text-xs">{comment.body}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {versions.length === 0 ? null : (
        <div className="rounded-none border border-gray-500 bg-white p-2">
          <button type="button" onClick={() => setHistoryOpen(!historyOpen)} className={BUTTON}>
            {historyOpen ? '[ HIDE HISTORY ]' : `[ SHOW HISTORY (${versions.length}) ]`}
          </button>

          {historyOpen ? (
            <ul className="mt-1 space-y-1">
              {versions.map((version) => {
                const count = listed.filter((comment) => comment.songVersionId === version.id).length;
                const looking = selected !== undefined && selected.id === version.id;

                return (
                  <li
                    key={version.id}
                    className={`rounded-none border border-gray-500 p-1 text-[10px] font-bold text-black ${
                      looking ? 'bg-[#ffffcc]' : 'bg-[#f0f0f0]'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="min-w-0 truncate">
                        V{version.version}
                        {version.id === profile.song.currentVersionId ? ' [ CURRENT ]' : ''} :: {version.title} ::{' '}
                        {count} COMMENTS
                      </span>

                      <span className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => player.play(songAsPlayerTrack(profile, version))}
                          className={BUTTON}
                          title="Play this version"
                        >
                          [ ▶ ]
                        </button>
                        <button type="button" onClick={() => onSelect(version.id)} disabled={looking} className={BUTTON}>
                          {looking ? '[ LOOKING ]' : '[ LOOK AT THIS ONE ]'}
                        </button>
                      </span>
                    </div>

                    {version.restoredFromVersion === undefined ? null : (
                      <p className="mt-1 text-[10px] font-bold text-gray-700">COPIED FROM V{version.restoredFromVersion}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}
