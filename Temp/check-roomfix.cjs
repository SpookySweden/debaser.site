/**
 * Luke's room fixes of 2026-11-16 (the ROOMFIX list), held where they can fail without a browser. The browser proof of
 * every item is scripts/drive-roomfix.cjs, on a local mock server.
 *
 *   npx tsc app/lib/watch/room-side-width.ts app/lib/watch/watch-window.ts --rootDir app --outDir Temp/roomfix-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *
 *   1. the side column's dragged width: its limits, kept in this browser, and back to the usual width;
 *   2. CANVAS puts the visualiser away; the visualiser from the canvas goes back to the picture;
 *   4. READ YOUR OWN BOOK is a link within the site, never a fresh page load;
 *   6. YOUR ROOM starts what is added to a blank screen, and not what waited before;
 *   7. the store keeps folding (`[ _ ]`) and PIP apart.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (path) => fs.readFileSync(path, 'utf8');
let count = 0;
const ok = (value, what) => {
  assert.ok(value, what);
  count += 1;
};
const same = (actual, expected, what) => {
  assert.deepEqual(actual, expected, what);
  count += 1;
};

/* 1. The side column's width. */
{
  const kept = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => (kept.has(key) ? kept.get(key) : null),
      setItem: (key, value) => kept.set(key, String(value)),
      removeItem: (key) => kept.delete(key),
    },
  };
  const side = require('./roomfix-out/lib/watch/room-side-width.js');
  same(side.clampSide(400, 1400, 12), 400, 'a width with room on both sides is kept');
  same(side.clampSide(100, 1400, 12), side.SIDE_MIN, 'never narrower than the chat needs');
  same(side.clampSide(5000, 1400, 12), 1400 - 12 - side.STAGE_MIN, 'never so wide the picture loses its room');
  same(side.clampSide(5000, 500, 12), side.SIDE_MIN, 'in a room too small for both, the column keeps its least width');
  same(side.clampSide(333.6, 1400, 12), 334, 'whole pixels');
  side.setRoomSideWidth(420, false);
  same(kept.has('debaser.site.room-side.v1'), false, 'mid-drag nothing is written to the browser yet');
  side.keepRoomSideWidth();
  same(kept.get('debaser.site.room-side.v1'), '420', 'the end of a drag keeps it in this browser');
  side.setRoomSideWidth(null);
  same(kept.has('debaser.site.room-side.v1'), false, 'back to the usual width forgets it');
  delete globalThis.window;

  const frame = read('app/lib/watch/room-frame.ts');
  ok(/sm:w-\(--room-side-w\)/.test(frame) && /'--room-side-w': `\$\{width\}px`/.test(frame), 'the frame draws the column at the dragged width');
  for (const path of ['app/components/WatchRoom.tsx', 'app/components/OwnRoomWindow.tsx']) {
    const room = read(path);
    ok(/<RoomSideGrip \/>/.test(room) && /roomSide\(useRoomSideWidth\(\)\)/.test(room), `${path}: the edge, and the width it was dragged to`);
  }
  const grip = read('app/components/RoomSideGrip.tsx');
  ok(/role="separator"/.test(grip) && /aria-orientation="vertical"/.test(grip) && /ArrowLeft/.test(grip), 'the edge is a separator a keyboard can move');
  ok(/max-sm:hidden/.test(grip), 'and only on a desktop, where the column is beside the picture');
  ok(!/transition/.test(grip), 'it follows the pointer at once, nothing eased');
}

/* 2. CANVAS and the visualiser. */
{
  const canvas = read('app/components/CanvasToggle.tsx');
  ok(/if \(!onCanvas\) setVisualiserOn\(roomId, false\);\s*chooseScreen\(roomId, onCanvas \? 'picture' : 'canvas', audio\);/.test(canvas), 'choosing the canvas puts the visualiser away in the same press');
  const vis = read('app/components/VisualiserToggle.tsx');
  ok(/if \(!showing && onCanvas\) chooseScreen\(roomId, 'picture', audio\);/.test(vis), 'the visualiser switched on from the canvas shows over the picture');
  ok(/<VisualiserToggle roomId=\{roomId\} audio=\{canvasAudio\} \/>/.test(read('app/components/WatchRoom.tsx')), 'the room tells it what is playing');
}

/* 4. READ YOUR OWN BOOK. */
{
  const stream = read('app/components/WebStream.tsx');
  ok(/<Link href="\/read" prefetch=\{false\} className=\{FILTER_KEY\} data-own-book-key>/.test(stream), 'a link within the site');
  ok(!/window\.location\.(assign|href)\s*\(?\s*['"`]\/read/.test(stream), 'never a fresh page load, which took the room and what was playing down with it');
}

/* 6. A blank screen in YOUR ROOM. */
{
  const own = read('app/components/OwnRoomWindow.tsx');
  ok(/const blankNow = readable && !videoOn && song === null;/.test(own), 'blank: nothing on the screen');
  ok(/const grew = waitingSeen\.current !== null && waiting > waitingSeen\.current;/.test(own) && /if \(grew && blankNow\) playNext\(\);/.test(own), 'an add while blank starts it');
  ok(/if \(!readable\) return;/.test(own), 'the room arriving is not an add: a queue that already waited stays put');
  ok(/const toStart = amHost && live \? blankStart\(room, read\.queue\) : null;/.test(read('app/components/WatchRoom.tsx')), 'a live room starts what is in its queue on a blank screen');
  // In a live room ENTER puts a link on your own list, which waits for a crown: on a blank screen it never started.
  const queue = read('app/components/StreamQueueWindow.tsx');
  const blankStraight = /const inQueue = \(straight \|\| ownRoom \|\| screenIsBlank\(read\.room, read\.queue\)\) && rights\.arrange;/g;
  ok((queue.match(blankStraight) ?? []).length === 2, 'a blank screen takes an add (one, or a series) straight into the queue, for somebody who may arrange it');
}

/* 3. YouTube's captions in a room. */
{
  const tube = read('app/lib/watch/youtube-player.ts');
  ok(/const bleed = this\.captionNow !== null \? 0 : Math\.max\(BLEED_FLOOR, shownHeight \* BLEED_SHARE\);/.test(tube), 'a subtitle on: YouTube\'s player loses the margins its captions were drawn in');
  ok(/this\.captionNow = id;\s*\/\/[^\n]*\n\s*this\.layout\(\);/.test(tube), 'and is laid out again as soon as one is chosen or switched off');
}

/* 7. Folding and PIP in the store. */
{
  const windowSlot = require('./roomfix-out/lib/watch/watch-window.js');
  const state = () => windowSlot.watchWindowState();
  windowSlot.openWatch({ kind: 'room', roomId: 'r1' });
  same([state().collapsed, state().pip], [false, false], 'a room opens as its window');
  windowSlot.collapseWatch();
  same([state().collapsed, state().pip], [true, false], '[ _ ] folds it, and nothing floats');
  windowSlot.expandWatch();
  windowSlot.collapseWatch(true);
  same([state().collapsed, state().pip], [true, true], '[ PIP ] folds it with the picture out');
  windowSlot.expandWatch();
  same([state().collapsed, state().pip], [false, false], 'unfolding ends PIP');
  windowSlot.collapseWatch(true);
  windowSlot.openWatch({ kind: 'room', roomId: 'r1' });
  same([state().collapsed, state().pip], [false, false], 'a link to the room unfolds it, PIP and all');
  windowSlot.openWatch({ kind: 'prelive', mediaItemId: 'm' });
  windowSlot.collapseWatch();
  same(state().collapsed, false, 'only a room folds');
  windowSlot.closeWatch();
}

console.log(`check-roomfix: ${count} assertions passed`);
