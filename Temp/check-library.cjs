/**
 * (2026-11-04) The next steps compile all it requires: it had been passing on what earlier runs left in Temp/.
 *   npx tsc app/lib/audio/library.ts app/lib/audio/mock-music-repository.ts --rootDir app/lib --outDir Temp/library-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 * The reader's own music: the pure logic, and the mock store that backs it.
 *
 * Likes and playlists are per-account data, so the things worth holding are the rules rather than the
 * rendering: that a like is idempotent, that one account's writes never touch another's, that a list
 * keeps its own order, and that a like pointing at a track the shelf has forgotten is dropped rather
 * than drawn as a half-row.
 */
const assert = require('node:assert/strict');

const {
  playlistId,
  validatePlaylistName,
  resolveLikes,
  resolvePlaylistItems,
  likedIds,
  playlistIds,
  isLiked,
  isInPlaylist,
} = require('./library-out/audio/library.js');
const { getMockMusicRepository } = require('./library-out/audio/mock-music-repository.js');

/* 1. The pure helpers ------------------------------------------------------------ */

assert.equal(playlistId('me', 'late night'), 'me:LATE-NIGHT', 'a name becomes a readable id');
assert.equal(playlistId('me', '  Late   Night  '), 'me:LATE-NIGHT', 'and the same list however it is typed');
assert.notEqual(playlistId('me', 'late night'), playlistId('you', 'late night'), 'two accounts may share a name');

assert.equal(validatePlaylistName(''), 'A PLAYLIST NEEDS A NAME.');
assert.equal(validatePlaylistName('   '), 'A PLAYLIST NEEDS A NAME.');
assert.equal(validatePlaylistName('x'.repeat(41))?.startsWith('PLAYLIST NAMES ARE 40'), true);
assert.equal(validatePlaylistName('LATE NIGHT'), undefined);

const shelf = [
  { id: 'a', title: 'one' },
  { id: 'b', title: 'two' },
  { id: 'c', title: 'three' },
];

// A like whose track is gone is dropped, not drawn as a row with no title - and *counted*, so the screen
// can tell the reader "two of your songs are not on the shelf" rather than silently drawing a short list.
const resolved = resolveLikes([{ trackId: 'a', likedAt: '2' }, { trackId: 'gone', likedAt: '3' }], shelf);
assert.equal(resolved.rows.length, 1, 'a like pointing at nothing is not a row');
assert.equal(resolved.rows[0].title, 'one');
assert.equal(resolved.missing, 1, 'and the drop is reported rather than swallowed');

assert.equal(resolveLikes([], shelf).missing, 0, 'nothing liked is not a shortfall');
assert.equal(resolveLikes([{ trackId: 'a', likedAt: '1' }], []).missing, 1, 'an empty shelf drops everything');

// A list keeps its own order, which is the whole point of a list.
const playlist = {
  id: 'me:X',
  ownerId: 'me',
  name: 'X',
  createdAt: 'now',
  items: [{ trackId: 'c', addedAt: '1' }, { trackId: 'a', addedAt: '2' }],
};
const ordered = resolvePlaylistItems(playlist, shelf);
assert.deepEqual(ordered.rows.map((t) => t.title), ['three', 'one'], 'a playlist is read in its own order');
assert.equal(ordered.missing, 0);
assert.equal(resolvePlaylistItems(playlist, [{ id: 'a', title: 'one' }]).missing, 1, 'and reports its own holes');

// The sets, which are what the rows actually read: one pass for the list, not one per row.
const liked = likedIds([{ trackId: 'a', likedAt: '1' }, { trackId: 'b', likedAt: '2' }]);
assert.equal(liked.has('a'), true);
assert.equal(liked.has('gone'), false);
assert.equal(liked.size, 2, 'a set of ids, not of records');
assert.equal(playlistIds(playlist).has('c'), true);
assert.equal(playlistIds(null).size, 0, 'no list open is no ids');

assert.equal(isLiked([{ trackId: 'a', likedAt: '1' }], 'a'), true);
assert.equal(isLiked([{ trackId: 'a', likedAt: '1' }], 'b'), false);
assert.equal(isInPlaylist(playlist, 'c'), true);
assert.equal(isInPlaylist(playlist, 'b'), false);

/* 2. The mock store, per account ------------------------------------------------ */

(async () => {
  const repository = getMockMusicRepository();

  assert.equal((await repository.listLikes('me')).items.length, 0, 'a shelf nobody has liked is empty');
  assert.equal((await repository.listLikes('me')).answered, true, 'and the read answered');

  const first = await repository.toggleLike('me', 'a');
  assert.equal(first.liked, true, 'the first press likes');
  assert.equal((await repository.listLikes('me')).items.length, 1);
  assert.equal(isLiked((await repository.listLikes('me')).items, 'a'), true);

  const second = await repository.toggleLike('me', 'a');
  assert.equal(second.liked, false, 'and the second takes it back');
  assert.equal((await repository.listLikes('me')).items.length, 0);

  await repository.toggleLike('me', 'a');
  await repository.toggleLike('me', 'b');

  // The rule the whole feature rests on: one account's likes are theirs.
  assert.equal((await repository.listLikes('you')).items.length, 0, 'another account sees none of them');
  await repository.toggleLike('you', 'c');
  assert.equal((await repository.listLikes('me')).items.length, 2, 'and liking does not disturb the first account');
  assert.equal((await repository.listLikes('you')).items.length, 1);

  /* Lists */
  const made = await repository.savePlaylist({ ownerId: 'me', name: 'late night' });
  assert.equal(made.id, 'me:LATE-NIGHT');
  assert.equal(made.items.length, 0, 'a new list starts empty');

  // The same name is the same list, not a duplicate.
  const again = await repository.savePlaylist({ ownerId: 'me', name: 'Late Night' });
  assert.equal(again.id, made.id);
  assert.equal((await repository.listPlaylists('me')).items.length, 1, 'renaming is an edit, not a second list');

  const withTrack = await repository.togglePlaylistTrack({ ownerId: 'me', playlistId: made.id, trackId: 'a' });
  assert.equal(withTrack.items.length, 1, 'a track goes in');
  assert.equal(isInPlaylist(withTrack, 'a'), true);

  const without = await repository.togglePlaylistTrack({ ownerId: 'me', playlistId: made.id, trackId: 'a' });
  assert.equal(without.items.length, 0, 'and the same press takes it out again');

  // An edit must not wipe the items it is not touching.
  await repository.togglePlaylistTrack({ ownerId: 'me', playlistId: made.id, trackId: 'a' });
  const renamed = await repository.savePlaylist({ ownerId: 'me', name: 'late night' });
  assert.equal(renamed.items.length, 1, 'saving a list again keeps what is in it');

  assert.equal((await repository.listPlaylists('you')).items.length, 0, 'lists are per account too');

  await assert.rejects(
    () => repository.togglePlaylistTrack({ ownerId: 'me', playlistId: 'me:NOPE', trackId: 'a' }),
    /NO PLAYLIST BY THAT NAME/,
  );
  await assert.rejects(() => repository.savePlaylist({ ownerId: 'me', name: '   ' }), /NEEDS A NAME/);

  await repository.removePlaylist('me', made.id);
  assert.equal((await repository.listPlaylists('me')).items.length, 0, 'and a list can be taken away');

  console.log('library');
  console.log('  likes     : a switch, per account, and one account cannot see another`s');
  console.log('  playlists : id derived from the name, order kept, items survive a rename');
  console.log('  dangling  : a like pointing at a track the shelf has lost is dropped - and counted');
  console.log('  sets      : the rows read a Set, so the list costs one pass rather than one per row');
})().catch((error) => {
  console.error('FAILED:', error.message);
  process.exit(1);
});
