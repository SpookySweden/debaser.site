/*
 * Scratch checks for the audio that rides with a post, and for the tags the file
 * directory filters on (run from the root):
 *   npx tsc app/lib/audio/attach.ts app/lib/audio/tags.ts app/lib/audio/forum-tracks.ts app/lib/audio/format.ts app/lib/audio/tracks.ts app/lib/audio/catalogue.ts app/lib/audio/repository.ts app/lib/audio/mock-music-repository.ts app/lib/audio/supabase-music-repository.ts app/lib/projects/tracks.ts --outDir Temp/forum-audio-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   node Temp/check-forum-audio.cjs
 *
 * Four things this feature can get wrong, and one check each:
 *
 *   1. the tag grammar - `lo-fi`, `lo fi` and `LO FI` have to be one tag with one key,
 *      or the filter bar grows a near-duplicate every time somebody spells it differently;
 *   2. the filter - an untouched bar shows everything, ANY is the default, ALL is the
 *      narrower question, and a file with no tags is never hidden by an empty filter;
 *   3. the link field - an MP3 somewhere else plays, a page that merely mentions one does
 *      not, and the title falls back to the file's own name;
 *   4. the board's tracks - a post's file and its replies' files are collected once each,
 *      newest first, credited to whoever filed them, in the shape the player takes.
 */
const assert = require('node:assert/strict');

const {
  MAX_AUDIO_TAGS,
  audioTagKey,
  audioTagLabel,
  buildAudioTagVocabulary,
  filterTracksByTags,
  normaliseAudioTags,
} = require('./forum-audio-out/audio/tags.js');

const { trackFromLink } = require('./forum-audio-out/audio/attach.js');
const { formatTrackLength } = require('./forum-audio-out/audio/format.js');
const { collectFiledTracks, postedTrackAsAudio } = require('./forum-audio-out/audio/forum-tracks.js');
const { LOCAL_TRACKS, titleFromFileName, tracksFromStorage } = require('./forum-audio-out/audio/tracks.js');

// 1. One tag, one spelling, one key - and no more than the cap.
assert.equal(audioTagLabel('lo-fi'), 'LO FI');
assert.equal(audioTagLabel('Lo Fi'), 'LO FI');
assert.equal(audioTagKey('LO-FI'), 'lo-fi');
assert.equal(audioTagKey('lo fi'), 'lo-fi');
assert.deepEqual(normaliseAudioTags(['lo-fi', 'LO FI', 'ambient']), ['LO FI', 'AMBIENT']);
assert.equal(normaliseAudioTags(['a', 'b', 'c', 'd', 'e']).length, MAX_AUDIO_TAGS);
assert.deepEqual(normaliseAudioTags(['   ', '']), [], 'an empty tag is not a tag');

// 2. The vocabulary counts what is worn, and always offers the starter tags.
const vocabulary = buildAudioTagVocabulary([{ tags: ['LO FI'] }, { tags: ['AMBIENT', 'LO FI'] }]);
assert.deepEqual(vocabulary[0], { label: 'LO FI', key: 'lo-fi', count: 2, starter: true });
assert.equal(vocabulary.filter((option) => option.starter).length >= 8, true, 'the starters are always offered');
assert.equal(vocabulary.find((option) => option.key === 'ambient').count, 1);
assert.equal(vocabulary.find((option) => option.key === 'noise').count, 0);

// 3. The filter itself.
const shelf = [
  { id: 'a', tags: ['LO FI', 'AMBIENT'] },
  { id: 'b', tags: ['HIP HOP'] },
  { id: 'c', tags: [] },
];
assert.deepEqual(filterTracksByTags(shelf, []).map((t) => t.id), ['a', 'b', 'c'], 'nothing chosen shows everything');
assert.deepEqual(filterTracksByTags(shelf, ['lo-fi']).map((t) => t.id), ['a']);
assert.deepEqual(filterTracksByTags(shelf, ['lo-fi', 'hip-hop'], 'any').map((t) => t.id), ['a', 'b']);
assert.deepEqual(filterTracksByTags(shelf, ['lo-fi', 'ambient'], 'all').map((t) => t.id), ['a']);
assert.deepEqual(filterTracksByTags(shelf, ['lo-fi', 'ambient', 'noise'], 'all'), [], 'ALL is every tag or nothing');

// 4. Linking an MP3 rather than filing one: a guest's way in.
const linked = trackFromLink({ src: 'https://cdn.example.com/dir/mix-two.mp3?dl=1', title: '', credit: '', tags: ['lo-fi'] });
assert.equal(linked.ok, true);
assert.equal(linked.track.src, 'https://cdn.example.com/dir/mix-two.mp3?dl=1', 'the link is kept whole, query and all');
assert.equal(linked.track.title, 'MIX TWO', "the file's own name answers when no title was typed");
assert.deepEqual(linked.track.tags, ['LO FI']);
assert.equal(trackFromLink({ src: '/assets/audio/theme.wav', title: 'THEME', credit: 'K', tags: [] }).ok, true);
assert.equal(trackFromLink({ src: 'https://example.com/track.html', title: '', credit: '', tags: [] }).ok, false);
assert.equal(trackFromLink({ src: 'my mix', title: '', credit: '', tags: [] }).ok, false);
assert.equal(trackFromLink({ src: '   ', title: '', credit: '', tags: [] }).ok, false);

// 5. What the board holds: the post's file and its replies' files, credited and ordered.
const thread = {
  id: 'thread-1',
  title: 'A POST',
  body: 'body',
  author: { id: null, displayName: '' },
  createdAt: '2026-09-23T10:00:00.000Z',
  anchor: { kind: 'board', id: 'board', label: 'BOARD' },
  tags: [],
  origin: 'user',
  track: { src: 'https://cdn.example.com/post.mp3', title: 'POST MIX', credit: '', tags: ['AMBIENT'], length: '3:41' },
  comments: [
    {
      id: 'comment-1',
      threadId: 'thread-1',
      body: 'reply',
      author: { id: 'u1', displayName: 'WARD' },
      createdAt: '2026-09-23T11:00:00.000Z',
      tags: [],
      track: { src: '/assets/audio/reply.mp3', title: 'REPLY LOOP', credit: 'WARD', tags: ['LO FI'] },
    },
  ],
};

const filed = collectFiledTracks([thread]);
assert.equal(filed.length, 2, 'one row per file, not one per thread');
assert.deepEqual(filed.map((entry) => entry.origin), ['REPLY', 'POST'], 'newest first');
assert.deepEqual(filed.map((entry) => entry.poster), ['WARD', 'Anonymous']);
assert.equal(filed[0].href.startsWith('/forum#'), true, 'a row can be walked back to the post');
assert.equal(filed[1].track.kind, 'FILED ON THE BOARD');
assert.equal(filed[1].track.credit, 'Anonymous', 'an uncredited track is credited to whoever filed it');
assert.equal(filed[1].track.tags[0], 'AMBIENT');
assert.equal(postedTrackAsAudio(filed[0].track, 'WARD').length, '--:--', 'an unmeasured length is dashes');

// 6. The shelf the directory lists: archive rows carry tags, and a bucket file with no
// row still plays, titled from its own name.
assert.equal(LOCAL_TRACKS.every((track) => Array.isArray(track.tags)), true);
const described = tracksFromStorage(
  [{ path: 'u/one.mp3', src: 'https://x/one.mp3' }, { path: 'u/two.mp3', src: 'https://x/two.mp3' }],
  [{ src: 'https://x/two.mp3', title: 'TWO', credit: 'K', kind: 'NOISE SET', length: '1:00', tags: ['NOISE'] }],
);
assert.equal(described[0].title, 'ONE');
assert.deepEqual(described[0].tags, []);
assert.deepEqual(described[1].tags, ['NOISE']);
assert.equal(described[1].length, '1:00');
assert.equal(titleFromFileName('some/dir/My_Mix (rough).mp3'), 'MY MIX (ROUGH)');
assert.equal(formatTrackLength(221), '3:41');

console.log('forum audio checks passed');
console.log('  tags    :', audioTagLabel('lo-fi'), '->', audioTagKey('LO FI'), '::', vocabulary.length, 'in the vocabulary');
console.log('  filter  : any/all over', shelf.length, 'files, empty filter showing all', shelf.length);
console.log('  links   :', linked.track.title, 'from', linked.track.src);
console.log('  board   :', filed.length, 'files collected, newest first, each credited to its poster');
