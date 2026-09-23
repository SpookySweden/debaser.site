'use client';

import { useMemo, useState } from 'react';
import {
  carriesMusic,
  matchesMusicTags,
  selectBoardThreads,
  type BoardQuery,
  type TagMatchMode,
} from '../lib/forum/board-query';
import {
  collectFiledTracks,
  filedFileUploader,
  groupFiledTracks,
  sortFiledFiles,
  type FiledFile,
} from '../lib/audio/forum-tracks';
import { buildAudioTagVocabulary, filterTracksByTags } from '../lib/audio/tags';
import { TRACK_SORTS, type TrackSort } from '../lib/audio/sorts';
import type { ForumTag, ForumThread } from '../lib/forum/types';
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
 * Three tabs, and the point of each:
 *
 *   MAIN    every tag on the board, most used first - one list, no filing by kind, because the
 *           question this window answers is "what is on this board" and the answer is a ranking.
 *           Clicking one includes it in the board's filter, which is what a tag has always done.
 *   MUSIC   the board's own music: a switch that narrows the whole board to posts carrying a track,
 *           the sounds the filed files wear (tick one to keep only the posts whose music wears it),
 *           and a searcher over the files themselves - by name, sound, poster or credit, in the
 *           order you ask for: recently posted, most posted, or by uploader.
 *   TEST    the rules this window and the board are built on, run against the board right now and
 *           reported line by line. It is the browser-side twin of the scratch checks in `Temp/`:
 *           each line is a property that would be a bug if it stopped holding.
 *
 * The window is self-contained: it is drawn through the site's own pop-up shell (draggable, portal,
 * ESC/click-away to close), it reads the board and writes nothing but the filter the board already
 * owns, and it can be closed without the page under it noticing.
 */

type TabKey = 'main' | 'music' | 'test';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'main', label: '[ MAIN ]' },
  { key: 'music', label: '[ MUSIC ]' },
  { key: 'test', label: '[ TEST ]' },
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
      title={active ? `Stop including ${tag.label}` : `Include posts tagged ${tag.label}`}
      className={`inline-flex cursor-pointer items-center gap-[3px] px-1 text-[10px] font-bold max-sm:min-h-11 max-sm:px-2 max-sm:text-sm ${
        active ? 'bg-ena text-white' : 'text-black hover:underline'
      }`}
    >
      <TagMark colour={tagMarkColour(tag)} compact />
      {tagKey(tag.label)}
      {count > 0 ? <span className={active ? 'text-gray-300' : 'text-gray-700'}>({count})</span> : null}
      {note === undefined ? null : <span className={active ? 'text-gray-300' : 'text-gray-700'}>{note}</span>}
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
  /** Which tab opens first: the index, unless the caller is asking about the music or the rules. */
  initialTab?: TabKey;
};

/** One line of the TEST tab: a property that has to hold, and what it was checked against. */
type TestLine = { label: string; ok: boolean; detail: string };

/** True when the numbers run one way or the other the whole way down. */
function isOrdered(values: number[], descending: boolean): boolean {
  return values.every(
    (value, index) => index === 0 || (descending ? values[index - 1] >= value : values[index - 1] <= value),
  );
}

/**
 * The rules this window and the board are built on, run against the board as it is right now.
 *
 * Every line is a property that is written down somewhere else as a promise - the chooser's counts
 * matching the filter (`Temp/check-live-tag-filter.cjs`), the music switch keeping only posts that
 * carry music, each ordering actually being in order (`Temp/check-board-comments.cjs`) - asked here
 * of the live board rather than of a fixture. A line that says FAIL is the bug report.
 */
function boardSelfTest(
  threads: ForumThread[],
  options: TagOption[],
  files: FiledFile[],
  showing: number,
  total: number,
): TestLine[] {
  const query = (extra: Partial<BoardQuery>): BoardQuery => ({
    query: '',
    sourceFilter: 'all',
    tagKeys: [],
    tagMatchMode: 'any',
    sortMode: 'newest',
    ...extra,
  });

  const offered = options.filter((option) => option.count > 0);
  const sounds = buildAudioTagVocabulary(files.map((file) => file.track)).filter((option) => option.count > 0);
  const recent = sortFiledFiles(files, 'recent');
  const popular = sortFiledFiles(files, 'popular');
  const uploader = sortFiledFiles(files, 'uploader');

  return [
    {
      label: 'THE TAG LIST IS RANKED BY USE',
      ok: options.every((option, index) => index === 0 || options[index - 1].count >= option.count),
      detail: `${options.length} tags, most used first`,
    },
    {
      label: 'EVERY TAG OFFERED BRINGS A POST',
      ok: offered.every((option) => selectBoardThreads(threads, query({ tagKeys: [option.key] })).length > 0),
      detail: `${offered.length} tags carry a count`,
    },
    {
      label: 'MUSIC ONLY KEEPS POSTS CARRYING A TRACK',
      ok: selectBoardThreads(threads, query({ musicOnly: true })).every(carriesMusic),
      detail: `${threads.filter(carriesMusic).length} of ${threads.length} posts carry music`,
    },
    {
      label: 'A MUSIC TAG KEEPS THE MUSIC WEARING IT',
      ok: sounds.every((option) =>
        selectBoardThreads(threads, query({ musicOnly: true, musicTagKeys: [option.key] })).every((thread) =>
          matchesMusicTags(thread, [option.key]),
        ),
      ),
      detail: `${sounds.length} sounds in use`,
    },
    {
      label: 'RECENT IS NEWEST FIRST',
      ok: isOrdered(recent.map((file) => Date.parse(file.newest)), true),
      detail: `${recent.length} files`,
    },
    {
      label: 'POPULAR IS MOST POSTED FIRST',
      ok: isOrdered(popular.map((file) => file.count), true),
      detail: `${popular.length} files`,
    },
    {
      label: 'UPLOADER IS A TO Z',
      ok: uploader.every(
        (file, index) =>
          index === 0 || filedFileUploader(uploader[index - 1]).toLowerCase() <= filedFileUploader(file).toLowerCase(),
      ),
      detail: `${uploader.length} files`,
    },
    {
      label: 'THE BOARD SHOWS NO MORE THAN IT HOLDS',
      ok: showing <= total,
      detail: `${showing} shown of ${total}`,
    },
  ];
}

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

  const musicPosts = useMemo(() => forum.threads.filter(carriesMusic).length, [forum.threads]);
  const results = useMemo(
    () => boardSelfTest(forum.threads, options, files, showing, total),
    [files, forum.threads, options, showing, total],
  );

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
      <p className="text-[10px] font-bold text-black">
        {options.length} TAGS, MOST USED FIRST :: {tagKeys.length} INCLUDED :: CLICK ONE TO INCLUDE IT IN THE BOARD
      </p>

      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-[3px]">
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

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-500 pt-2 text-[10px] font-bold text-black">
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

        <span className="ml-auto text-gray-700">
          {showing} OF {total} POSTS SHOWN
        </span>
      </div>
    </div>
  );

  /** The board's music: the switch, the sounds, and the files themselves. */
  const musicPanel = (
    <div>
      <label className="flex items-center gap-2 text-[10px] font-bold text-black">
        <input type="checkbox" checked={musicOnly} onChange={(event) => onMusicOnly(event.target.checked)} />
        FILTER THE FORUM TO MUSIC ONLY
      </label>
      <p className="mt-1 text-[10px] text-gray-700">
        {musicPosts} OF {total} POSTS CARRY A TRACK :: {files.length} FILE(S) FILED ON THE BOARD
      </p>

      <p className="mt-3 text-[10px] font-bold text-black">
        SET MUSIC TAGS ({musicTagKeys.length} IN FORCE) :: A POST SHOWS WHEN ITS MUSIC WEARS ONE
      </p>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-[3px]">
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

      <div className="mt-3 border-t border-gray-500 pt-2">
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold text-black">
          <label htmlFor="tag-window-file-search">FIND A FILE:</label>
          <input
            id="tag-window-file-search"
            type="search"
            value={fileQuery}
            onChange={(event) => setFileQuery(event.target.value)}
            placeholder="title, artist, sound or poster"
            className="rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-1 font-mono text-[10px] text-black outline-none"
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
                fileSort === entry.value ? 'bg-ena text-white' : 'text-black hover:underline'
              }`}
            >
              {entry.label}
            </button>
          ))}

          <span className="ml-auto text-gray-700">
            {listed.length} OF {files.length} FILE(S)
          </span>
        </div>

        {listed.length === 0 ? (
          <p className="mt-2 text-[10px] font-bold text-black">
            NO FILE MATCHES. A FILE GETS HERE BY BEING ATTACHED TO A POST OR A REPLY.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {listed.map((file) => (
              <li key={file.track.src} className="rounded-none border border-gray-400 bg-white p-1 text-[10px] text-black">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-bold">
                  <span>{file.track.title}</span>
                  <span className="text-gray-700">{file.track.credit}</span>
                  {(file.track.tags ?? []).length === 0 ? null : (
                    <span className="font-normal text-gray-700">{(file.track.tags ?? []).join(' :: ')}</span>
                  )}
                  <span className="text-gray-700">
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

                <span className="mt-[2px] block text-gray-700">
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

  /** The rules, asked of the board as it stands: a FAIL line is a bug report. */
  const testPanel = (
    <div>
      <p className="text-[10px] font-bold text-black">
        {results.filter((result) => result.ok).length} OF {results.length} PROPERTIES HOLD. EACH LINE IS A RULE THIS
        BOARD IS BUILT ON, ASKED OF IT AS IT IS NOW.
      </p>

      <ul className="mt-2 space-y-1">
        {results.map((result) => (
          <li
            key={result.label}
            className={`flex flex-wrap items-center gap-2 border p-1 text-[10px] font-bold ${
              result.ok ? 'border-gray-400 bg-white text-black' : 'border-black bg-[#fffbe6] text-[#800000]'
            }`}
          >
            <span>{result.ok ? '[ PASS ]' : '[ FAIL ]'}</span>
            <span>{result.label}</span>
            <span className="ml-auto font-normal text-gray-700">{result.detail}</span>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[10px] text-gray-700">
        THE SAME RULES RUN WITHOUT A BROWSER IN Temp/check-board-comments.cjs AND Temp/check-live-tag-filter.cjs. A FAIL
        HERE MEANS THE BOARD AND ITS OWN RULES DISAGREE RIGHT NOW.
      </p>
    </div>
  );

  return (
    <PopoutWindow
      title="ALL TAGS"
      badge="[ TAG INDEX ]"
      status={`${showing} OF ${total} POSTS SHOWN`}
      maxWidth="max-w-3xl"
      onClose={onClose}
      actions={
        <button type="button" onClick={onClose} className={PLATE}>
          [ CLOSE ]
        </button>
      }
    >
      {/* The tabs: three plates, the open one filled with the navy this site selects in. */}
      <div className="flex flex-wrap items-center gap-1 border-b-2 border-gray-600 bg-sun-pale px-2 py-[3px]">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setTab(entry.key)}
            aria-pressed={tab === entry.key}
            className={`inline-flex cursor-pointer items-center px-2 py-[3px] text-[10px] font-bold max-sm:min-h-11 max-sm:px-3 max-sm:text-sm ${
              tab === entry.key ? 'bg-ena text-white' : 'text-black hover:bg-ice'
            }`}
          >
            {entry.label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-gray-700">
          {tab === 'main' ? 'EVERY TAG ON THE BOARD' : null}
          {tab === 'music' ? 'THE BOARD`S OWN MUSIC' : null}
          {tab === 'test' ? 'THE RULES, RUN AGAINST THE BOARD' : null}
        </span>
      </div>

      <div className="max-h-[58vh] overflow-y-auto p-2">
        {tab === 'main' ? mainPanel : null}
        {tab === 'music' ? musicPanel : null}
        {tab === 'test' ? testPanel : null}
      </div>
    </PopoutWindow>
  );
}
