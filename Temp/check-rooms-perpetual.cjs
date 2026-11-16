/**
 * The perpetual room (SPEC-rooms-perpetual.md), held where it can fail: the mock store keeps the database's new rules.
 *
 * Steps (above the fold, because `run-checks.cjs` only reads the first 20 lines for these):
 *   npx tsc app/lib/watch/own-room.ts app/lib/watch/mock-watch-repository.ts app/lib/watch/rules.ts app/lib/watch/music-rooms.ts --rootDir app/lib --outDir Temp/rooms-perpetual-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *
 * What it holds, each against the module itself (never a string in a template):
 *   1. GO LIVE announces the SAME room (same id, still a main room), with WHO CAN JOIN; only its host can; GO PRIVATE
 *      takes it off again. A live PRIVATE main room stays link-only; OPEN lets anybody in by its address.
 *   2. Chat before live: a link joiner may talk in a private main room; somebody who never joined may not.
 *   3. A private main room is never taken over; a live one only after 45 quiet seconds (a stream room after 8), and it
 *      then becomes a stream room: nobody's main room.
 *   4. Handing on (LEAVE): only the host, only to a member, only when live; the room becomes the heir's stream room.
 *   5. A new main room after a hand-on or END ROOM: the old one is not found as yours, a new one is made with a new id.
 *   6. A main room never ends by itself; a handed-on room ends when left quiet, as a stream does.
 *   7. The session lets go of a room that stopped being yours: a new blank room, its queue empty, asked twice it is one.
 *   8. The lists: a private main room is on none; a live one is while its host's beat is fresh, gone after 90 seconds.
 */
const assert = require('node:assert/strict');

const mock = require('./rooms-perpetual-out/watch/mock-watch-repository.js');
const { OwnRoomSession } = require('./rooms-perpetual-out/watch/own-room.js');
const { roomAnnounced, MAIN_ROOM_TAKE_OVER_MS, TAKE_OVER_QUIET_MS } = require('./rooms-perpetual-out/watch/rules.js');
const { listedRooms } = require('./rooms-perpetual-out/watch/music-rooms.js');

let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

/** The clock, moved on by hand: the store reads `Date.now` for "quiet". */
const realNow = Date.now;
let skew = 0;
Date.now = () => realNow() + skew;
const later = (ms) => {
  skew += ms;
};

const song = (n) => ({ url: `/assets/audio/song-${n}.mp3`, kind: 'audio', title: `SONG ${n}` });

async function ownRoom(repository, id, hostId) {
  const read = await repository.openOwnRoom({ id, host: { id: hostId, label: hostId.toUpperCase() } });
  return read.room;
}
const join = async (owner, friendRepo) => {
  const secret = await owner.ownRoomLink(false);
  return friendRepo.joinByLink(secret);
};

(async () => {
  console.log('1. GO LIVE ANNOUNCES THE SAME ROOM');
  {
    mock.resetMockWatch();
    const owner = mock.getBrowserWatchRepository('account-owner');
    const stranger = mock.getBrowserWatchRepository('account-stranger');
    const room = await ownRoom(owner, 'room-a', 'account-owner');
    assert.equal(room.isPublic, false, 'a main room starts private');
    assert.equal(roomAnnounced(room), false);
    await assert.rejects(stranger.announceRoom('room-a', true, 'open', null), 'somebody else cannot put your room live');
    await owner.announceRoom('room-a', true, 'private', null);
    const live = (await owner.readRoom('room-a')).room;
    assert.equal(live.id, 'room-a', 'the same room');
    assert.equal(live.origin, 'music', 'still your main room');
    assert.equal(live.isPublic, true, 'announced');
    assert.equal(live.privacy, 'private');
    assert.equal(roomAnnounced(live), true);
    assert.equal((await stranger.readDoor('room-a')).found, false, 'live PRIVATE: link-only, no such room by its address');
    assert.equal(await stranger.enterRoom('room-a', null), 'refused');
    await owner.announceRoom('room-a', true, 'open', null);
    assert.equal((await stranger.readDoor('room-a')).found, true, 'live OPEN: found by its address');
    await owner.announceRoom('room-a', false, 'open', null);
    const back = (await owner.readRoom('room-a')).room;
    assert.equal(back.isPublic, false, 'GO PRIVATE takes it off');
    assert.equal(back.privacy, 'private', 'and back to link-only, whatever was asked');
    assert.equal((await mock.getBrowserWatchRepository('account-other').readDoor('room-a')).found, false, 'private again: no such room for somebody who never joined');
    pass('GO LIVE and GO PRIVATE change the same room; only its host can; PRIVATE stays link-only');
  }

  console.log('2. CHAT BEFORE LIVE');
  {
    mock.resetMockWatch();
    const owner = mock.getBrowserWatchRepository('account-owner');
    const friend = mock.getBrowserWatchRepository('account-friend');
    const stranger = mock.getBrowserWatchRepository('account-stranger');
    await ownRoom(owner, 'room-b', 'account-owner');
    assert.equal(await join(owner, friend), 'room-b', 'the friend joins by the link');
    const said = await friend.sendMessage({ roomId: 'room-b', queueEntryId: null, mediaItemId: null, author: { id: 'account-friend', label: 'FRIEND' }, body: 'hello', mediaSeconds: 0 });
    assert.equal(said.body, 'hello', 'a link joiner talks in a private main room');
    await assert.rejects(stranger.sendMessage({ roomId: 'room-b', queueEntryId: null, mediaItemId: null, author: { id: 'account-stranger', label: 'STRANGER' }, body: 'hi', mediaSeconds: 0 }), 'somebody who never joined does not');
    pass('chat is on before GO LIVE for whoever joined by the link, and only them');
  }

  console.log('3. TAKE-OVER: NEVER A PRIVATE MAIN ROOM; A LIVE ONE AFTER 45 SECONDS');
  {
    mock.resetMockWatch();
    const owner = mock.getBrowserWatchRepository('account-owner');
    const friend = mock.getBrowserWatchRepository('account-friend');
    await ownRoom(owner, 'room-c', 'account-owner');
    await join(owner, friend);
    later(10 * 60 * 1000);
    assert.equal(await friend.takeOver('room-c', 'account-owner', 'account-friend'), false, 'private, and quiet for ten minutes: still never taken');
    await owner.announceRoom('room-c', true, 'private', null);
    later(TAKE_OVER_QUIET_MS + 2000);
    assert.equal(await friend.takeOver('room-c', 'account-owner', 'account-friend'), false, 'live, quiet past the stream rooms\' 8 seconds: not yet');
    later(MAIN_ROOM_TAKE_OVER_MS);
    assert.equal(await friend.takeOver('room-c', 'account-owner', 'account-friend'), true, 'live, quiet past 45 seconds: taken');
    const taken = (await friend.readRoom('room-c')).room;
    assert.equal(taken.hostId, 'account-friend');
    assert.equal(taken.origin, 'stream', 'and it is nobody\'s main room now');
    assert.equal(MAIN_ROOM_TAKE_OVER_MS, 45000, 'Luke\'s 45 seconds (Q3 A)');
    pass('a private main room is never taken; a live one after 45 quiet seconds, and it becomes a stream room');
  }

  console.log('4. LEAVE HANDS IT ON');
  {
    mock.resetMockWatch();
    const owner = mock.getBrowserWatchRepository('account-owner');
    const friend = mock.getBrowserWatchRepository('account-friend');
    const stranger = mock.getBrowserWatchRepository('account-stranger');
    await ownRoom(owner, 'room-d', 'account-owner');
    await join(owner, friend);
    assert.equal(await owner.passOn('room-d', 'account-friend'), false, 'a private main room is never handed on');
    await owner.announceRoom('room-d', true, 'open', null);
    assert.equal(await stranger.passOn('room-d', 'account-friend'), false, 'only its host hands it on');
    assert.equal(await owner.passOn('room-d', 'account-stranger'), false, 'only to somebody in it');
    await owner.handOver('room-d', 'account-friend');
    assert.equal((await owner.readRoom('room-d')).room.hostId, 'account-owner', 'the old hand-over write cannot move a main room');
    assert.equal(await owner.passOn('room-d', 'account-friend'), true, 'live, to a member: handed on');
    const handed = (await friend.readRoom('room-d')).room;
    assert.equal(handed.hostId, 'account-friend', 'it is theirs');
    assert.equal(handed.origin, 'stream', 'nobody\'s main room');
    pass('LEAVE hands a live room to a member, and only then; it becomes the heir\'s stream room');

    console.log('5. A NEW MAIN ROOM AFTER A HAND-ON, AND AFTER END ROOM');
    assert.equal(await owner.findMusicRoom('account-owner'), null, 'the handed-on room is not found as yours');
    const fresh = await ownRoom(owner, 'room-e', 'account-owner');
    assert.equal(fresh.id, 'room-e', 'a new room, with a new id');
    assert.equal(fresh.origin, 'music');
    assert.equal(fresh.isPublic, false, 'private, as every room starts');
    assert.equal((await owner.readRoom('room-e')).queue.length, 0, 'its queue starts empty (Luke, Q1 A)');
    assert.equal((await friend.readRoom('room-d')).room.endedAt, null, 'the old room carries on with its people');
    await owner.endRoom('room-e');
    assert.notEqual((await owner.readRoom('room-e')).room.endedAt, null, 'END ROOM ends a main room (it used to be refused)');
    assert.equal(await owner.findMusicRoom('account-owner'), null, 'an ended room is not found as yours');
    assert.equal((await ownRoom(owner, 'room-f', 'account-owner')).id, 'room-f', 'and the next play makes another');
    pass('after a hand-on or END ROOM the next room is a new one, empty; the handed-on room carries on');

    console.log('6. WHAT ENDS BY ITSELF');
    later(10 * 60 * 1000);
    assert.equal(await owner.closeStale('room-f'), false, 'a main room quiet for ten minutes is kept');
    assert.equal(await friend.closeStale('room-d'), true, 'a handed-on room left quiet ends, as a stream does');
    pass('a main room never ends by itself; a handed-on one does when left quiet');
  }

  console.log('7. THE SESSION LETS GO OF A ROOM THAT STOPPED BEING YOURS');
  {
    mock.resetMockWatch();
    const owner = mock.getBrowserWatchRepository('account-owner');
    const rooms = new Map();
    const store = {
      get: (id) => rooms.get(id) ?? null,
      prime: (read) => rooms.set(read.room.id, read),
      apply: (id, change) => {
        const read = rooms.get(id);
        if (!read) return;
        if (change.kind === 'room') rooms.set(id, { ...read, room: change.room });
        else if (change.kind === 'entry') rooms.set(id, { ...read, queue: [...read.queue.filter((entry) => entry.id !== change.entry.id), change.entry] });
      },
    };
    let ids = 0;
    const seen = [];
    const session = new OwnRoomSession({ repository: owner, host: { id: 'account-owner', label: 'OWNER' }, store, newId: () => `own-${(ids += 1)}`, now: () => Date.now(), onRoom: (id) => seen.push(id) });
    await session.load();
    session.started(song(1));
    session.enqueueAll([song(2), song(3)]);
    assert.equal(await session.saved(), true);
    const first = session.id();
    assert.equal(session.isMade(), true);
    await owner.endRoom(first);
    session.renew(first);
    const second = session.id();
    assert.notEqual(second, first, 'a new room');
    assert.equal(session.isMade(), false, 'not written until the next thing you play');
    assert.equal(session.read().queue.length, 0, 'its queue empty');
    assert.equal(session.read().room.currentEntryId, null, 'nothing on');
    session.renew(first);
    assert.equal(session.id(), second, 'the same news twice makes one new room');
    session.started(song(4));
    assert.equal(await session.saved(), true);
    assert.equal((await owner.findMusicRoom('account-owner')).id, second, 'the next play writes the new room, and it is your main room');
    assert.equal(seen[seen.length - 1], second, 'the keeper is told the new room');
    pass('a room that ended or was handed on gives way to a new, empty one, written with the next play');
  }

  console.log('8. THE LISTS');
  {
    const now = Date.now();
    const at = (seconds) => new Date(now - seconds * 1000).toISOString();
    const room = (over) => ({ room: { id: 'x', origin: 'music', isPublic: false, endedAt: null, updatedAt: at(5), startedAt: at(100), isPlaying: true, ...over }, current: null });
    assert.equal(listedRooms([room({})], now).length, 0, 'a private main room is on no list');
    assert.equal(listedRooms([room({ isPublic: true })], now).length, 1, 'a live one is, while its host\'s beat is fresh');
    assert.equal(listedRooms([room({ isPublic: true, updatedAt: at(91) })], now).length, 0, 'gone after 90 quiet seconds');
    pass('a live main room is listed while its host is there, and drops off after 90 seconds; a private one never');
  }

  Date.now = realNow;
  console.log(`check-rooms-perpetual: ${passed} passed`);
  // The mock store's change wire keeps a handle open, as in check-own-room.
  process.exit(0);
})().catch((failure) => {
  Date.now = realNow;
  console.error(failure);
  process.exit(1);
});
