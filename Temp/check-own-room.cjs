/**
 * Your own room (SPEC-rooms-queues.md, phase 1), held where it can fail.
 *
 * Steps (above the fold, because `run-checks.cjs` only reads the first 20 lines for these):
 *   npx tsc app/lib/watch/own-room.ts app/lib/watch/mock-watch-repository.ts app/lib/watch/rules.ts --rootDir app/lib --outDir Temp/own-room-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
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

  console.log('check-own-room: every assertion passed');
  // The browser store keeps a BroadcastChannel open, which would hold this process up for ever.
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
