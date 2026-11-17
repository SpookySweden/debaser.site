/*
 * ROOMPOLISH (Luke's list, 2026-11-17): the room's keys as video-player symbols, the visualiser and canvas keys' stand-ins and
 * their quiet corner, and your room's WHO CAN JOIN and END ROOM moved into the cog. The browser proof (the cog opening on WHO
 * CAN JOIN, the corner keys hiding after five minutes, the symbols as Edge and Chrome draw them) is
 * scripts/drive-roompolish.cjs on a mock server.
 *   npx tsc app/lib/watch/room-frame.ts app/components/VisualiserToggle.tsx app/components/CanvasToggle.tsx app/components/StreamBarKeys.tsx app/components/MainRoomKeys.tsx app/components/RoomSettingsWindow.tsx app/components/RoomCornerKeys.tsx --rootDir app --outDir Temp/roompolish-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-roompolish.cjs
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://abcdefgh.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'anon';
const el = React.createElement;
const OUT = path.join(__dirname, 'roompolish-out');
function stub(file, exports) {
  const resolved = require.resolve(path.join(OUT, file));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } };
}
stub('components/ArtMark.js', { default: ({ fallback }) => fallback });
stub('components/PopoutWindow.js', { default: ({ title, children }) => el('div', { 'data-window': title }, children) });
stub('components/ForumProvider.js', { useForum: () => ({ createThread: async () => ({ id: 't' }) }) });

const frame = require('./roompolish-out/lib/watch/room-frame.js');
const VisualiserToggle = require('./roompolish-out/components/VisualiserToggle.js').default;
const CanvasToggle = require('./roompolish-out/components/CanvasToggle.js').default;
const { QualityKey } = require('./roompolish-out/components/StreamBarKeys.js');
const mainRoom = require('./roompolish-out/components/MainRoomKeys.js');
const RoomSettingsWindow = require('./roompolish-out/components/RoomSettingsWindow.js').default;
const RoomCornerKeys = require('./roompolish-out/components/RoomCornerKeys.js').default;
const html = (node) => renderToStaticMarkup(node);
/** What a reader sees: tags and React's text joins dropped. */
const seen = (markup) => markup.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
let passed = 0;
const ok = (label) => {
  passed += 1;
  console.log(`  ok  ${label}`);
};

/* 1. The marks: ones every system's symbol font has, none drawn as a coloured emoji ---------------------------------------- */
// Updated on purpose 2026-11-17: VIS and CANVAS are words again (Luke: "for the canvas and visualiser can we revert their
// buttons to how they were before the symbol change"), so only the four player marks are checked here.
const marks = { FULL: frame.ROOM_FULL_MARK, LEAVE: frame.ROOM_LEAVE_FULL_MARK, PIP: frame.ROOM_PIP_MARK, QUALITY: frame.ROOM_QUALITY_MARK };
assert.deepEqual(marks, { FULL: '⤢', LEAVE: '⤡', PIP: '⧉', QUALITY: 'HD' }, 'the agreed marks (2026-11-17 research: in Segoe UI Symbol, Apple Symbols and Noto)');
assert.equal(frame.ROOM_VIS_MARK, undefined, 'no visualiser mark any more');
assert.equal(frame.ROOM_CANVAS_MARK, undefined, 'no canvas mark any more');
for (const [name, mark] of Object.entries(marks)) {
  assert.ok(!/\p{Extended_Pictographic}/u.test(mark), `${name}: no character with an emoji form (U+270F, U+26F6 would be)`);
  assert.ok(!mark.includes(String.fromCodePoint(0xfe0f)), `${name}: never asked for as emoji (U+FE0F)`);
}
ok('FULL ⤢, leaving it ⤡, PIP ⧉, QUALITY HD: symbol-font characters, none with an emoji form');

/* 2. The visualiser and canvas keys: the marks are only the stand-ins of Luke's drawn ones, and the words stay in the names -- */
const vis = html(el(VisualiserToggle, { roomId: 'r1', audio: false }));
assert.match(vis, /aria-label="Show the music visualiser"/, 'its name keeps the words');
assert.match(vis, /title="Visualiser"/, 'and its tooltip');
assert.ok(seen(vis).includes('[ VIS ]') && !seen(vis).includes('▁▃▅'), `the stand-in reads [ VIS ] again (${seen(vis)})`);
const canvas = html(el(CanvasToggle, { roomId: 'r1', audio: false }));
assert.match(canvas, /aria-label="Show the canvas"/);
assert.match(canvas, /title="Canvas"/);
assert.ok(seen(canvas).includes('[ CANVAS ]') && !seen(canvas).includes('✎'), `the stand-in reads [ CANVAS ] again (${seen(canvas)})`);
for (const file of ['app/components/VisualiserToggle.tsx', 'app/components/CanvasToggle.tsx']) {
  // ArtMark draws Luke's file over the stand-in once it loads: the words have to stay ArtMark's fallback, not replace it.
  assert.match(fs.readFileSync(file, 'utf8'), /<ArtMark src=\{[A-Z_]+\} size=\{[A-Z_0-9]+\} fallback=\{<span>/, `${file}: the words are the art slot's fallback`);
}
ok('VIS reads [ VIS ] and CANVAS [ CANVAS ] again, as the fallbacks of their art slots, with their words in the names and tooltips');

/* 3. QUALITY: HD on the key, the choice in force in its name and tooltip -------------------------------------------------- */
const source = { qualities: () => [{ id: 'auto', label: 'AUTO' }, { id: 'high', label: 'HIGH' }], quality: 'auto', setQuality: () => undefined };
const quality = html(el(QualityKey, { source }));
assert.match(quality, /aria-label="Quality: AUTO"/);
assert.match(quality, /title="Quality: AUTO"/);
assert.ok(seen(quality).includes('[ HD ▴ ]') && !seen(quality).includes('[ AUTO'), `the key reads [ HD ▴ ] (${seen(quality)})`);
ok('QUALITY reads [ HD ▴ ]; its name and tooltip say which quality is on');

/* 4. The five minutes, as one number, and the corner's first paint -------------------------------------------------------- */
assert.equal(frame.ROOM_CORNER_KEYS_AWAKE_MS, 5 * 60 * 1000, "Luke's five minutes");
const corner = html(el(RoomCornerKeys, { box: { current: null } }, el('button', null, 'x')));
assert.match(corner, /data-room-corner-keys="shown"/, 'shown as the room opens');
assert.doesNotMatch(corner, /transition|duration-|ease/, 'no fade (docs/design.md, Feel)');
const cornerSource = fs.readFileSync('app/components/RoomCornerKeys.tsx', 'utf8');
assert.match(cornerSource, /'pointer-events-none opacity-0 has-\[:focus-visible\]:pointer-events-auto has-\[:focus-visible\]:opacity-100'/, 'hidden, they take no press, and a key reached by the keyboard shows them (focus-visible, never focus-within)');
assert.match(cornerSource, /element\.matches\(':hover'\)/, "a pointer resting over the picture (an embed's frame too) counts as hovering");
assert.doesNotMatch(cornerSource, /focus-within:/, "no focus-within: variant");
ok('the corner keys: shown as the room opens, gone after ROOM_CORNER_KEYS_AWAKE_MS (5 minutes) without the pointer, back for the keyboard, no fade');

/* 5. Your main room's bar: GO LIVE opens the cog; nothing on it ends the room ------------------------------------------- */
const room = { id: 'own-r', origin: 'music', isPublic: false, privacy: 'private', hostId: 'a', originalHostId: 'a', originalHostLabel: 'A', forumThreadId: null, endedAt: null, addMode: 'anyone', name: null, topic: null, guestsCanTalk: true, chatOnDiscuss: true };
let asked = 0;
const bar = html(el(mainRoom.default, { room, heir: null, onLeft: () => undefined, onAskLive: () => (asked += 1) }));
assert.match(bar, /data-main-room-live="private"[^>]*aria-haspopup="dialog"[^>]*>\[ GO LIVE \]/, 'GO LIVE stays on the bar, as the way into the cog');
assert.doesNotMatch(bar, /END ROOM|END FOR EVERYBODY|data-main-room-end/, 'no END ROOM on the bar');
assert.doesNotMatch(bar, /data-main-room-who|data-window/, 'and no window of its own');
const liveBar = html(el(mainRoom.default, { room: { ...room, isPublic: true }, heir: { name: 'Bea', userId: 'b' }, onLeft: () => undefined, onAskLive: () => undefined }));
assert.match(liveBar, /\[ ● LIVE \][\s\S]*data-main-room-leave[\s\S]*\[ LEAVE \]/, 'live with somebody to hand it to: ● LIVE and LEAVE');
assert.doesNotMatch(liveBar, /END ROOM/);
ok('your room\'s bar: GO LIVE / ● LIVE (now a shortcut into the cog) and LEAVE; nothing that ends it');

/* 6. The cog: WHO CAN JOIN where the private line was, END ROOM last, for the host ------------------------------------- */
const sections = (forRoom) => ({ liveSection: el(mainRoom.MainRoomLiveSection, { room: forRoom, hostName: 'A' }), endSection: el(mainRoom.MainRoomEndSection, { room: forRoom, onLeft: () => undefined }) });
const cog = html(el(RoomSettingsWindow, { room, userId: 'a', look: null, onClose: () => undefined, ...sections(room), askedLive: 0 }));
assert.match(cog, /data-window="ROOM SETTINGS"/);
assert.match(cog, /data-main-room-who[\s\S]*role="radiogroup" aria-label="Who can join"[\s\S]*data-main-room-privacy="private"[\s\S]*data-main-room-privacy="password"[\s\S]*data-main-room-privacy="open"/, 'WHO CAN JOIN, PRIVATE / PASSWORD / OPEN');
assert.match(cog, /data-main-room-start[^>]*>\[ GO LIVE \]/, 'a private room: GO LIVE');
assert.doesNotMatch(cog, /data-main-room-private/, 'no GO PRIVATE while private');
assert.doesNotMatch(cog, /data-room-own-join/, 'the WHO CAN JOIN section stands in for the private line');
assert.match(cog, /data-room-copy-link[\s\S]*YOUR LOOK[\s\S]*data-room-end-section[\s\S]*data-main-room-end="first"[^>]*>\[ END ROOM \]/, 'its link keys stay; END ROOM comes last');
const liveCog = html(el(RoomSettingsWindow, { room: { ...room, isPublic: true, privacy: 'open' }, userId: 'a', look: null, onClose: () => undefined, ...sections({ ...room, isPublic: true, privacy: 'open' }) }));
assert.match(liveCog, /data-main-room-privacy="open"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-main-room-privacy="open"/, 'live: what it is now is picked');
assert.match(liveCog, /\[ SAVE \][\s\S]*data-main-room-private[^>]*>\[ GO PRIVATE \]/, 'live: SAVE and GO PRIVATE');
const crownCog = html(el(RoomSettingsWindow, { room, userId: 'crown', look: null, onClose: () => undefined, ...sections(room) }));
assert.doesNotMatch(crownCog, /data-main-room-who|data-main-room-end/, "somebody holding a crown gets neither: they are the host's");
ok('the cog: WHO CAN JOIN (GO LIVE, or SAVE and GO PRIVATE once live) where the private line was, END ROOM last, the host\'s alone');

/* 7. A signed-out visitor's own room: its cog says LOG IN for going live, and holds END ROOM ------------------------------ */
const visitor = html(el(mainRoom.VisitorRoomSettings, { room: { ...room, hostId: 'visitor:1' }, onLeft: () => undefined, onClose: () => undefined }));
assert.match(visitor, /data-window="ROOM SETTINGS"/);
assert.match(visitor, /data-main-room-log-in[\s\S]*LOG IN FIRST[\s\S]*href="\/account"[^>]*>\[ LOG IN \]/, 'LOG IN for going live');
assert.doesNotMatch(visitor, /data-main-room-who/, 'no WHO CAN JOIN');
assert.match(visitor, /data-main-room-end="first"[^>]*>\[ END ROOM \]/, 'and END ROOM');
ok("a visitor's room: the cog says LOG IN for going live, and has END ROOM");

/* 8. Room players never take the floating player's module (list-4 build trap) --------------------------------------------- */
// WatchRoom.tsx itself has taken withoutFullscreen from there since before this list (it builds); these are the files added or grown here.
for (const file of ['app/components/RoomCornerKeys.tsx', 'app/components/MainRoomKeys.tsx', 'app/components/RoomSettingsWindow.tsx']) {
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /lib\/ui\/floating-player/, `${file} never imports floating-player.ts`);
}
ok("the corner keys, your room's keys and the cog never import app/lib/ui/floating-player.ts");

console.log(`check-roompolish: ${passed} passed`);
