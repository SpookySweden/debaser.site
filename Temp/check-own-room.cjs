/**
 * Your own room (SPEC-rooms-queues.md, phase 1), held where it can fail.
 *
 * Steps (above the fold, because `run-checks.cjs` only reads the first 20 lines for these):
 *   npx tsc app/lib/watch/own-room.ts app/lib/watch/mock-watch-repository.ts app/lib/watch/rules.ts app/lib/watch/go-live-carry.ts app/lib/watch/go-live.ts app/lib/watch/music-rooms.ts app/lib/audio/playlist-adding.ts app/lib/watch/pictures.ts app/lib/watch/links.ts app/lib/watch/own-screen.ts app/lib/watch/outside-pictures.ts --rootDir app/lib --outDir Temp/own-room-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *
 * What it holds, each against the module and a store that counts what is written (never a string in a template):
 *   1. Playing never waits for the database: the browser's copy changes at once, and the write follows.
 *   2. Nothing is written on a clock: a song left playing for an hour writes nothing, and no timer is ever set.
 *   3. Three songs cost what the SPEC says: the room once, then one row and one room write per song.
 *   4. Rows never pile up: only the last 20 plays are kept, and what is on is never deleted.
 *   5. Where a song had got to is worked out from the last write.
 *   6. A write that cannot reach the database waits, in order, and goes again; a refusal is let go of.
 *   7. The queue holds 200 things at most, and a thing is in it once.
 *   8. The store keeps the database's rules by hand: an own room is private, never public, one per person; a
 *      visitor's lives in the browser and only that visitor reads it.
 */
const assert = require('node:assert/strict');

const { OwnRoomSession, OwnRoomRefusal, OWN_QUEUE_MAX, OWN_PLAYED_KEPT, OWN_QUEUE_FULL, playsToPrune, ownRoomPlace, isOwnRoom } = require('./own-room-out/watch/own-room.js');
const { upcoming, playOrder, currentEntry } = require('./own-room-out/watch/rules.js');
const mock = require('./own-room-out/watch/mock-watch-repository.js');

const song = (n) => ({ url: `/assets/audio/song-${n}.mp3`, kind: 'audio', title: `SONG ${n}` });
const video = (n) => ({ url: `https://www.youtube.com/watch?v=aaaaaaaaaa${n}`, kind: 'youtube', title: `VIDEO ${n}` });

/** The browser's copy, as `use-watch-room.ts` keeps it. */
function memoryStore() {
  const rooms = new Map();
  return {
    rooms,
    get: (id) => rooms.get(id) ?? null,
    prime: (read) => rooms.set(read.room.id, read),
    apply: (id, change) => {
      const read = rooms.get(id);
      if (!read) return;
      if (change.kind === 'room') rooms.set(id, { ...read, room: change.room });
      else if (change.kind === 'entry') rooms.set(id, { ...read, queue: [...read.queue.filter((entry) => entry.id !== change.entry.id), change.entry] });
      else if (change.kind === 'removed') rooms.set(id, { ...read, queue: read.queue.filter((entry) => entry.id !== change.id) });
    },
  };
}

/** A store that counts every write, and can be made to hang, to be out of reach, or to refuse. */
function countingRepository() {
  const calls = [];
  const state = { mode: 'ok', existing: null, hung: [] };
  const write = (name, detail) => {
    calls.push({ name, detail });
    if (state.mode === 'offline') return Promise.reject(new Error('offline'));
    if (state.mode === 'refuse') return Promise.reject(new OwnRoomRefusal('NOT ALLOWED'));
    if (state.mode === 'hang') return new Promise((resolve) => state.hung.push(resolve));
    return Promise.resolve();
  };
  return {
    calls,
    state,
    writes: () => calls.filter((call) => !call.name.startsWith('read:')),
    repository: {
      source: 'supabase',
      findMusicRoom: async () => {
        calls.push({ name: 'read:find' });
        return state.existing?.room ?? null;
      },
      readRoom: async () => {
        calls.push({ name: 'read:room' });
        return state.existing;
      },
      openOwnRoom: (input) => write('openOwnRoom', input).then(() => state.opened ?? { room: { id: input.id }, queue: [], messages: [], crowns: [] }),
      addOwnEntries: (roomId, by, rows) => write('addOwnEntries', { roomId, by, rows }),
      removeOwnEntries: (roomId, by, ids) => write('removeOwnEntries', { roomId, by, ids }),
      writePlayback: (roomId, patch) => write('writePlayback', { roomId, patch }),
      startEntry: (roomId, entryId, playIndex) => write('startEntry', { roomId, entryId, playIndex }),
      reorderQueue: (moves, by) => write('reorderQueue', { moves, by }),
    },
  };
}

function session(over = {}) {
  const counted = countingRepository();
  const store = memoryStore();
  let clock = Date.parse('2026-11-14T12:00:00.000Z');
  let ids = 0;
  const waiting = [];
  const made = new OwnRoomSession({
    repository: counted.repository,
    host: { id: 'me', label: 'ME' },
    store,
    newId: () => `id-${(ids += 1)}`,
    now: () => clock,
    onWaiting: (value) => waiting.push(value),
    ...over,
  });
  return { made, counted, store, waiting, tick: (ms) => (clock += ms), now: () => clock };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const names = (counted) => counted.writes().map((call) => call.name);

(async () => {
  /* 0. The pure rules. */
  assert.equal(OWN_QUEUE_MAX, 200, 'at most 200 things queued (the SPEC)');
  assert.equal(OWN_PLAYED_KEPT, 20, 'the last 20 plays are kept (the SPEC)');
  assert.equal(isOwnRoom({ origin: 'music', hostId: 'me' }, 'me'), true, 'your kept room is yours');
  assert.equal(isOwnRoom({ origin: 'music', hostId: 'me' }, 'you'), false, "somebody else's is not");
  assert.equal(isOwnRoom({ origin: 'stream', hostId: 'me' }, 'me'), false, 'a live room you host is not your own room');
  {
    const row = (n, played) => ({ id: `r${n}`, playIndex: played ? n : null, playedAt: played ? 'x' : null });
    const queue = [...Array.from({ length: 23 }, (_, n) => row(n, true)), row(99, false)];
    assert.deepEqual(playsToPrune(queue, 'r22'), ['r0', 'r1', 'r2'], '23 plays: the 3 oldest go, 20 stay');
    assert.deepEqual(playsToPrune(queue, 'r0'), ['r1', 'r2', 'r3'], 'what is on is never one of them, however old');
    assert.deepEqual(playsToPrune(queue.slice(0, 20), 'r19'), [], '20 plays: nothing goes');
  }
  {
    const at = Date.parse('2026-11-14T12:00:00.000Z');
    const room = (over) => ({ positionSeconds: 42, isPlaying: false, updatedAt: new Date(at).toISOString(), ...over });
    assert.equal(ownRoomPlace(room({}), at + 60000), 42, 'paused: where it was paused, however long ago');
    assert.equal(Math.round(ownRoomPlace(room({ isPlaying: true }), at + 30000)), 72, 'playing: walked forward from the last write');
    assert.equal(ownRoomPlace(room({ isPlaying: true }), at + 30000, 60), 0, 'walked past its own end: from the top');
    assert.equal(ownRoomPlace(room({ isPlaying: true }), at + 3 * 24 * 60 * 60 * 1000), 0, 'left "playing" for days: a closed tab, from the top');
  }

  /* 1 and 3. Three songs: the browser first, and what it costs. */
  {
    const { made, counted, store } = session();
    await made.load();
    assert.ok(made.id(), 'a room in the browser before the database has one');
    assert.deepEqual(names(counted), [], 'finding no room writes nothing: the room is made with the first thing that needs it');

    counted.state.mode = 'hang';
    const first = made.started(song(1));
    assert.equal(currentEntry(store.get(made.id())).id, first.id, 'the play is on in the browser at once, while the database has not answered');
    assert.equal(store.get(made.id()).room.isPlaying, true);
    counted.state.mode = 'ok';
    for (const resolve of counted.state.hung.splice(0)) resolve();
    await settle();

    made.started(song(2));
    made.started(song(3));
    await settle();
    assert.deepEqual(
      names(counted),
      ['openOwnRoom', 'addOwnEntries', 'writePlayback', 'addOwnEntries', 'writePlayback', 'addOwnEntries', 'writePlayback'],
      'three songs: the room once, then one row and one room write each',
    );
    assert.equal(playOrder(store.get(made.id()).queue).length, 3, 'three plays filed');
    assert.equal(made.started(song(3)).link.url, song(3).url, 'the same song again is the same play');
    await settle();
    assert.equal(counted.writes().length, 7, 'and writes nothing');
    assert.equal(made.pending(), 0);

    /* 2. Nothing on a clock. */
    const realInterval = global.setInterval;
    const realTimeout = global.setTimeout;
    let timers = 0;
    global.setInterval = (...args) => ((timers += 1), realInterval(...args));
    global.setTimeout = (...args) => ((timers += 1), realTimeout(...args));
    const fresh = session();
    await fresh.made.load();
    fresh.made.started(song(1));
    fresh.made.enqueue(song(2), 'end');
    fresh.made.playback(10, false);
    fresh.made.playback(10, true);
    fresh.made.takeNext();
    global.setInterval = realInterval;
    global.setTimeout = realTimeout;
    await settle();
    assert.equal(timers, 0, 'the room never sets a timer: no heartbeat, no polling');
    const before = fresh.counted.writes().length;
    fresh.tick(60 * 60 * 1000);
    await settle();
    assert.equal(fresh.counted.writes().length, before, 'a song left playing for an hour writes nothing');
  }

  /* 4. Rows never pile up. */
  {
    const { made, counted, store } = session();
    await made.load();
    for (let n = 1; n <= 25; n += 1) made.started(song(n));
    await settle();
    const read = store.get(made.id());
    assert.equal(playOrder(read.queue).length, 20, '25 plays: 20 are kept');
    assert.equal(currentEntry(read).link.url, song(25).url, 'what is on is still there');
    const removed = counted.writes().filter((call) => call.name === 'removeOwnEntries');
    assert.equal(removed.length, 5, 'one delete per play past the twentieth');
    assert.ok(removed.every((call) => call.detail.ids.length === 1), 'one row each');
  }

  /* 5 and playback: written once each, never twice for the same thing. */
  {
    const { made, counted, store, tick } = session();
    await made.load();
    made.started(song(1));
    await settle();
    const base = counted.writes().length;
    made.playback(0.2, true);
    await settle();
    assert.equal(counted.writes().length, base, 'the play that was just filed is not written again by the element saying "playing"');
    tick(30000);
    made.playback(30.1, false);
    await settle();
    assert.equal(counted.writes().length, base + 1, 'pause: one write');
    assert.equal(store.get(made.id()).room.positionSeconds, 30.1);
    made.playback(30.1, false);
    await settle();
    assert.equal(counted.writes().length, base + 1, 'a second pause at the same place: nothing');
    tick(5000);
    made.playback(30.1, true);
    await settle();
    assert.equal(counted.writes().length, base + 2, 'resume: one write');
    assert.equal(Math.round(ownRoomPlace(store.get(made.id()).room, Date.parse(store.get(made.id()).room.updatedAt) + 10000)), 40, 'ten seconds on, the room says ten seconds further');

    // A drag on the scrubber: only the newest place waits behind the write in flight.
    counted.state.mode = 'hang';
    made.playback(100, true);
    made.playback(110, true);
    made.playback(120, true);
    made.playback(130, true);
    counted.state.mode = 'ok';
    for (const resolve of counted.state.hung.splice(0)) resolve();
    await settle();
    const seeks = counted.writes().slice(base + 2);
    assert.equal(seeks.length, 2, 'four seeks in a burst: the first, and the last');
    assert.equal(seeks[1].detail.patch.positionSeconds, 130);
  }

  /* 7. The queue. */
  {
    const { made, counted, store } = session();
    await made.load();
    made.enqueue(song(1), 'end');
    made.enqueue(video(2), 'end');
    made.enqueue(song(3), 'next');
    let waiting = upcoming(store.get(made.id()).queue).map((entry) => entry.link.title);
    assert.deepEqual(waiting, ['SONG 3', 'SONG 1', 'VIDEO 2'], 'PLAY NEXT goes first, ADD TO QUEUE last, songs and videos alike');
    made.enqueue(song(1), 'end');
    waiting = upcoming(store.get(made.id()).queue).map((entry) => entry.link.title);
    assert.deepEqual(waiting, ['SONG 3', 'VIDEO 2', 'SONG 1'], 'a thing is in the queue once: queued again, it moves');
    await settle();
    assert.equal(counted.writes().filter((call) => call.name === 'reorderQueue').length, 1, 'the move is one write');

    const taken = made.takeNext();
    assert.equal(taken.link.title, 'SONG 3', 'the next thing queued becomes what is on');
    assert.equal(currentEntry(store.get(made.id())).id, taken.id);
    assert.equal(made.takeNext().link.kind, 'youtube', 'a video takes its turn like a song');
    made.takeNext();
    assert.equal(made.takeNext(), null, 'nothing left: null, and the bar walks on down the shelf');
    await settle();
    assert.equal(counted.writes().filter((call) => call.name === 'startEntry').length, 3, 'one write per thing started from the queue');

    for (let n = 0; n < OWN_QUEUE_MAX; n += 1) made.enqueue(song(1000 + n), 'end');
    assert.throws(() => made.enqueue(song(5000), 'end'), (error) => error.message === OWN_QUEUE_FULL, 'the 201st is refused in words');
    assert.equal(made.enqueueAll([song(6000), song(6001)]), 0, 'and a batch does not get past it either');
  }
  {
    const { made, store } = session();
    await made.load();
    made.enqueue(song(1), 'end');
    assert.equal(made.enqueueAll([song(1), song(2), song(2), video(3)]), 2, "a visitor's browser queue joins the end: what already waits is not added twice");
    assert.deepEqual(upcoming(store.get(made.id()).queue).map((entry) => entry.link.title), ['SONG 1', 'SONG 2', 'VIDEO 3']);
  }

  /* 6. Out of reach, and refused. */
  {
    const { made, counted, store, waiting } = session();
    await made.load();
    counted.state.mode = 'offline';
    made.started(song(1));
    made.enqueue(song(2), 'end');
    await settle();
    assert.equal(currentEntry(store.get(made.id())).link.url, song(1).url, 'out of reach: the room carries on in the browser');
    assert.ok(made.pending() >= 3, 'and its writes wait');
    assert.equal(waiting[waiting.length - 1], true, 'it says it is waiting');
    counted.state.mode = 'ok';
    counted.calls.length = 0;
    await made.retry();
    assert.deepEqual(names(counted), ['openOwnRoom', 'addOwnEntries', 'writePlayback', 'addOwnEntries'], 'back in reach: they go in the order they were made');
    assert.equal(made.pending(), 0);
    assert.equal(waiting[waiting.length - 1], false);

    counted.state.mode = 'refuse';
    made.enqueue(song(3), 'end');
    await settle();
    assert.equal(made.pending(), 0, 'a refusal is let go of: it is not tried for ever');
    assert.ok(counted.calls.some((call) => call.name === 'read:room'), 'and the room is read again, so the two copies agree');
  }

  /* A room that already exists is found, not made again. */
  {
    const existing = { room: { id: 'kept', origin: 'music', hostId: 'me', currentEntryId: null, positionSeconds: 0, isPlaying: false, updatedAt: '2026-11-14T11:00:00.000Z' }, queue: [], messages: [], crowns: [{ roomId: 'kept', userId: 'me' }] };
    const made = session();
    made.counted.state.existing = existing;
    await made.made.load();
    assert.equal(made.made.id(), 'kept', 'your kept room is found');
    made.made.started(song(1));
    await settle();
    assert.ok(!names(made.counted).includes('openOwnRoom'), 'and never made twice');
  }

  /* Another device made the room first: this browser's blank room moves onto it, with what is on and what waits. */
  {
    const made = session();
    await made.made.load();
    const blank = made.made.id();
    made.counted.state.opened = { room: { id: 'theirs', origin: 'music', hostId: 'me', currentEntryId: null, positionSeconds: 0, isPlaying: false, updatedAt: '2026-11-14T11:00:00.000Z' }, queue: [], messages: [], crowns: [{ roomId: 'theirs', userId: 'me' }] };
    made.made.started(song(1));
    made.made.enqueue(song(2), 'end');
    await settle();
    assert.notEqual(blank, 'theirs');
    assert.equal(made.made.id(), 'theirs', 'the room the database already had is the room');
    const moved = made.store.get('theirs');
    assert.equal(currentEntry(moved)?.link.url, song(1).url, 'what was on came along, so the queue window can find it');
    assert.equal(moved.room.isPlaying, true);
    assert.deepEqual(upcoming(moved.queue).map((entry) => entry.link.title), ['SONG 2'], 'and so did what was waiting');
    const rowWrites = made.counted.writes().filter((call) => call.name === 'addOwnEntries' || call.name === 'writePlayback');
    assert.ok(rowWrites.length >= 3 && rowWrites.every((call) => call.detail.roomId === 'theirs'), 'every write after it lands in the real room');
  }

  /* The room cannot be made (refused for good): the next write asks for it again, not for ever into nothing. */
  {
    const made = session();
    await made.made.load();
    made.counted.state.mode = 'refuse';
    made.made.started(song(1));
    await settle();
    made.counted.state.mode = 'ok';
    made.counted.calls.length = 0;
    made.made.started(song(2));
    await settle();
    assert.equal(names(made.counted)[0], 'openOwnRoom', 'the room is asked for again before anything is written into it');
  }

  /* `saved`: a visitor's browser queue is only emptied once the account's copy has been written. */
  {
    const made = session();
    await made.made.load();
    made.counted.state.mode = 'offline';
    made.made.enqueueAll([song(1), song(2)]);
    assert.equal(await made.made.saved(), false, 'out of reach: not saved, so nothing is taken out of the browser');
    made.counted.state.mode = 'ok';
    assert.equal(await made.made.saved(), true, 'back in reach: saved');
  }

  /* The last thing ended and nothing followed: the room says it stopped, once. */
  {
    const made = session();
    await made.made.load();
    made.made.started(song(1));
    await settle();
    const base = made.counted.writes().length;
    made.made.stopped();
    await settle();
    assert.equal(made.store.get(made.made.id()).room.isPlaying, false, 'a room whose last song has ended does not go on saying "playing"');
    assert.equal(made.counted.writes().length, base + 1, 'one write');
    made.made.stopped();
    await settle();
    assert.equal(made.counted.writes().length, base + 1, 'and not a second');
  }

  /* A read that was out while something was done here is not put over it. */
  {
    const made = session();
    const kept = { room: { id: 'kept', origin: 'music', hostId: 'me', currentEntryId: null, positionSeconds: 0, isPlaying: false, updatedAt: '2026-11-14T11:00:00.000Z' }, queue: [], messages: [], crowns: [{ roomId: 'kept', userId: 'me' }] };
    made.counted.state.existing = kept;
    await made.made.load();
    let answer;
    made.counted.repository.readRoom = () => new Promise((resolve) => (answer = resolve));
    const reading = made.made.refresh();
    await settle();
    made.made.enqueue(song(9), 'end');
    await settle();
    answer(kept);
    await reading;
    assert.deepEqual(upcoming(made.store.get('kept').queue).map((entry) => entry.link.title), ['SONG 9'], 'the stale read did not wipe what was just queued');
  }

  /* 8. The store's own rules, kept by hand as the database keeps them. */
  {
    mock.resetMockWatch();
    const visitor = 'visitor:00000000-0000-4000-8000-000000000001';
    const browser = mock.getBrowserWatchRepository(visitor);
    const opened = await browser.openOwnRoom({ id: 'room-v', host: { id: visitor, label: 'YOU' } });
    assert.equal(opened.room.origin, 'music');
    assert.equal(opened.room.isPublic, false, 'an own room is never public');
    assert.equal(opened.room.privacy, 'private');
    assert.equal((await browser.openOwnRoom({ id: 'room-other', host: { id: visitor, label: 'YOU' } })).room.id, 'room-v', 'one per person: asked again, the same room');
    assert.equal(await mock.getMockWatchRepository().readRoom('room-v'), null, 'nobody else reads it: not another account, not a signed-out reader');
    assert.equal(await mock.getBrowserWatchRepository('visitor:00000000-0000-4000-8000-000000000002').readRoom('room-v'), null, "not another visitor's browser either");
    const door = await mock.getMockWatchRepository().readDoor('room-v');
    assert.equal(door.found, false, 'its door says there is no such room');
    assert.equal(door.live, false, 'and is never open');
    assert.equal(await mock.getMockWatchRepository().readRoomOutline('room-v'), null, 'it has no outline: not how many are in it, not how much is queued');
    assert.equal((await browser.readDoor('room-v')).found, true, 'its owner finds it');
    assert.equal(await mock.getMockWatchRepository().enterRoom('room-v', null), 'refused', 'and nobody joins it');

    await browser.addOwnEntries('room-v', visitor, [{ id: 'e1', roomId: 'room-v', position: 0, inQueue: true, mediaItemId: null, link: song(1), series: null, addedBy: visitor, addedAt: 'x', playedAt: null, playIndex: null }]);
    await browser.addOwnEntries('room-v', visitor, [{ id: 'e1', roomId: 'room-v', position: 0, inQueue: true, mediaItemId: null, link: song(1), series: null, addedBy: visitor, addedAt: 'x', playedAt: null, playIndex: null }]);
    assert.equal((await browser.readRoom('room-v')).queue.length, 1, 'a row sent twice (an answer lost) is there once');
    await assert.rejects(() => browser.addOwnEntries('room-v', 'somebody-else', [{ id: 'e2', roomId: 'room-v', position: 1, inQueue: true, mediaItemId: null, link: song(2), series: null, addedBy: 'x', addedAt: 'x', playedAt: null, playIndex: null }]), OwnRoomRefusal, 'only its owner writes into it');
    await browser.startEntry('room-v', 'e1', 0);
    await browser.removeOwnEntries('room-v', visitor, ['e1']);
    assert.equal((await browser.readRoom('room-v')).queue.length, 0, 'its owner clears a played row, so rows never pile up');
    await assert.rejects(() => browser.removeOwnEntries('room-v', 'somebody-else', ['e1']), OwnRoomRefusal);

    // A whole session against the browser store: a visitor's room, with nothing sent anywhere.
    const store = memoryStore();
    const made = new OwnRoomSession({ repository: browser, host: { id: visitor, label: 'YOU' }, store, newId: () => `v-${Math.random().toString(36).slice(2)}`, now: () => Date.now() });
    await made.load();
    assert.equal(made.id(), 'room-v');
    made.enqueue(song(7), 'end');
    made.started(video(8));
    await settle();
    const kept = await browser.readRoom('room-v');
    assert.deepEqual(upcoming(kept.queue).map((entry) => entry.link.title), ['SONG 7'], "the visitor's queue is in the browser's store");
    assert.equal(currentEntry(kept).link.title, 'VIDEO 8', 'and so is what is on');
  }

  /* 9. Joining by link (Luke, 2026-11-14: "if you have someones link you can still join, with the ability to refresh the link"). */
  {
    mock.resetMockWatch();
    const owner = mock.getBrowserWatchRepository('account-owner');
    const friend = mock.getBrowserWatchRepository('account-friend');
    const stranger = mock.getBrowserWatchRepository('account-stranger');
    const visitor = mock.getBrowserWatchRepository('visitor:00000000-0000-4000-8000-000000000009');
    assert.equal(await owner.ownRoomLink(false), null, 'no room yet: no link');
    await owner.openOwnRoom({ id: 'room-o', host: { id: 'account-owner', label: 'OWNER' } });
    await owner.addOwnEntries('room-o', 'account-owner', [{ id: 'q1', roomId: 'room-o', position: 0, inQueue: true, mediaItemId: null, link: song(1), series: null, addedBy: 'account-owner', addedAt: 'x', playedAt: null, playIndex: null }]);
    assert.equal(await friend.readRoom('room-o'), null, 'before any link: nobody else reads the room');

    const secret = await owner.ownRoomLink(false);
    assert.ok(typeof secret === 'string' && secret.length >= 32 && secret.length <= 64 && /^[0-9a-zA-Z]+$/.test(secret), 'COPY LINK makes a long secret');
    assert.ok(!secret.includes('room-o'), "the link carries a secret, not the room's address");
    assert.equal(await owner.ownRoomLink(false), secret, 'asked again, it is the same link');
    assert.equal(await stranger.readRoom('room-o'), null, 'a link existing lets nobody in by the address');
    assert.equal(await stranger.enterRoom('room-o', null), 'refused', 'nor by the ordinary way in');
    assert.equal(await stranger.joinByLink('x'.repeat(40)), null, 'a wrong secret gets nothing');
    assert.equal(await visitor.joinByLink(secret), null, 'a signed-out visitor cannot join, even with the link');

    assert.equal(await friend.joinByLink(secret), 'room-o', 'somebody signed in with the current link joins');
    const seen = await friend.readRoom('room-o');
    assert.deepEqual(seen.queue.map((entry) => entry.link.title), ['SONG 1'], 'and sees the queue');
    assert.equal((await friend.readDoor('room-o')).found, true, 'the door knows them now');
    const added = await friend.addToQueue({ roomId: 'room-o', addedBy: 'account-friend', position: 5, inQueue: false, link: song(2) });
    assert.equal(added.inQueue, false, 'what they add waits on their own list');
    await assert.rejects(() => friend.addToQueue({ roomId: 'room-o', addedBy: 'account-friend', position: 5, inQueue: true, link: song(3) }), 'only a crown puts a thing straight into the queue');
    await assert.rejects(() => friend.sendMessage({ roomId: 'room-o', queueEntryId: null, mediaItemId: null, author: { id: 'account-friend', label: 'FRIEND' }, body: 'hello', mediaSeconds: 0 }), 'there is no chat in an own room');
    await owner.reorderQueue([{ id: added.id, position: 1, pull: true }], 'account-owner');
    assert.equal((await owner.readRoom('room-o')).queue.find((entry) => entry.id === added.id).inQueue, true, 'the owner pulls it in');

    const fresh = await owner.ownRoomLink(true);
    assert.notEqual(fresh, secret, 'REFRESH LINK makes a new secret');
    assert.equal(await stranger.joinByLink(secret), null, 'the old link lets nobody new in');
    assert.notEqual(await friend.readRoom('room-o'), null, 'whoever already joined stays in (Luke: "Only stops new people")');
    assert.equal(await stranger.joinByLink(fresh), 'room-o', 'the new link works');

    await owner.removeFromRoom('room-o', 'account-friend');
    assert.equal(await friend.readRoom('room-o'), null, 'REMOVE puts them out');
    assert.equal((await friend.readDoor('room-o')).removed, true, 'and the door tells them so');
    assert.equal(await friend.joinByLink(fresh), null, 'even the new link does not let a removed person back');
    assert.equal(await friend.ownRoomLink(false), null, "a joiner asking for a link gets their own room's (none here), never the owner's");
  }

  /* 10. GO LIVE carries what is on and your queue into tonight's room; END STREAM brings back what is left (phase 3). */
  {
    // `replaceWaiting`: what waits is swapped in two writes, and what is on is not touched.
    const made = session();
    await made.made.load();
    const on = made.made.started(song(3));
    made.made.enqueueAll([song(1), song(2)]);
    await settle();
    const base = made.counted.writes().length;
    assert.equal(made.made.replaceWaiting([{ link: song(5) }, { link: video(6) }, { mediaItemId: 'file-7' }]), 3);
    const after = made.store.get(made.made.id());
    assert.deepEqual(upcoming(after.queue).map((entry) => entry.link?.title ?? entry.mediaItemId), ['SONG 5', 'VIDEO 6', 'file-7'], 'your queue is what was left, in order');
    assert.equal(currentEntry(after).id, on.id, 'what is on stays on');
    await settle();
    assert.deepEqual(names(made.counted).slice(base), ['removeOwnEntries', 'addOwnEntries'], 'one write out, one write in (the SPEC: at most 200 out, 200 in)');
    assert.equal(made.counted.writes()[base].detail.ids.length, 2, 'both old rows go in the one write');
    made.made.replaceWaiting([]);
    assert.deepEqual(upcoming(made.store.get(made.made.id()).queue), [], 'nothing left in the live queue: an empty queue at home');
    assert.equal(made.made.replaceWaiting(Array.from({ length: 250 }, (_, n) => ({ link: song(100 + n) }))), OWN_QUEUE_MAX, 'never more than the queue holds');
  }
  {
    const carry = require('./own-room-out/watch/go-live-carry.js');
    const client = require('./own-room-out/watch/own-room-client.js');
    const floating = require('./own-room-out/ui/floating-player.js');
    mock.resetMockWatch();
    const host = mock.getBrowserWatchRepository('account-host');
    const friend = mock.getBrowserWatchRepository('account-friend');
    const stranger = mock.getBrowserWatchRepository('account-stranger');

    // Alone: a song on, two things waiting.
    const store = memoryStore();
    let ids = 0;
    const own = new OwnRoomSession({ repository: host, host: { id: 'account-host', label: 'HOST' }, store, newId: () => `own-${(ids += 1)}`, now: () => Date.now() });
    await own.load();
    const bar = { track: { src: song(1).url, title: 'SONG 1' }, playing: true, audioElement: () => ({ currentTime: 42.5 }) };
    own.started(song(1));
    own.enqueueAll([song(2), video(3)]);
    await settle();
    client.setOwnRoom({ session: own, roomId: own.id(), hostId: 'account-host', visitor: false, waiting: false });

    const taken = carry.whatToCarry(bar);
    assert.equal(taken.song.link.url, song(1).url, 'the song on the bar is what is on');
    assert.equal(taken.song.place, 42.5, 'from where it has got to');
    assert.equal(taken.song.playing, true);
    assert.equal(taken.video, null);
    assert.deepEqual(taken.waiting.map((thing) => thing.link.title), ['SONG 2', 'VIDEO 3'], 'the queue comes too, in order');
    assert.equal(carry.whatToCarry({ ...bar, playing: false, track: { src: '/assets/audio/another.mp3', title: 'X' } }).song, null, 'a song merely left on the bar, not playing and not what your room has on, is not carried');
    assert.equal(carry.whatToCarry({ ...bar, playing: false }).song.playing, false, 'a paused song your room has on is carried paused');
    floating.playFloating({ id: 'row-9', title: 'VIDEO 9', shape: 'video', room: { link: video(9) }, player: { kind: 'file', src: 'https://example.org/v.mp4' } });
    floating.notePlace('row-9', 77);
    const withVideo = carry.whatToCarry({ ...bar, playing: false });
    assert.equal(withVideo.song, null, 'a video on the screen while the bar is quiet: the video is what is on');
    assert.equal(withVideo.video.source.link.title, 'VIDEO 9');
    assert.equal(withVideo.video.place, 77, 'from where it has got to');
    assert.notEqual(carry.whatToCarry(bar).song, null, 'while the bar plays, the song is what is on');
    floating.closeFloating();

    // START: the room is filed as `goLiveEmpty` files it.
    const live = await host.openRoom({ id: 'room-live', host: { id: 'account-host', label: 'HOST' }, mediaItemId: null, privacy: 'private' });
    assert.equal(live.room.origin, 'stream', 'going live always makes a new room');
    const first = await host.playNow({ roomId: 'room-live', by: 'account-host', link: taken.song.link, position: 0, playIndex: 0 });
    await host.writePlayback('room-live', { currentEntryId: first.id, positionSeconds: taken.song.place, isPlaying: true });
    const rows = taken.waiting.map((thing, n) => ({ id: `carried-${n}`, roomId: 'room-live', position: n + 1, inQueue: true, mediaItemId: thing.mediaItemId ?? null, link: thing.link ?? null, series: null, addedBy: 'account-host', addedAt: 'x', playedAt: null, playIndex: null }));
    await host.addOwnEntries('room-live', 'account-host', rows);
    const opened = await host.readRoom('room-live');
    assert.equal(currentEntry(opened).link.url, song(1).url, 'what was on is the first play');
    assert.equal(opened.room.positionSeconds, 42.5, 'from the same spot');
    assert.deepEqual(upcoming(opened.queue).map((entry) => entry.link.title), ['SONG 2', 'VIDEO 3'], 'the queue is behind it, in order');
    assert.equal(await stranger.readRoom('room-live'), null, 'a private live room is read by nobody outside it, carried queue and all');
    await assert.rejects(() => stranger.addOwnEntries('room-live', 'account-stranger', [{ ...rows[0], id: 'sneak' }]), OwnRoomRefusal, 'only the host writes rows in one go');
    assert.deepEqual(upcoming((await host.readRoom(own.id())).queue).map((entry) => entry.link.title), ['SONG 2', 'VIDEO 3'], 'your own room is left untouched while you are live');

    // Live: one more is added, and the room moves on to the next.
    const extra = await host.addToQueue({ roomId: 'room-live', addedBy: 'account-host', position: 9, inQueue: true, link: song(4) });
    await host.startEntry('room-live', 'carried-0', 1);
    await host.writePlayback('room-live', { currentEntryId: 'carried-0', positionSeconds: 12, isPlaying: true });
    const ending = await host.readRoom('room-live');
    assert.deepEqual(carry.leftWaiting(ending.queue).map((thing) => thing.link.title), ['VIDEO 3', 'SONG 4'], 'what is still waiting, in order');
    assert.ok(extra.id);

    // END STREAM: your own queue becomes what was left, and the song that was on is on in your own room, where it had got to.
    carry.comeHome(ending, { now: Date.now(), origin: 'https://debaser.site', song: { place: 15, playing: true } });
    await settle();
    await host.endRoom('room-live');
    const home = store.get(own.id());
    assert.deepEqual(upcoming(home.queue).map((entry) => entry.link.title), ['VIDEO 3', 'SONG 4'], 'your own queue is what was left');
    assert.equal(currentEntry(home).link.url, song(2).url, 'what was on carries on for you alone');
    assert.equal(home.room.positionSeconds, 15, 'from the same spot');
    assert.equal(home.room.isPlaying, true);
    const kept = await host.readRoom(own.id());
    assert.deepEqual(upcoming(kept.queue).map((entry) => entry.link.title), ['VIDEO 3', 'SONG 4'], 'and it is saved, not only drawn');
    assert.notEqual((await host.readRoom('room-live')).room.endedAt, null, 'the live room has ended; its record of what played stays');
    assert.ok(friend);

    // The floating player's own key: the video on the screen goes in, even with a song playing on the bar beside it.
    floating.playFloating({ id: 'row-9', title: 'VIDEO 9', shape: 'video', room: { link: video(9) }, player: { kind: 'file', src: 'https://example.org/v.mp4' } });
    assert.equal(carry.whatToCarry(bar, true).video.source.link.title, 'VIDEO 9', "the float's own GO LIVE takes the video it is drawn under");
    assert.equal(carry.whatToCarry(bar, true).song, null);
    floating.closeFloating();
    client.clearOwnRoom(own);

    // The song GO LIVE filed is known by its row, for a minute, never by comparing clocks.
    carry.noteCarriedSong('row-a', 1000);
    assert.equal(carry.isCarriedSong('row-a', 2000), true, 'the row GO LIVE filed from the bar is not moved when the room first cues it');
    assert.equal(carry.isCarriedSong('row-b', 2000), false, 'any other row is cued where the room says');
    assert.equal(carry.isCarriedSong('row-a', 1000 + 5 * 60 * 1000), false, 'and not for ever');

    // A queue only comes home from a room it really went into (code review, 2026-11-15): with no storage, never.
    assert.equal(carry.wasCarried('room-live'), false, 'a browser with its storage shut brings nothing home, so nothing is lost');
    const tabStore = new Map();
    global.window = { sessionStorage: { getItem: (key) => tabStore.get(key) ?? null, setItem: (key, value) => tabStore.set(key, value), removeItem: (key) => tabStore.delete(key) } };
    const goLive = require('./own-room-out/watch/go-live.js');
    const site = require('./own-room-out/watch/repository.js').getWatchRepository();
    const starter = { id: 'account-starter', displayName: 'STARTER' };
    const asStarter = mock.getBrowserWatchRepository('account-starter');
    const thread = async () => ({ id: 'thread-1' });
    const taking = { song: { link: song(1), place: 12, playing: true }, video: null, waiting: [{ link: song(2) }, { link: video(3) }] };

    const good = await goLive.goLiveEmpty(starter, thread, { privacy: 'private', carry: taking });
    const filled = await asStarter.readRoom(good);
    assert.deepEqual(upcoming(filled.queue).map((entry) => entry.link.title), ['SONG 2', 'VIDEO 3'], 'START writes the queue into the new room');
    assert.equal(filled.room.positionSeconds, 12, 'and what was on, where it had got to');
    assert.equal(carry.isCarriedSong(filled.room.currentEntryId), true, 'the song it filed is the one the bar is left alone for');
    assert.equal(carry.wasCarried(good), true, 'a queue that went in is one END STREAM may bring home');
    carry.forgetCarried(good);
    assert.equal(carry.wasCarried(good), false, 'once home, the note is spent');
    await asStarter.endRoom(good);

    const real = site.addOwnEntries;
    site.addOwnEntries = async () => {
      throw new Error('offline');
    };
    const bad = await goLive.goLiveEmpty(starter, thread, { privacy: 'private', carry: taking });
    site.addOwnEntries = real;
    const unfilled = await asStarter.readRoom(bad);
    assert.notEqual(unfilled, null, 'a queue that could not be written does not stop the room');
    assert.equal(currentEntry(unfilled).link.url, song(1).url, 'what was on still went in');
    assert.deepEqual(upcoming(unfilled.queue), [], 'the queue did not');
    assert.equal(carry.wasCarried(bad), false, 'so END STREAM will not put that empty queue over your own');
    await asStarter.endRoom(bad);

    const realPlay = site.playNow;
    site.playNow = async () => {
      throw new Error('offline');
    };
    const half = await goLive.goLiveEmpty(starter, thread, { privacy: 'private', carry: taking });
    site.playNow = realPlay;
    assert.deepEqual(upcoming((await asStarter.readRoom(half)).queue).map((entry) => entry.link.title), ['SONG 2', 'VIDEO 3'], 'a song that could not be filed does not stop the queue going in');
    assert.equal(carry.wasCarried(half), true);
    await asStarter.endRoom(half);
    delete global.window;
  }

  /* 11. A playlist is a saved queue (phase 4): save a mixed queue, clear it, load it back whole. */
  {
    const lists = require('./own-room-out/watch/music-rooms.js');
    const adding = require('./own-room-out/audio/playlist-adding.js');
    const made = session();
    await made.made.load();
    made.made.started(song(1));
    made.made.enqueueThings([{ link: video(2) }, { mediaItemId: 'file-3' }, { link: song(4) }]);
    await settle();
    const read = made.store.get(made.made.id());
    // Song 1 is on the shelf under an id; song 4 is on no shelf, so it is kept by its address.
    const shelfId = (link) => (link.url === song(1).url ? 'shelf-1' : null);
    const items = lists.storedListItems(read, shelfId, '2026-11-15T12:00:00.000Z');
    assert.deepEqual(items.map((item) => item.trackId), ['shelf-1', `link:${video(2).url}`, 'file:file-3', `link:${song(4).url}`], 'what is on, then what waits, in order: a song by its shelf id, a video and an unshelved song by their address, a file by the file');
    assert.equal(items[1].link.kind, 'youtube', 'a video is kept whole, as a link');
    assert.equal(items[2].link, undefined, "one of the site's own files is kept by the file, never by a copied address");
    assert.equal(lists.storedListItems({ ...read, queue: [...read.queue, { ...read.queue[1], id: 'twin' }] }, shelfId, 'x').length, 4, 'a thing is in the list once');
    assert.match(lists.storedListName(new Date(2026, 10, 15, 9, 5)), /^QUEUE 2026-11-15 09:05$/, 'the name SAVE AS PLAYLIST offers');

    // CLEAR: what waits goes, what is on plays on.
    const base = made.counted.writes().length;
    made.made.replaceWaiting([]);
    await settle();
    assert.deepEqual(upcoming(made.store.get(made.made.id()).queue), [], 'CLEAR empties what waits');
    assert.equal(currentEntry(made.store.get(made.made.id())).link.url, song(1).url, 'what is on plays on');
    assert.deepEqual(names(made.counted).slice(base), ['removeOwnEntries'], 'in one write');

    // LOAD: the list comes back whole, behind what is on; the song that is on is not what "waiting" means, so it queues too.
    const things = lists.listThings(items, (id) => (id === 'shelf-1' ? { src: song(1).url, title: 'SONG 1' } : undefined));
    assert.deepEqual(things.map((thing) => thing.link?.title ?? thing.mediaItemId), ['SONG 1', 'VIDEO 2', 'file-3', 'SONG 4'], 'every item becomes a thing a queue holds');
    assert.equal(made.made.enqueueThings(things), 4);
    assert.deepEqual(upcoming(made.store.get(made.made.id()).queue).map((entry) => entry.link?.title ?? entry.mediaItemId), ['SONG 1', 'VIDEO 2', 'file-3', 'SONG 4'], 'loaded back whole, in order');
    assert.equal(made.made.enqueueThings(things), 0, 'loaded twice, nothing is in the queue twice (links and files alike)');
    assert.deepEqual(lists.listThings([{ trackId: 'gone', addedAt: 'x' }], () => undefined), [], 'a song no shelf holds any more, kept only by id, is passed over');
    assert.deepEqual(lists.listLinks(items, () => undefined).map((link) => link.title), ['SONG 1', 'VIDEO 2', 'SONG 4'], 'the links alone, for a caller that cannot hold a file: each kept whole, so no shelf is needed to bring one back');

    // ADD TO PLAYLIST takes a video: held whole by its link, found again by its address, never half-saved.
    const said = [];
    const film = { title: 'A FILM', link: { url: 'https://archive.org/download/x/x.mp4', kind: 'file', title: 'A FILM' } };
    const library = { canWrite: true, playlists: [{ id: 'p1', ownerId: 'u', name: 'ROAD', createdAt: '', items: [] }], togglePlaylistTrack: async (...args) => void said.push(args), savePlaylist: async (name) => ({ id: 'p9', ownerId: 'u', name: name.toUpperCase(), createdAt: '', items: [] }) };
    assert.equal(adding.holdable(film), true, 'a video can be held');
    assert.equal(adding.playlistKey(film), `link:${film.link.url}`);
    assert.equal(await adding.toggleInPlaylist(library, film, { id: 'p1', name: 'ROAD', holds: false }), 'added');
    assert.deepEqual(said, [['p1', `link:${film.link.url}`, film.link]], 'filed under its address, with the link kept');
    library.playlists[0].items = [{ trackId: 'web:archive:x:0', addedAt: '', link: film.link }];
    assert.equal(adding.playlistChoices(library, film)[0].holds, true, 'a list that already holds that address says so, whatever id it was filed under');
    said.length = 0;
    await adding.toggleInPlaylist(library, film, { id: 'p1', name: 'ROAD', holds: true });
    assert.deepEqual(said[0].slice(0, 2), ['p1', 'web:archive:x:0'], 'and taking it out takes out the row that is there');
    const siteSong = { title: 'S', link: song(1), trackId: 'shelf-1' };
    said.length = 0;
    await adding.addToNewPlaylist(library, siteSong, 'night');
    assert.deepEqual(said, [['p9', 'shelf-1', undefined]], 'a site song is still held by its id alone');
  }
  {
    // CLEAR in a live room is a crown's: what has not played goes in one write, what played stays as the room's record.
    mock.resetMockWatch();
    const host = mock.getBrowserWatchRepository('account-host');
    const guest = mock.getBrowserWatchRepository('account-guest');
    await host.openRoom({ id: 'room-c', host: { id: 'account-host', label: 'HOST' }, mediaItemId: null, privacy: 'open' });
    const played = await host.playNow({ roomId: 'room-c', by: 'account-host', link: song(1), position: 0, playIndex: 0 });
    const next = await host.addToQueue({ roomId: 'room-c', addedBy: 'account-host', position: 1, inQueue: true, link: song(2) });
    await assert.rejects(() => guest.removeOwnEntries('room-c', 'account-guest', [next.id]), OwnRoomRefusal, 'somebody without a crown clears nothing');
    await host.removeOwnEntries('room-c', 'account-host', [played.id, next.id]);
    assert.deepEqual((await host.readRoom('room-c')).queue.map((entry) => entry.id), [played.id], 'the crown clears what waits; the play stays');
  }

  /* 12. Pictures in a queue (phase 5): from the site or a source it trusts, held until NEXT. */
  {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example-project.supabase.co';
    const pictures = require('./own-room-out/watch/pictures.js');
    const links = require('./own-room-out/watch/links.js');
    const screens = require('./own-room-out/watch/own-screen.js');
    const filesPicture = 'https://example-project.supabase.co/storage/v1/object/public/media/images/cat.png';
    const commons = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Cat.jpg/640px-Cat.jpg';
    const outside = 'https://pictures.example.net/cat.jpg';

    assert.equal(pictures.isSitePicture('/assets/files/cat.png'), true, "one of the site's own paths");
    assert.equal(pictures.isSitePicture('//evil.example/cat.png'), false, 'never `//`, which is another host');
    // Code review, 2026-11-15: decided the way a browser reads the address, never by its first characters. A browser
    // reads a backslash as a slash and drops tabs and line breaks, so each of these would load from another site.
    const songs = require('./own-room-out/watch/songs.js');
    for (const [trick, why] of [
      ['/\\evil.example/cat.png', 'a backslash is a slash to a browser'],
      ['\\/evil.example/cat.png', 'a leading backslash'],
      ['/\t/evil.example/cat.png', 'a tab is dropped by a browser'],
      ['/\n/evil.example/cat.png', 'so is a line break'],
      ['/ /evil.example/cat.png', 'a space'],
      ['/assets/\\..\\..\\evil', 'backslashes further in'],
    ]) {
      assert.equal(pictures.isSitePicture(trick), false, `not the site's own picture: ${why}`);
      assert.equal(songs.isSitePath(trick), false, `not a site path: ${why}`);
      assert.notEqual(links.queueRefusal({ url: trick, kind: 'picture', title: 'X' }), null, `and it cannot be queued: ${why}`);
      assert.notEqual(links.queueRefusal({ url: trick, kind: 'audio', title: 'X' }), null, `as a song either: ${why}`);
    }
    assert.equal(songs.isSitePath('/assets/audio/song-1.mp3'), true, 'a plain site path is still a site path');
    // A picture's address is only ever a file: nothing that walks elsewhere, and no route that does work when asked.
    assert.equal(pictures.isSitePicture('/assets/files/../../api/web/fetch'), false, 'no walking up out of the files');
    assert.equal(pictures.isSitePicture('/assets/files/%2e%2e/secret.png'), false, 'nor the same written as an escape');
    assert.equal(pictures.isSitePicture('/api/web/subtitles?x=1'), false, "one of the site's working routes is not a picture");
    assert.equal(pictures.isSitePicture('/_next/image?url=https%3A%2F%2Fevil.example%2Fx.png'), false, 'least of all the image optimiser');
    assert.equal(pictures.isSitePicture('/assets/files/cat.png?size=2'), false, 'a file has no question after it');
    assert.equal(pictures.isSitePicture('https://example-project.supabase.co/storage/v1/object/public/../../../auth/v1/user'), false, "walking out of the site's own storage");
    assert.equal(pictures.isSitePicture('https://example-project.supabase.co/storage/v1/object/public/media/%2e%2e/%2e%2e/x'), false);
    assert.equal(pictures.isSitePicture(filesPicture), true, "a file in the site's own storage");
    assert.equal(pictures.isSitePicture('https://other-project.supabase.co/storage/v1/object/public/media/cat.png'), false, "somebody else's storage is not the site's");
    assert.equal(pictures.isTrustedPicture(commons), true, "a MEDIA platform's own picture, on its allow-listed picture host");
    assert.equal(pictures.isTrustedPicture('https://thumb.wikimedia.org/anything/else.jpg'), false, 'the right host with the wrong path is not');
    assert.equal(pictures.isTrustedPicture(outside), false, 'anything else is an outside picture');
    assert.equal(pictures.isTrustedPicture('http://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Cat.jpg/640px-Cat.jpg'), false, 'never plain http');

    const made = pictures.pictureLink(commons, '  A Cat  ', 'Somebody');
    assert.deepEqual(made, { url: commons, kind: 'picture', title: 'A Cat · Somebody' }, 'a picture is its address, its kind and its title, with who made it');
    assert.equal(pictures.pictureLink(commons, 'x'.repeat(400)).title.length, 200, 'the title is kept to what a queue row holds');
    assert.equal(links.queueRefusal(made), null, 'a trusted picture can be queued');
    assert.equal(links.queueRefusal(pictures.pictureLink('/assets/files/cat.png', 'CAT')), null, "so can one of the site's own paths");
    assert.equal(links.queueRefusal(pictures.pictureLink(filesPicture, 'CAT')), null);
    // Changed on purpose in phase 6: an outside picture at a public address can be queued (it is covered for everybody else).
    assert.equal(links.queueRefusal(pictures.pictureLink(outside, 'CAT')), null, 'an outside picture at a public address can be queued');
    assert.equal(pictures.isTrustedPicture(outside), false, 'but it is never one the site draws by itself');
    assert.equal(links.queueRefusal(pictures.pictureLink('https://pictures.example.net/x.svg', 'X')), pictures.PICTURE_REFUSALS.svg, 'an SVG is refused by its name');
    assert.equal(pictures.looksLikeSvg('https://a.example/x.SVGZ?size=2#top'), true);
    assert.equal(links.queueRefusal(pictures.pictureLink('http://pictures.example.net/cat.jpg', 'CAT')), links.LINK_REFUSALS.notHttps);
    assert.equal(links.queueRefusal({ url: '/assets/files/film.mp4', kind: 'file', title: 'FILM' }), links.LINK_REFUSALS.notHttps, 'a site path is still only for a song or a picture');

    // Alone: a picture has a screen of its own (no player), so it can be queued without a live room.
    const screen = screens.floatingForLink(made, 'own:p1', 'https://debaser.site');
    assert.deepEqual(screen.player, { kind: 'picture', src: commons }, 'on your own screen it is the picture, nothing else');
    assert.equal(screen.shape, 'picture');
    assert.equal(screens.soloRefusal(made), null, 'so your own room takes it');
    const floatingRules = require('./own-room-out/ui/floating-player.js');
    assert.equal(floatingRules.takesOrders(screen), false, 'a picture cannot be paused or played: it is held');

    // Its turn comes like anything else's, and it is saved in a playlist whole.
    const own = session();
    await own.made.load();
    own.made.enqueueThings([{ link: song(1) }, { link: made }, { link: song(2) }]);
    assert.equal(own.made.takeNext().link.title, 'SONG 1');
    const turn = own.made.takeNext();
    assert.equal(turn.link.kind, 'picture', 'the picture takes its turn between the two songs');
    assert.equal(currentEntry(own.store.get(own.made.id())).id, turn.id, 'and is what the room has on');
    const lists = require('./own-room-out/watch/music-rooms.js');
    const saved = lists.storedListItems(own.store.get(own.made.id()), () => null, 'x');
    assert.equal(saved[0].link.kind, 'picture', 'a playlist holds a picture, whole');
    assert.equal(lists.listThings(saved, () => undefined)[0].link.url, commons);

    // In a live room: the host or a crown takes it off; nobody else does; and only a picture.
    mock.resetMockWatch();
    const host = mock.getBrowserWatchRepository('account-host');
    await host.openRoom({ id: 'room-p', host: { id: 'account-host', label: 'HOST' }, mediaItemId: null, privacy: 'open' });
    const first = await host.playNow({ roomId: 'room-p', by: 'account-host', link: song(1), position: 0, playIndex: 0 });
    assert.equal(await host.pictureNext('room-p', 'account-host'), false, 'NEXT-off-a-picture does nothing to a song');
    assert.equal((await host.readRoom('room-p')).room.currentEntryId, first.id);
    const picture = await host.addToQueue({ roomId: 'room-p', addedBy: 'account-host', position: 1, inQueue: true, link: made });
    await assert.rejects(() => host.addToQueue({ roomId: 'room-p', addedBy: 'account-host', position: 2, inQueue: true, link: pictures.pictureLink('https://192.168.1.10/cat.jpg', 'CAT') }), 'the store refuses a picture at a private address, as the key does');
    await host.startEntry('room-p', picture.id, 1);
    assert.equal(await host.pictureNext('room-p', 'account-guest'), false, 'somebody with no crown cannot take the picture off');
    assert.equal((await host.readRoom('room-p')).room.currentEntryId, picture.id, 'it is still on');
    await host.setCrown('room-p', 'account-guest', true, 'account-host');
    assert.equal(await host.pictureNext('room-p', 'account-guest'), true, 'a crown can');
    const after = (await host.readRoom('room-p')).room;
    assert.equal(after.currentEntryId, null, "the room's pointer is cleared, for the host's tab to start what is next");
    assert.equal(after.isPlaying, false);
    assert.equal(await host.pictureNext('room-p', 'account-host'), false, 'and with nothing on there is nothing to take off');
  }

  /* 13. Outside pictures (phase 6): any pasted https image link, with every guard, covered until each viewer says SHOW. */
  {
    const pictures = require('./own-room-out/watch/pictures.js');
    const links = require('./own-room-out/watch/links.js');
    const choice = require('./own-room-out/watch/outside-pictures.js');
    const good = 'https://pictures.example.net/cats/cat.jpg';

    assert.equal(pictures.outsideAddressRefusal(good), null, 'a public https address is taken');
    assert.equal(pictures.outsideAddressRefusal('https://cdn.example.co.uk/a/b?format=jpg&name=large'), null, 'with or without a picture file name');
    // Each refused kind of address, by the SPEC's table: this is what stops a link aimed at a device on the viewer's own network.
    for (const [url, reason, why] of [
      ['http://pictures.example.net/cat.jpg', pictures.PICTURE_REFUSALS.notHttps, 'plain http'],
      ['ftp://pictures.example.net/cat.jpg', pictures.PICTURE_REFUSALS.notHttps, 'another kind of address'],
      ['https://user:pass@pictures.example.net/cat.jpg', pictures.PICTURE_REFUSALS.notPublic, 'a name and password in it'],
      ['https://user@pictures.example.net/cat.jpg', pictures.PICTURE_REFUSALS.notPublic, 'a name in it'],
      ['https://pictures.example.net:8443/cat.jpg', pictures.PICTURE_REFUSALS.notPublic, 'a port'],
      ['https://192.168.1.10/cat.jpg', pictures.PICTURE_REFUSALS.notPublic, 'a number address on a home network'],
      ['https://127.0.0.1/cat.jpg', pictures.PICTURE_REFUSALS.notPublic, 'this very computer, by number'],
      ['https://2130706433/cat.jpg', pictures.PICTURE_REFUSALS.notPublic, 'the same number written as one number'],
      ['https://0x7f.1/cat.jpg', pictures.PICTURE_REFUSALS.notPublic, 'or in sixteens'],
      ['https://[::1]/cat.jpg', pictures.PICTURE_REFUSALS.notPublic, 'a number address of the newer kind'],
      ['https://localhost/cat.jpg', pictures.PICTURE_REFUSALS.notPublic, 'localhost'],
      ['https://router/cat.jpg', pictures.PICTURE_REFUSALS.notPublic, 'a one-word host'],
      ['https://printer.local/cat.jpg', pictures.PICTURE_REFUSALS.notPublic, 'a .local host'],
      ['https://files.corp.internal/cat.jpg', pictures.PICTURE_REFUSALS.notPublic, 'a .internal host'],
      ['https://app.localhost/cat.jpg', pictures.PICTURE_REFUSALS.notPublic, 'a .localhost host'],
      ['https://pictures.example.net\\@192.168.1.10/cat.jpg', pictures.PICTURE_REFUSALS.notPublic, 'a backslash, which a browser reads as a slash'],
      ['https://pictures.example.net/cat.jpg\n', pictures.PICTURE_REFUSALS.notPublic, 'a line break in it'],
      ['https://pictures.example.net/logo.svg', pictures.PICTURE_REFUSALS.svg, 'an SVG, by its name'],
      ['https://pictures.example.net/logo.SVGZ?x=1', pictures.PICTURE_REFUSALS.svg, 'a packed SVG'],
      ['not an address', pictures.PICTURE_REFUSALS.notPublic, 'words'],
      ['cat.jpg', pictures.PICTURE_REFUSALS.notPicture, 'a bare file name'],
    ]) {
      assert.equal(pictures.outsideAddressRefusal(url), reason, `refused: ${why}`);
      assert.notEqual(links.queueRefusal({ url, kind: 'picture', title: 'X' }), null, `and it cannot be written to a queue: ${why}`);
    }
    assert.equal(links.queueRefusal(pictures.pictureLink(good, 'CAT')), null, 'an outside picture with a public address can be queued now');

    // The size on screen, always; the megabytes and the type, where the outside server says.
    assert.equal(pictures.dimensionsRefusal(4096, 3000), null, '4,096 a side is the most');
    assert.equal(pictures.dimensionsRefusal(4097, 10), pictures.PICTURE_REFUSALS.tooLarge, 'one pixel wider is refused');
    assert.equal(pictures.dimensionsRefusal(10, 4097), pictures.PICTURE_REFUSALS.tooLarge);
    assert.equal(pictures.dimensionsRefusal(4096, 4096), pictures.PICTURE_REFUSALS.tooLarge, '16 million pixels in all is the most');
    assert.equal(pictures.dimensionsRefusal(4000, 4000), null);
    assert.equal(pictures.dimensionsRefusal(0, 0), pictures.PICTURE_REFUSALS.wouldNotLoad, 'nothing drawn is not a picture');
    assert.equal(pictures.headRefusal('image/png', 1000), null);
    assert.equal(pictures.headRefusal(null, null), null, 'a server that says nothing decides nothing: the drawing test does');
    assert.equal(pictures.headRefusal('image/jpeg', 10 * 1024 * 1024 + 1), pictures.PICTURE_REFUSALS.tooBig, 'over 10 MB, where the server says so');
    assert.equal(pictures.headRefusal('image/svg+xml; charset=utf-8', 10), pictures.PICTURE_REFUSALS.svg, 'an SVG by its type, whatever its name');
    assert.equal(pictures.headRefusal('text/html', 10), pictures.PICTURE_REFUSALS.notPicture, 'a page is not a picture');
    assert.equal(pictures.PICTURE_LOAD_MS, 8000, 'eight seconds to load and draw');

    // A pasted address: a picture by its file name, with its address rules; an SVG says why.
    const pasted = links.recognizeLink(good);
    assert.deepEqual(pasted, { ok: true, link: { url: good, kind: 'picture', title: 'cat.jpg' } }, 'a pasted picture link is a picture, titled by its file name');
    assert.deepEqual(links.recognizeLink('https://pictures.example.net/logo.svg'), { ok: false, reason: pictures.PICTURE_REFUSALS.svg });
    assert.equal(links.recognizeLink('https://192.168.1.10/cat.png').ok, false, 'a picture on a number address is refused as it is typed');
    assert.equal(links.recognizeLink('https://pictures.example.net/film.mp4').link.kind, 'file', 'a video link is still a video');
    assert.equal(pictures.recognizePicture('https://cdn.example.co.uk/media/abc?format=jpg').ok, true, 'a link with no picture file name may still be tried as one');
    assert.equal(pictures.recognizePicture('https://printer.local/abc').ok, false, 'but never one at a private address');

    // The per-viewer switch: covered unless this viewer has said otherwise.
    const ask = { mode: 'ask', rooms: [], added: [] };
    // "Yours" is what this browser remembers pasting, never whose name is on the queue row (code review, 2026-11-15):
    // a playlist saved from somebody's room and loaded again files every row under the loader's own name.
    assert.equal(choice.addedHere({ mode: 'ask', rooms: [], added: [good] }, good), true, 'an address this browser pasted is yours');
    assert.equal(choice.addedHere({ mode: 'ask', rooms: [], added: [good] }, `${good}?other`), false, 'that address and no other');
    assert.equal(choice.outsideAnswer(ask, { mine: choice.addedHere(ask, good), roomId: 'r1', guest: false }), 'ask', "a picture you never pasted is covered, even on a row filed under your own name");
    assert.equal(choice.outsideAnswer(ask, { mine: true, roomId: 'r1', guest: true }), 'ask', 'and a guest is asked even then');
    assert.equal(choice.outsideAnswer(ask, { mine: false, roomId: 'r1', guest: false }), 'ask', "somebody else's outside picture arrives covered");
    assert.equal(choice.outsideAnswer(ask, { mine: true, roomId: 'r1', guest: false }), 'show', 'one you added shows for you at once');
    assert.equal(choice.outsideAnswer({ mode: 'ask', rooms: ['r1'] }, { mine: false, roomId: 'r1', guest: false }), 'show', 'ALWAYS SHOW IN THIS ROOM, in that room');
    assert.equal(choice.outsideAnswer({ mode: 'ask', rooms: ['r1'] }, { mine: false, roomId: 'r2', guest: false }), 'ask', 'and in no other');
    assert.equal(choice.outsideAnswer({ mode: 'always', rooms: [] }, { mine: false, roomId: null, guest: false }), 'show', 'ALWAYS SHOW in Preferences');
    assert.equal(choice.outsideAnswer({ mode: 'never', rooms: ['r1'] }, { mine: false, roomId: 'r1', guest: false }), 'never', 'NEVER in Preferences wins over a room');
    assert.equal(choice.outsideAnswer({ mode: 'always', rooms: ['r1'] }, { mine: false, roomId: 'r1', guest: true }), 'ask', 'a guest is always asked, whatever the browser has kept');
    assert.deepEqual(choice.parseOutsidePictures(null), { mode: 'ask', rooms: [], added: [] }, 'it starts on ASK, with nothing of yours');
    assert.deepEqual(choice.parseOutsidePictures('{"mode":"sometimes","rooms":"x","added":7}'), { mode: 'ask', rooms: [], added: [] }, 'anything unreadable is ASK: covered');
    assert.deepEqual(choice.parseOutsidePictures('not json'), { mode: 'ask', rooms: [], added: [] });
    assert.deepEqual(choice.parseOutsidePictures(JSON.stringify({ mode: 'ask', rooms: [], added: [good, 5, 'x'.repeat(3000)] })).added, [good], 'only addresses are kept as yours');
    assert.equal(choice.parseOutsidePictures('{"mode":"never","rooms":["a"]}').mode, 'never');

    // Taking one out before it shows: a crown, whoever added it, and the room's host; nobody else.
    const row = (over) => ({ link: pictures.pictureLink(good, 'CAT'), addedBy: 'adder', playedAt: null, ...over });
    assert.equal(pictures.mayTakeOutPicture(row({}), 'host', 'adder'), true, 'whoever added it');
    assert.equal(pictures.mayTakeOutPicture(row({}), 'host', 'host'), true, "the room's host");
    assert.equal(pictures.mayTakeOutPicture(row({}), 'host', 'somebody'), false, 'not somebody else');
    assert.equal(pictures.mayTakeOutPicture(row({}), 'host', null), false);
    assert.equal(pictures.mayTakeOutPicture(row({ playedAt: 'x' }), 'host', 'adder'), false, 'not once it has shown');
    assert.equal(pictures.mayTakeOutPicture(row({ link: song(1) }), 'host', 'host'), false, 'and this way is only for a picture');
    mock.resetMockWatch();
    const host = mock.getBrowserWatchRepository('account-host');
    await host.openRoom({ id: 'room-o', host: { id: 'account-host', label: 'HOST' }, mediaItemId: null, privacy: 'open' });
    const add = (by, position) => mock.getBrowserWatchRepository(by).addToQueue({ roomId: 'room-o', addedBy: by, position, inQueue: by === 'account-host', link: pictures.pictureLink(`${good}?n=${position}`, 'CAT') });
    await mock.getBrowserWatchRepository('account-adder').enterRoom('room-o', null);
    const theirs = await add('account-adder', 1);
    await host.reorderQueue([{ id: theirs.id, position: 1, pull: true }], 'account-host');
    await assert.rejects(() => mock.getBrowserWatchRepository('account-other').removeFromQueue(theirs.id, 'account-other'), 'somebody else cannot take the picture out');
    await mock.getBrowserWatchRepository('account-adder').removeFromQueue(theirs.id, 'account-adder');
    assert.equal((await host.readRoom('room-o')).queue.length, 0, 'whoever added a picture takes it out, even after a crown pulled it into the queue');
    const second = await add('account-adder', 2);
    await host.setCrown('room-o', 'account-host', false, 'account-host');
    await host.removeFromQueue(second.id, 'account-host');
    assert.equal((await host.readRoom('room-o')).queue.length, 0, 'and so does the host, with no crown');
  }

  console.log('check-own-room: every assertion passed');
  // The browser store keeps a BroadcastChannel open, which would hold this process up for ever.
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
