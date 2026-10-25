'use client';

import { useMemo, useState } from 'react';
import type { TagMatchMode } from '../lib/forum/board-query';
import {
  collectFiledTracks,
  filedFileUploader,
  groupFiledTracks,
  sortFiledFiles,
} from '../lib/audio/forum-tracks';
import { buildAudioTagVocabulary, filterTracksByTags } from '../lib/audio/tags';
import { TRACK_SORTS, type TrackSort } from '../lib/audio/sorts';
import type { ForumTag } from '../lib/forum/types';
import { tagKey, type TagOption } from '../lib/forum/tag-vocabulary';
import { useForum } from './ForumProvider';
import { useMusicPlayer } from './MusicPlayerProvider';
import PopoutWindow from './PopoutWindow';
import { TagMark, tagMarkColour } from './TagBadge';
import TimeStamp from './TimeStamp';
import { PLATE } from '../lib/ui/controls';

/**
 * Every tag the board has, in one window, with the music filed under it.
 *
 * Two tabs, and the point of each:
 *
 *   MAIN    every tag on the board, most used first - one list, no filing by kind, because the
 *           question this window answers is "what is on this board" and the answer is a ranking.
 *           Clicking one includes it in the board's filter, which is what a tag has always done.
 *   MUSIC   the board's own music: a switch that narrows the whole board to posts carrying a track,
 *           the sounds the filed files wear (tick one to keep only the posts whose music wears it),
 *           and a searcher over the files themselves - by name, sound, poster or credit, in the
 *           order you ask for: recently posted, most posted, or by uploader.
 *
 * The window is self-contained: it is drawn through the site's own pop-up shell (draggable, portal,
 * ESC/click-away to close), it reads the board and writes nothing but the filter the board already
 * owns, and it can be closed without the page under it noticing.
 */

type TabKey = 'main' | 'music';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'main', label: '[ MAIN ]' },
  { key: 'music', label: '[ MUSIC ]' },
];

/** A tag the filter can include: the mark, the key, and how often the board uses it. */
function TagTick({
  tag,
  count,
  active,
  onToggle,
  note,
}: {
  tag: ForumTag;
  count: number;
  active: boolean;
  onToggle: () => void;
  note?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={`inline-flex cursor-pointer items-center gap-0.75 px-1 text-label font-bold max-sm:min-h-tap max-sm:px-2 max-sm:text-sm ${
        active ? 'bg-ena text-ink-bar' : 'text-ink hover:underline'
      }`}
    >
      <TagMark colour={tagMarkColour(tag)} compact />
      {tagKey(tag.label)}
      {count > 0 ? <span className={active ? 'text-ink' : 'text-ink'}>({count})</span> : null}
      {note === undefined ? null : <span className={active ? 'text-ink' : 'text-ink'}>{note}</span>}
    </button>
  );
}

type TagWindowProps = {
  onClose: () => void;
  /** The board's own tag filter, live in both directions: the window is a way of setting it. */
  tagKeys: string[];
  onToggleTag: (key: string) => void;
  onClearTags: () => void;
  matchMode: TagMatchMode;
  onMatchMode: (mode: TagMatchMode) => void;
  /** The music half of the same filter. */
  musicOnly: boolean;
  onMusicOnly: (value: boolean) => void;
  musicTagKeys: string[];
  onToggleMusicTag: (key: string) => void;
  /** What the board is showing with the filter as it stands, out of what it holds. */
  showing: number;
  total: number;
  /** Which tab opens first: the index, unless the caller is asking about the music. */
  initialTab?: TabKey;
};

export default function TagWindow({
  onClose,
  tagKeys,
  onToggleTag,
  onClearTags,
  matchMode,
  onMatchMode,
  musicOnly,
  onMusicOnly,
  musicTagKeys,
  onToggleMusicTag,
  showing,
  total,
  initialTab = 'main',
}: TagWindowProps) {
  const forum = useForum();
  const player = useMusicPlayer();
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [fileQuery, setFileQuery] = useState('');
  const [fileSort, setFileSort] = useState<TrackSort>('recent');

  // Every tag the board uses, most used first: `buildTagVocabulary` tallies posts and replies and
  // sorts by the count, which is the only order this window offers.
  const options = forum.tagVocabulary;

  /** The board's files, one entry per file, with how many posts carry each of them. */
  const files = useMemo(() => groupFiledTracks(collectFiledTracks(forum.threads)), [forum.threads]);
  const musicOptions = useMemo(() => buildAudioTagVocabulary(files.map((file) => file.track)), [files]);

  /** The finder's list: the sounds in force, then the words, then the order that was asked for. */
  const listed = useMemo(() => {
    const worn = filterTracksByTags(
      files.map((file) => ({ ...file, tags: file.track.tags ?? [] })),
      musicTagKeys,
    );

    const searched = worn.filter((file) => {
      if (fileQuery.trim().length === 0) return true;

      const words = fileQuery.trim().toLowerCase().split(/\s+/);
      const haystack = [file.track.title, file.track.credit, ...file.posters, ...(file.track.tags ?? [])]
        .join(' ')
        .toLowerCase();

      return words.every((word) => haystack.includes(word));
    });

    return sortFiledFiles(searched, fileSort);
  }, [fileQuery, fileSort, files, musicTagKeys]);

  /** A vocabulary option as the chip painter wants it: colour if it has one, nothing invented if not. */
  const asTag = (option: TagOption): ForumTag => ({
    id: `tag-${option.key}`,
    kind: 'user',
    label: option.label,
    ...(option.colour === undefined ? {} : { colour: option.colour }),
  });

  /** What the window is for: the whole tag list, ranked, as the board's filter. */
  const mainPanel = (
    <div>
      <p className="text-label font-bold text-ink">
        {tagKeys.length} INCLUDED
      </p>

      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.75">
        {options.map((option) => (
          <TagTick
            key={option.key}
            tag={asTag(option)}
            count={option.count}
            active={tagKeys.includes(option.key)}
            onToggle={() => onToggleTag(option.key)}
          />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink pt-2 text-label font-bold text-ink">
        <span>MATCH:</span>
        <label className="flex items-center gap-1">
          <input type="radio" name="window-tag-match" checked={matchMode === 'any'} onChange={() => onMatchMode('any')} />
          ANY
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" name="window-tag-match" checked={matchMode === 'all'} onChange={() => onMatchMode('all')} />
          ALL
        </label>

        <button type="button" onClick={onClearTags} disabled={tagKeys.length === 0} className={PLATE}>
          [ CLEAR TAGS ]
        </button>

        <span className="ml-auto text-ink">
          {showing} OF {total} POSTS SHOWN
        </span>
      </div>
    </div>
  );

  /** The board's music: the switch, the sounds, and the files themselves. */
  const musicPanel = (
    <div>
      <label className="flex items-center gap-2 text-label font-bold text-ink">
        <input type="checkbox" checked={musicOnly} onChange={(event) => onMusicOnly(event.target.checked)} />
        MUSIC ONLY
      </label>

      <p className="mt-3 text-label font-bold text-ink">
        MUSIC TAGS ({musicTagKeys.length})
      </p>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.75">
        {musicOptions.map((option) => (
          <TagTick
            key={option.key}
            tag={{ id: `audio-${option.key}`, kind: 'user', label: option.label }}
            count={option.count}
            active={musicTagKeys.includes(option.key)}
            onToggle={() => onToggleMusicTag(option.key)}
            note=" FILE(S)"
          />
        ))}
      </div>

      <div className="mt-3 border-t border-ink pt-2">
        <div className="flex flex-wrap items-center gap-2 text-label font-bold text-ink">
          <label htmlFor="tag-window-file-search">FIND A FILE:</label>
          <input
            id="tag-window-file-search"
            type="search"
            value={fileQuery}
            onChange={(event) => setFileQuery(event.target.value)}
            placeholder="title, artist, sound or poster"
            className="frame bg-paper p-1 font-mono text-label text-ink outline-none"
          />

          <span className="ml-2">ORDER:</span>
          {TRACK_SORTS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              onClick={() => setFileSort(entry.value)}
              aria-pressed={fileSort === entry.value}
              title={entry.hint}
              className={`cursor-pointer px-1 font-bold ${
                fileSort === entry.value ? 'bg-ena text-ink-bar' : 'text-ink hover:underline'
              }`}
            >
              {entry.label}
            </button>
          ))}

          <span className="ml-auto text-ink">
            {listed.length} OF {files.length} FILE(S)
          </span>
        </div>

        {listed.length === 0 ? (
          <p className="mt-2 text-label font-bold text-ink">
            NO FILE MATCHES.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {listed.map((file) => (
              <li key={file.track.src} className="rule-pixel p-1 text-label text-ink">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-bold">
                  <span>{file.track.title}</span>
                  <span className="text-ink">{file.track.credit}</span>
                  {(file.track.tags ?? []).length === 0 ? null : (
                    <span className="font-normal text-ink">{(file.track.tags ?? []).join(' :: ')}</span>
                  )}
                  <span className="text-ink">
                    FILED {file.count}× :: BY {filedFileUploader(file)}
                  </span>

                  <span className="ml-auto flex items-center gap-1">
                    <button type="button" onClick={() => player.play(file.track)} className={PLATE}>
                      [ PLAY ]
                    </button>
                    {file.filings[0] === undefined ? null : (
                      <a href={file.filings[0].href} onClick={onClose} className={PLATE}>
                        [ OPEN POST ]
                      </a>
                    )}
                  </span>
                </span>

                <span className="mt-0.5 block text-ink">
                  NEWEST: {file.filings[0]?.origin ?? 'POST'} IN {file.filings[0]?.threadTitle ?? 'A POST'} ::{' '}
                  <TimeStamp at={file.newest} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  return (
    <PopoutWindow
      title="TAG INDEX"
      maxWidth="max-w-3xl"
      onClose={onClose}
      actions={
        <button type="button" onClick={onClose} className={PLATE}>
          [ CLOSE ]
        </button>
      }
    >
      {/* The tabs: two plates, the open one filled with the navy this site selects in. */}
      <div className="flex flex-wrap items-center gap-1 border-b-line border-ink bg-sun-pale px-2 py-0.75">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setTab(entry.key)}
            aria-pressed={tab === entry.key}
            className={`inline-flex cursor-pointer items-center px-2 py-0.75 text-label font-bold max-sm:min-h-tap max-sm:px-3 max-sm:text-sm ${
              tab === entry.key ? 'bg-ena text-ink-bar' : 'text-ink hover:bg-ice'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="max-h-[58vh] overflow-y-auto p-2">
        {tab === 'main' ? mainPanel : null}
        {tab === 'music' ? musicPanel : null}
      </div>
    </PopoutWindow>
  );
}
