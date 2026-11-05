/*
 * Scratch check for the ten components that arrived with no render (check-structure's OWED_RENDERS), run from the root:
 *   npx tsc app/components/CatCursor.tsx app/components/CytubeLiveStreams.tsx app/components/CytubePage.tsx app/components/MusicRoomKeeper.tsx app/components/StreamArtShelf.tsx app/components/WebBridgeKeys.tsx app/components/WebMediaRow.tsx app/components/WebSignInGate.tsx app/components/WebSiteFiles.tsx app/components/WebStream.tsx app/components/StreamAddKey.tsx app/components/AuthProvider.tsx app/components/ForumProvider.tsx app/components/MusicPlayerProvider.tsx app/components/PresenceProvider.tsx app/components/PopoutWindow.tsx app/components/CommentWindow.tsx app/lib/auth/builtin-account.ts app/lib/media/catalogue.ts app/lib/ui/cursor-slot.ts app/lib/watch/canvas-repository.ts app/lib/watch/go-live.ts app/lib/watch/repository.ts app/lib/watch/use-music-room.ts app/lib/watch/use-watch-room.ts app/lib/watch/use-watching.ts app/lib/watch/watch-window.ts app/lib/web/bridges.ts app/lib/web/everywhere-client.ts app/lib/web/live-merge.ts app/lib/web/media-servers.ts app/lib/web/media-titles.ts app/lib/web/repository.ts app/lib/web/site-server.ts app/lib/web/web-filters.ts app/lib/web/web-session.ts --rootDir app --outDir Temp/owed-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-owed-renders.cjs
 *
 * What it is for: a server render shows a component's first paint and nothing else, and most of these read their data in
 * an effect or draw it after a press. So a render here can go three steps further, all real code from the component:
 *
 *   - `seeds` start a component's own `useState` where a person would have got to (the rows have arrived, the player is open);
 *   - `runEffects` runs the effects the render asked for, against a small fake window and document, and hands back the cleanup;
 *   - `press` calls the handler the component really put on a key.
 *
 * Fake data and a fake browser, no network and no database. The media servers are two test servers added to the list, so
 * what is on Luke's own list (rewritten by the Debaser Servers program) never changes what this tests.
 */
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const React = require('react');
const jsxRuntime = require('react/jsx-runtime');
const { renderToStaticMarkup } = require('react-dom/server');

const ROOT = join(__dirname, '..');
const el = React.createElement;

/* --- the harness ------------------------------------------------------------------------------------ */

/** A module replaced before anything requires it. */
function stub(path, exports) {
  const resolved = require.resolve(path);
  // `__esModule`: a compiled `import X from` takes `default` from it, rather than wrapping the stub in another one.
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } };
}

/** Exports of a real module replaced in place, so every module reading it sees them, whichever loaded first. */
function override(path, patch) {
  Object.assign(require(path), patch);
}

/** Every host element the last render made, with its props: where `press` finds a real handler. */
let drawn = [];
for (const name of ['jsx', 'jsxs']) {
  const real = jsxRuntime[name];
  jsxRuntime[name] = (type, props, key) => {
    if (typeof type === 'string') drawn.push({ type, props });
    return real(type, props, key);
  };
}

/** The effects the last render asked for. A server render never runs them; `runEffects` does. */
let effects = [];
React.useEffect = (effect) => {
  effects.push(effect);
};

/**
 * `useState` started somewhere else, per component: `{ ComponentName: (initial, position) => value or undefined }`, where
 * position counts that component's `useState` calls in this render. The caller's name comes off the stack.
 */
const realUseState = React.useState;
let seeds = {};
let stateCalls = new Map();
React.useState = (initial) => {
  const value = typeof initial === 'function' ? initial() : initial;
  const owner = /at (\w+) /.exec(new Error().stack.split('\n')[2] ?? '')?.[1] ?? '';
  const position = stateCalls.get(owner) ?? 0;
  stateCalls.set(owner, position + 1);
  const seeded = seeds[owner]?.(value, position);
  return realUseState(() => (seeded === undefined ? value : seeded));
};
/** A seed by position: `slots(undefined, true)` starts the component's second `useState` at true. */
const slots =
  (...values) =>
  (_initial, position) =>
    values[position];

function draw(element, seedsFor = {}) {
  drawn = [];
  effects = [];
  seeds = seedsFor;
  stateCalls = new Map();
  return renderToStaticMarkup(element);
}

/** Runs what the last render's effects asked for; the returned function is the unmount's cleanup. */
function runEffects() {
  const cleanups = effects.splice(0).map((effect) => effect());
  return () => {
    for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup();
  };
}

const textOf = (node) => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return node?.props ? textOf(node.props.children) : '';
};

/** The last render's key with this visible text or spoken name. */
function keyNamed(name) {
  const key = drawn.find(({ props }) => props.onClick && (textOf(props.children) === name || props['aria-label'] === name));
  assert.ok(key, `no key "${name}" on the screen`);
  return key;
}
const press = (name) => keyNamed(name).props.onClick();
const tick = () => new Promise((resolve) => setImmediate(resolve));

/** What a person reads: the markup with its tags gone and its entities undone. */
const visible = (html) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** The opening tag of the element whose text starts with `label`: its attributes are what the key says about itself. */
function openingTag(html, label) {
  const end = html.indexOf(`>${label}`);
  assert.notEqual(end, -1, `"${label}" is not on the screen`);
  return html.slice(html.lastIndexOf('<', end), end + 1);
}

/**
 * A target under the pointer that knows its own tag: enough of `closest` for the selector lists the cursor reads, by
 * each selector's leading tag name.
 */
class FakeElement {
  constructor(tag, { disabled = false } = {}) {
    this.tag = tag;
    this.disabled = disabled;
  }
  closest(selector) {
    const tags = selector
      .replace(/\([^)]*\)/g, '')
      .split(',')
      .map((part) => /^\s*([a-z]+)/.exec(part)?.[1]);
    return tags.includes(this.tag) ? this : null;
  }
  matches() {
    return this.disabled;
  }
}

/** A browser small enough to read: listeners kept by where, type and capture, as a real one matches a removal. */
function fakeBrowser({ fine = true, still = false } = {}) {
  const listeners = [];
  const captureOf = (options) => options === true || options?.capture === true;
  const target = (where) => ({
    addEventListener: (type, fn, options) => listeners.push({ where, type, fn, capture: captureOf(options) }),
    removeEventListener: (type, fn, options) => {
      const at = listeners.findIndex((entry) => entry.where === where && entry.type === type && entry.fn === fn && entry.capture === captureOf(options));
      if (at !== -1) listeners.splice(at, 1);
    },
  });
  const media = (query) => ({ matches: query.includes('any-pointer: fine') ? fine : query.includes('reduced-motion') ? still : false });
  const addresses = [];
  const root = { dataset: {} };
  return {
    listeners,
    root,
    addresses,
    fire: (type, event) => {
      for (const entry of listeners.filter((listener) => listener.type === type)) entry.fn(event);
    },
    window: {
      ...target('window'),
      matchMedia: media,
      setInterval: () => 0,
      clearInterval: () => undefined,
      history: { state: null, replaceState: (_state, _title, address) => addresses.push(address) },
    },
    document: {
      ...target('document'),
      documentElement: root,
      getElementById: () => null,
      elementFromPoint: () => null,
      createElement: (tag) => paintable(tag),
    },
  };
}

/** An element the cursor can write to and animate; `animated` lists the animations by how long each runs. */
function paintable(tag) {
  const node = {
    tag,
    style: {},
    children: [],
    animated: [],
    animate: (_frames, options) => {
      node.animated.push(options.duration);
      return { finished: new Promise(() => undefined) };
    },
    appendChild: (child) => node.children.push(child),
    remove: () => undefined,
  };
  return node;
}

async function inBrowser(browser, work) {
  global.window = browser.window;
  global.document = browser.document;
  global.Element = FakeElement;
  try {
    return await work();
  } finally {
    delete global.window;
    delete global.document;
    delete global.Element;
  }
}

/* --- the world the components read, changed between renders ------------------------------------------ */

const USER = { id: 'reader-1', displayName: 'Reader' };
const SECOND = 1000;
const ago = (seconds) => new Date(Date.now() - seconds * SECOND).toISOString();

/** Everything the screens asked the outside world for, in order. */
let asked = [];
const say = (...entry) => asked.push(entry);
const said = (name) => asked.filter((entry) => entry[0] === name);

let auth = { status: 'signed-out', user: null };
let address = '';
let watching = null;
let watchRead;
let liveRooms = null;
let musicRoom = null;
let watchWindowOpen = false;
let readRoomAnswer = null;
let cursor = 'contrast';
let catalogue = { entries: [], items: [] };
let commentCount = 0;
let playerNow = { queue: [], track: undefined, playing: false };

const FORUM = {
  commentCountForAnchor: (anchor) => {
    say('count', anchor.id);
    return commentCount;
  },
  createThread: async () => ({ id: 'thread-1' }),
  threadForAnchor: () => undefined,
};

stub('./owed-render/components/AuthProvider.js', { default: ({ children }) => children, useAuth: () => auth });
stub('./owed-render/components/ForumProvider.js', { default: ({ children }) => children, useForum: () => FORUM });
stub('./owed-render/components/MusicPlayerProvider.js', {
  default: ({ children }) => children,
  useMusicPlayer: () => ({
    ...playerNow,
    play: (track, origin) => say('play', track.src, origin.href),
    playList: (tracks, origin) => say('playList', tracks.length, origin.href),
    toggle: () => say('toggle'),
  }),
});
stub('./owed-render/components/PresenceProvider.js', { default: ({ children }) => children, usePresence: () => ({ ready: true, status: 'offline', record: undefined }) });
// A pop-up only draws through a portal in a browser, so a render sees its insides this way.
stub('./owed-render/components/PopoutWindow.js', { default: ({ title, children }) => el('div', { 'data-window': title }, children) });
// The comment window has its own check; what matters here is which thread it is opened on.
stub('./owed-render/components/CommentWindow.js', { default: ({ anchor }) => el('div', { 'data-comments': anchor.id, 'data-comments-label': anchor.label }) });
stub('next/navigation', {
  useSearchParams: () => new URLSearchParams(address),
  usePathname: () => '/here',
  useRouter: () => ({ replace: (...args) => say('replace', ...args), push: (...args) => say('push', ...args) }),
});

// Two test servers, before anything reads the list (types.ts, hosts.ts and bridges.ts each read it as they load).
const SERVER_ONE = {
  id: 'owed_one',
  label: 'OWED ONE',
  base: 'https://owed-one.test',
  listPath: '/list.json',
  play: { movie: '/play/movie/{tmdb}', tv: '/play/tv/{tmdb}/{season}/{episode}', series: '/play/series/{tmdb}' },
};
const SERVER_TWO = { ...SERVER_ONE, id: 'owed_two', label: 'OWED TWO', base: 'https://owed-two.test', play: { movie: SERVER_ONE.play.movie, tv: SERVER_ONE.play.tv } };
const mediaServers = require('./owed-render/lib/web/media-servers.js');
mediaServers.MEDIA_SERVERS.push(SERVER_ONE, SERVER_TWO);
mediaServers.MEDIA_SERVER_IDS.push(SERVER_ONE.id, SERVER_TWO.id);

let canvasPieces = [];
const canvasRepo = {
  listPieces: async (options) => {
    say('listPieces', options);
    return canvasPieces;
  },
  setHidden: async (...args) => say('setHidden', ...args),
  findOpenCanvas: async (roomId) => {
    say('findOpenCanvas', roomId);
    return null;
  },
  listSnapshots: async () => [],
  readInputs: async () => [],
};
const watchRepo = {
  findMusicRoom: async (userId) => {
    say('findMusicRoom', userId);
    if (musicRoom === 'unreadable') throw new Error('no answer');
    return musicRoom;
  },
  setRoomPublic: async (...args) => say('setRoomPublic', ...args),
  readRoom: async (roomId) => {
    say('readRoom', roomId);
    return readRoomAnswer;
  },
  addToQueue: async (input) => say('addToQueue', input),
};
const EMPTY_PAGE = { items: [], nextCursor: null };
const webRepo = {
  listItems: async (options) => {
    say('listItems', options);
    return EMPTY_PAGE;
  },
  searchItems: async (options) => {
    say('searchItems', options.query);
    return EMPTY_PAGE;
  },
  itemWords: async () => new Map(),
};

override('./owed-render/lib/media/catalogue.js', { useCatalogue: () => catalogue });
override('./owed-render/lib/ui/cursor-slot.js', { cursorState: () => ({ id: cursor }) });
override('./owed-render/lib/watch/repository.js', { getWatchRepository: () => watchRepo });
override('./owed-render/lib/watch/canvas-repository.js', { getCanvasRepository: () => canvasRepo });
override('./owed-render/lib/watch/go-live.js', { goLiveEmpty: async (user, createThread) => say('goLiveEmpty', user.id, createThread === FORUM.createThread) });
override('./owed-render/lib/watch/use-music-room.js', {
  useLiveRooms: () => ({ rooms: liveRooms, error: null }),
  enterRoom: (...args) => say('enterRoom', ...args),
});
override('./owed-render/lib/watch/use-watching.js', { useWatching: () => watching });
override('./owed-render/lib/watch/use-watch-room.js', {
  useWatchRoom: (roomId) => ({ read: roomId === null ? undefined : watchRead }),
  applyLocalChange: (...args) => say('applyLocalChange', ...args),
});
override('./owed-render/lib/watch/watch-window.js', {
  watchWindowState: () => ({ open: watchWindowOpen }),
  openWatch: (focus) => say('openWatch', focus),
});
override('./owed-render/lib/web/repository.js', { getWebRepository: () => webRepo });
override('./owed-render/lib/web/everywhere-client.js', {
  searchEverywhere: async (query, _after, source) => {
    say('searchEverywhere', source, query);
    return EMPTY_PAGE;
  },
  loadRelated: async () => null,
  loadPeertubeHosts: async () => [],
});
override('./owed-render/lib/web/web-session.js', { webSessionHeaders: async () => ({}) });

const { SITE_ACCOUNT_ID } = require('./owed-render/lib/auth/builtin-account.js');
const { watchLinkForItem, webAnchor } = require('./owed-render/lib/web/bridges.js');
const { arrive, emptyLive } = require('./owed-render/lib/web/live-merge.js');
const { mediaPlayUrl } = require('./owed-render/lib/web/media-titles.js');
const { SITE_FILES_SHOWN, siteFileHref } = require('./owed-render/lib/web/site-server.js');
const { sourcesToAsk } = require('./owed-render/lib/web/web-filters.js');

const CatCursor = require('./owed-render/components/CatCursor.js').default;
const { liveRows, useLiveStreams } = require('./owed-render/components/CytubeLiveStreams.js');
const CytubePage = require('./owed-render/components/CytubePage.js').default;
const MusicRoomKeeper = require('./owed-render/components/MusicRoomKeeper.js').default;
const StreamArtShelf = require('./owed-render/components/StreamArtShelf.js').default;
const { CYTUBE_HREF } = require('./owed-render/components/StreamAddKey.js');
const { canWatch, WebDiscussKey, WebWatchKey, WebWatchPanel } = require('./owed-render/components/WebBridgeKeys.js');
const WebMediaRowModule = require('./owed-render/components/WebMediaRow.js');
const WebSignInGate = require('./owed-render/components/WebSignInGate.js').default;
const WebSiteFiles = require('./owed-render/components/WebSiteFiles.js').default;
const WebStream = require('./owed-render/components/WebStream.js').default;
const WebMediaRow = WebMediaRowModule.default;
const { KinoRow, isKinoRow, isMediaRow } = WebMediaRowModule;

/* --- fixtures --------------------------------------------------------------------------------------- */

const room = (patch = {}) => ({
  id: 'room-1',
  originalHostId: 'host-1',
  originalHostLabel: 'Alice',
  hostId: 'host-1',
  forumThreadId: null,
  currentEntryId: null,
  positionSeconds: 0,
  isPlaying: true,
  startedAt: ago(600),
  updatedAt: ago(1),
  endedAt: null,
  origin: 'stream',
  isPublic: true,
  clearedAt: null,
  ...patch,
});
const entry = (patch = {}) => ({ id: 'entry-1', roomId: 'room-1', position: 0, inQueue: true, link: null, series: null, mediaItemId: null, addedBy: 'host-1', addedAt: ago(60), playedAt: null, playIndex: null, ...patch });

const YT_ID = 'abcdefghijk';
const VIDEO = {
  id: `youtube:${YT_ID}`,
  platform: 'youtube',
  externalId: YT_ID,
  kind: 'video',
  url: `https://youtu.be/${YT_ID}`,
  canonicalUrl: `https://youtu.be/${YT_ID}`,
  title: 'A Train Film',
  creator: 'Prelinger',
  description: '<b>not markup</b>',
  thumbnailUrl: `https://i.ytimg.com/vi/${YT_ID}/hqdefault.jpg`,
  embedUrl: `https://www.youtube-nocookie.com/embed/${YT_ID}`,
  publishedAt: '2026-10-01T10:00:00.000Z',
  alsoOn: [],
};
const PICTURE = { ...VIDEO, id: 'openverse:pic-1', platform: 'openverse', externalId: 'pic-1', kind: 'image', title: 'A Train Picture', url: 'https://example.invalid/pic', thumbnailUrl: undefined, embedUrl: undefined };

const FILM = {
  ...VIDEO,
  id: 'owed_one:film-1',
  platform: 'owed_one',
  externalId: 'film-1',
  title: 'A Long Film',
  thumbnailUrl: undefined,
  embedUrl: undefined,
  publishedAt: '2026-09-01T10:00:00.000Z',
  media: {
    type: 'movie',
    tmdbId: 157336,
    copies: [{ server: 'owed_one' }, { server: 'owed_two' }],
    details: { title: 'A Long Film', date: '2014-11-05', runtimeMinutes: 169, genres: ['Science Fiction'] },
  },
};
const SHOW = {
  ...FILM,
  id: 'owed_one:show-1',
  title: 'A Long Show',
  media: {
    type: 'tv',
    tmdbId: 1399,
    copies: [
      { server: 'owed_one', episodes: [[1, 1], [1, 2], [2, 1]] },
      { server: 'owed_two', episodes: [[2, 1]] },
    ],
  },
};
const KINO = {
  ...FILM,
  id: 'kino:film-2',
  platform: 'kino',
  title: 'A Film Nobody Holds',
  url: 'https://www.themoviedb.org/movie/603',
  media: { type: 'tv', tmdbId: 603, copies: [], details: { title: 'A Film Nobody Holds', genres: ['Drama'], seasons: [{ season: 0, episodes: 3 }, { season: 1, episodes: 8 }] } },
};

const file = (kind, patch = {}) => ({
  item: {
    id: `file-${kind}`,
    kind,
    bucket: '',
    path: `files/${kind}`,
    src: `/assets/${kind}.bin`,
    sha256: 'x',
    bytes: 1,
    mime: 'x/x',
    width: 100,
    height: 100,
    length: kind === 'image' ? '' : '3:30',
    title: `Trains ${kind}`,
    credit: 'Luke',
    tags: [],
    source: 'upload',
    uploadedBy: 'someone',
    uploadedByLabel: 'Uploader',
    createdAt: '2026-10-02T00:00:00.000Z',
    ...patch,
  },
  uses: [],
});

const CANVAS = {
  id: 'canvas-1',
  roomId: 'room-1',
  hostId: 'host-1',
  hostLabel: 'Alice',
  title: 'A Saved Canvas',
  openedAt: ago(9000),
  closedAt: null,
  savedAt: ago(8000),
  savedBy: 'saver-1',
  savedByLabel: 'Saver',
  hidden: false,
};
const SNAPSHOT = {
  id: 'snap-1',
  canvasId: 'canvas-1',
  takenAt: ago(8000),
  takenBy: 'saver-1',
  takenByLabel: 'Saver',
  imageUrl: null,
  placements: [],
  credits: [{ id: 'artist-1', label: 'Artist' }],
  participants: [],
  inputCount: 3,
};
const PIECE = { canvas: CANVAS, latest: SNAPSHOT, snapshotCount: 2, participants: [{ id: 'host-1', label: 'Alice', crowned: true }, { id: 'guest-1', label: 'Guest', crowned: false }] };

/* --- the cases ------------------------------------------------------------------------------------- */

const cases = [];
const test = (label, fn) => cases.push({ label, fn });

function reset() {
  asked = [];
  auth = { status: 'signed-in', user: USER };
  address = '';
  watching = null;
  watchRead = undefined;
  liveRooms = null;
  musicRoom = null;
  watchWindowOpen = false;
  readRoomAnswer = null;
  cursor = 'contrast';
  catalogue = { entries: [], items: [] };
  commentCount = 0;
  playerNow = { queue: [], track: undefined, playing: false };
  canvasPieces = [];
}

// --- WebSignInGate
const INSIDE = el('p', { 'data-inside': 'yes' }, 'THE STREAM');
test('WebSignInGate: signed out, a prompt to sign in and nothing of the stream', () => {
  auth = { status: 'signed-out', user: null };
  const html = draw(el(WebSignInGate, null, INSIDE));
  assert.ok(visible(html).includes('SIGN IN TO USE MEDIA'));
  assert.match(openingTag(html, '[ SIGN IN ]'), /href="\/account"/);
  assert.ok(!html.includes('THE STREAM'), 'the stream must not be drawn for a visitor');
});
test('WebSignInGate: still checking, says so and shows neither', () => {
  auth = { status: 'loading', user: null };
  const html = draw(el(WebSignInGate, null, INSIDE));
  assert.equal(visible(html), 'CHECKING YOUR SIGN-IN...');
});
test('WebSignInGate: signed in, the stream itself and no prompt', () => {
  assert.equal(draw(el(WebSignInGate, null, INSIDE)), '<p data-inside="yes">THE STREAM</p>');
});

// --- CytubeLiveStreams
const LIVE_ROOMS = () => [
  { room: room({ id: 'paused', isPlaying: false, originalHostLabel: 'Paused Pat' }), current: null },
  { room: room({ id: 'older', startedAt: ago(900), originalHostLabel: 'Older Olly' }), current: entry({ link: { url: 'https://youtu.be/x', kind: 'youtube', title: 'Episode 2' }, series: { title: 'The Series' } }) },
  { room: room({ id: 'newer', startedAt: ago(100), originalHostLabel: 'Newer Nell', origin: 'music' }), current: entry({ mediaItemId: 'known' }) },
  { room: room({ id: 'unknown-file', startedAt: ago(1000), originalHostLabel: 'Unknown Una' }), current: entry({ mediaItemId: 'gone' }) },
  { room: room({ id: 'ended', endedAt: ago(5), originalHostLabel: 'Ended Ed' }), current: null },
  { room: room({ id: 'quiet-stream', updatedAt: ago(200), originalHostLabel: 'Quiet Quin' }), current: null },
  { room: room({ id: 'private-music', origin: 'music', isPublic: false, originalHostLabel: 'Private Pip' }), current: null },
];
test('CytubeLiveStreams: rows say who, what and which kind; a file nobody knows is A FILE, nothing on is empty', () => {
  const rows = liveRows(LIVE_ROOMS().slice(0, 4), new Map([['known', 'A Known Song']]));
  assert.deepEqual(
    rows.map((row) => [row.roomId, row.hostName, row.title, row.kind]),
    [
      ['paused', 'Paused Pat', '', 'stream'],
      ['older', 'Older Olly', 'The Series :: Episode 2', 'stream'],
      ['newer', 'Newer Nell', 'A Known Song', 'music'],
      ['unknown-file', 'Unknown Una', 'A FILE', 'stream'],
    ],
  );
});
test('CytubeLiveStreams: null until the first answer, then only live rooms, playing before paused and newest first', () => {
  let rows = 'not drawn';
  const Probe = () => {
    rows = useLiveStreams();
    return null;
  };
  liveRooms = null;
  draw(el(Probe));
  assert.equal(rows, null);
  liveRooms = LIVE_ROOMS();
  catalogue = { entries: [], items: [{ id: 'known', title: 'A Known Song' }] };
  draw(el(Probe));
  assert.deepEqual(rows.map((row) => row.roomId), ['newer', 'older', 'unknown-file', 'paused']);
  assert.equal(rows[0].title, 'A Known Song', 'the title comes from the catalogue the page reads');
});

// --- CytubePage
test('CytubePage: signed out or still checking, a prompt and no way to go live', () => {
  auth = { status: 'signed-out', user: null };
  let html = draw(el(CytubePage));
  assert.match(visible(html), /SIGN IN TO USE \w+/);
  assert.match(openingTag(html, '[ SIGN IN ]'), /href="\/account"/);
  assert.ok(!html.includes('GO LIVE ]') && !html.includes('role="tablist"'));
  auth = { status: 'loading', user: null };
  html = draw(el(CytubePage));
  assert.equal(visible(html), 'CHECKING YOUR SIGN-IN...');
});
test('CytubePage: opens on ABOUT, whatever the address says that is not a tab', () => {
  for (const at of ['', 'tab=nonsense']) {
    address = at;
    const html = draw(el(CytubePage));
    assert.match(openingTag(html, '[ ABOUT ]'), /aria-selected="true"/);
    assert.match(openingTag(html, '[ ROOM ]'), /aria-selected="false"/);
    assert.ok(html.includes('id="cytube-panel-about"'));
    for (const heading of ['ROOMS', 'CROWNS', 'THE CANVAS', 'YOUR LOOK']) assert.ok(html.includes(`>${heading}</h2>`), heading);
  }
});
test('CytubePage: a tab key writes the address, and ABOUT clears it', () => {
  draw(el(CytubePage));
  press('[ ROOM ]');
  press('[ ABOUT ]');
  assert.deepEqual(said('replace'), [
    ['replace', '/here?tab=live', { scroll: false }],
    ['replace', '/here', { scroll: false }],
  ]);
});
test('CytubePage: GO LIVE starts your own empty room; hosting already, the same key goes back to it', async () => {
  let html = draw(el(CytubePage));
  assert.match(openingTag(html, '[ GO LIVE ]'), /data-cytube-go-live="new"/);
  press('[ GO LIVE ]');
  await tick();
  assert.deepEqual(said('goLiveEmpty'), [['goLiveEmpty', USER.id, true]]);

  asked = [];
  watching = { userId: USER.id, roomId: 'mine', hosting: true };
  html = draw(el(CytubePage));
  assert.match(openingTag(html, '[ BACK TO YOUR ROOM ]'), /data-cytube-go-live="back"/);
  press('[ BACK TO YOUR ROOM ]');
  await tick();
  assert.deepEqual(asked, [['openWatch', { kind: 'room', roomId: 'mine' }]], 'never a second room');
});
test('CytubePage: LIVE lists the rooms with JOIN and QUEUE; an empty list and a slow one each say so', () => {
  address = 'tab=live';
  liveRooms = null;
  assert.ok(visible(draw(el(CytubePage))).includes('READING THE ROOMS...'));
  liveRooms = [];
  assert.ok(visible(draw(el(CytubePage))).includes('NOBODY IS LIVE.'));
  liveRooms = LIVE_ROOMS();
  catalogue = { entries: [], items: [{ id: 'known', title: 'A Known Song' }] };
  const html = draw(el(CytubePage));
  const words = visible(html);
  assert.ok(words.includes('NEWER NELL MUSIC :: A Known Song'));
  assert.ok(words.includes('OLDER OLLY STREAM :: The Series :: Episode 2'));
  assert.ok(words.includes('PAUSED PAT STREAM :: NOTHING ON YET'));
  assert.ok(!words.includes('ENDED ED') && !words.includes('PRIVATE PIP'));
  assert.ok(html.includes('id="cytube-panel-live"'));
  press("Join Newer Nell's room");
  assert.deepEqual(said('enterRoom'), [['enterRoom', 'newer', 'music']]);
  keyNamed("Older Olly's queue");
});
test('CytubePage: CANVASES asks each live room about its canvas, up to twelve, and shows the saved shelf', async () => {
  address = 'tab=canvases';
  liveRooms = Array.from({ length: 14 }, (_, index) => ({ room: room({ id: `room-${index}`, startedAt: ago(100 + index) }), current: null }));
  const html = draw(el(CytubePage));
  assert.ok(visible(html).includes('LIVE NOW'));
  assert.ok(html.includes('data-stream-art'), 'the archive shelf itself');
  await inBrowser(fakeBrowser(), async () => {
    const stop = runEffects();
    await tick();
    stop();
  });
  assert.equal(said('findOpenCanvas').length, 12);
  assert.equal(said('listPieces').length, 1);
});

// --- MusicRoomKeeper
async function keeperRuns({ stopFirst = false } = {}) {
  assert.equal(draw(el(MusicRoomKeeper)), '', 'it draws nothing');
  await inBrowser(fakeBrowser(), async () => {
    const stop = runEffects();
    // Before the read can answer: the page has gone while it was out.
    if (stopFirst) stop();
  });
  await tick();
}
test('MusicRoomKeeper: draws nothing, and signed out asks for nothing', async () => {
  auth = { status: 'signed-out', user: null };
  await keeperRuns();
  assert.deepEqual(asked, []);
});
test('MusicRoomKeeper: your public room opens again, folded as music', async () => {
  musicRoom = room({ id: 'mine', origin: 'music', updatedAt: ago(60) });
  await keeperRuns();
  assert.deepEqual(asked, [
    ['findMusicRoom', USER.id],
    ['enterRoom', 'mine', 'music'],
  ]);
});
test('MusicRoomKeeper: no room, or one switched off, stays shut', async () => {
  for (const found of [null, room({ id: 'mine', origin: 'music', isPublic: false })]) {
    asked = [];
    musicRoom = found;
    await keeperRuns();
    assert.deepEqual(asked, [['findMusicRoom', USER.id]]);
  }
});
test('MusicRoomKeeper: past half an hour quiet it is switched off instead of opened', async () => {
  musicRoom = room({ id: 'mine', origin: 'music', updatedAt: ago(31 * 60) });
  await keeperRuns();
  assert.deepEqual(asked, [
    ['findMusicRoom', USER.id],
    ['setRoomPublic', 'mine', false],
  ]);
  asked = [];
  musicRoom = room({ id: 'mine', origin: 'music', updatedAt: ago(29 * 60) });
  await keeperRuns();
  assert.deepEqual(said('enterRoom'), [['enterRoom', 'mine', 'music']], 'twenty-nine minutes is still on');
});
test('MusicRoomKeeper: never over a room this page opened on, and not after the page has gone', async () => {
  musicRoom = room({ id: 'mine', origin: 'music', updatedAt: ago(60) });
  watchWindowOpen = true;
  await keeperRuns();
  assert.deepEqual(said('enterRoom'), []);
  watchWindowOpen = false;
  await keeperRuns({ stopFirst: true });
  assert.deepEqual(said('enterRoom'), []);
});
test('MusicRoomKeeper: an unreadable room is swallowed, with no failure left unhandled', async () => {
  const unhandled = [];
  const note = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', note);
  musicRoom = 'unreadable';
  await keeperRuns();
  await tick();
  process.off('unhandledRejection', note);
  assert.deepEqual(unhandled, []);
  assert.deepEqual(said('enterRoom'), []);
});

// --- CatCursor
function drawnCat() {
  const html = draw(el(CatCursor));
  const find = (test) => {
    const found = drawn.find(({ props }) => test(props));
    assert.ok(found?.props.ref, 'the cursor reads this element through a ref');
    return found.props;
  };
  const parts = {
    rest: find((props) => props.src?.includes('cat-rest')),
    paw: find((props) => props.src?.includes('cat-paw')),
    place: find((props) => props.style?.width === 30),
    body: find((props) => props.className === 'relative h-full w-full'),
    hearts: find((props) => props.className === 'absolute inset-0' && props.src === undefined),
  };
  const nodes = {};
  for (const [name, props] of Object.entries(parts)) {
    nodes[name] = paintable(name);
    props.ref.current = nodes[name];
  }
  return { html, parts, nodes };
}
const mouse = (target, patch = {}) => ({ pointerType: 'mouse', clientX: 100, clientY: 50, button: 0, target, ...patch });

test('CatCursor: on any other cursor it draws nothing and touches nothing', async () => {
  for (const id of ['contrast', 'system', 'pink']) {
    const browser = fakeBrowser();
    cursor = id;
    assert.equal(draw(el(CatCursor)), '');
    await inBrowser(browser, async () => {
      runEffects();
      assert.deepEqual(browser.listeners, []);
      assert.deepEqual(browser.root.dataset, {});
    });
  }
});
test('CatCursor: on CAT it draws the two cats, hidden until a pointer moves, on a layer that takes no pointer', () => {
  cursor = 'cat';
  const { html, parts } = drawnCat();
  assert.match(html, /<div aria-hidden="true" class="[^"]*pointer-events-none[^"]*fixed/);
  assert.ok(existsSync(join(ROOT, parts.rest.src)), 'the resting cat is a real file');
  assert.ok(existsSync(join(ROOT, parts.paw.src)), 'the paw is a real file');
  assert.match(html, /<div class="invisible absolute left-0 top-0" style="width:30px;height:30px">/);
  assert.match(html, new RegExp(`src="${parts.paw.src}"[^>]*class="invisible`), 'the paw is down at first');
  assert.equal(parts.rest.alt, '');
});
test('CatCursor: a phone with no fine pointer keeps its own behaviour', async () => {
  cursor = 'cat';
  const browser = fakeBrowser({ fine: false });
  drawnCat();
  await inBrowser(browser, async () => {
    runEffects();
    assert.deepEqual(browser.listeners, []);
    assert.deepEqual(browser.root.dataset, {}, 'the pointer stays visible');
  });
});
test('CatCursor: running, the page hides the pointer by the mark globals.css reads; unmounted, the mark and every listener go', async () => {
  cursor = 'cat';
  const browser = fakeBrowser();
  drawnCat();
  await inBrowser(browser, async () => {
    const stop = runEffects();
    assert.equal(browser.root.dataset.catCursor, '');
    assert.ok(browser.listeners.length > 0);
    stop();
    assert.deepEqual(browser.root.dataset, {});
    assert.deepEqual(browser.listeners.map((entry) => entry.type), []);
  });
  assert.match(readFileSync(join(ROOT, 'app/globals.css'), 'utf8'), /:root\[data-cat-cursor\],\s*:root\[data-cat-cursor\] \*\s*\{\s*cursor: none !important;/);
});
test('CatCursor: follows the mouse by its ear, not a touch; the paw comes up over a live control and it hides over a field or an embed', async () => {
  cursor = 'cat';
  const browser = fakeBrowser();
  const { nodes } = drawnCat();
  await inBrowser(browser, async () => {
    const stop = runEffects();
    browser.fire('pointermove', mouse(new FakeElement('div'), { pointerType: 'touch' }));
    assert.equal(nodes.place.style.transform, undefined, 'a touch has no pointer');
    browser.fire('pointermove', mouse(new FakeElement('div')));
    assert.equal(nodes.place.style.transform, 'translate3d(95px, 49px, 0)');
    assert.equal(nodes.place.style.visibility, 'visible');
    browser.fire('pointermove', mouse(new FakeElement('button', { disabled: true })));
    assert.equal(nodes.paw.style.visibility, undefined, 'a disabled key is not a control');
    browser.fire('pointermove', mouse(new FakeElement('button')));
    assert.equal(nodes.paw.style.visibility, 'visible');
    assert.equal(nodes.rest.style.visibility, 'hidden');
    assert.deepEqual(nodes.body.animated, [280], 'the wobble');
    for (const tag of ['input', 'iframe']) {
      browser.fire('pointermove', mouse(new FakeElement('div')));
      assert.equal(nodes.place.style.visibility, 'visible');
      browser.fire('pointermove', mouse(new FakeElement(tag)));
      assert.equal(nodes.place.style.visibility, 'hidden', tag);
    }
    stop();
  });
});
test('CatCursor: a click sends up a heart, a right-click flashes; a press where it has stepped aside sends nothing', async () => {
  cursor = 'cat';
  const browser = fakeBrowser();
  const { nodes } = drawnCat();
  await inBrowser(browser, async () => {
    const stop = runEffects();
    browser.fire('pointerdown', mouse(new FakeElement('div')));
    assert.equal(nodes.hearts.children.length, 0, 'not shown yet');
    browser.fire('pointermove', mouse(new FakeElement('div')));
    browser.fire('pointerdown', mouse(new FakeElement('div')));
    assert.equal(nodes.hearts.children.length, 1);
    assert.deepEqual(nodes.body.animated, [360]);
    browser.fire('pointerdown', mouse(new FakeElement('div'), { button: 2 }));
    assert.equal(nodes.hearts.children.length, 1, 'no heart on a right-click');
    assert.deepEqual(nodes.body.animated, [360, 320]);
    stop();
  });
});
test('CatCursor: under reduced motion the wobble and the heart stop, and the right-click flash stays', async () => {
  cursor = 'cat';
  const browser = fakeBrowser({ still: true });
  const { nodes } = drawnCat();
  await inBrowser(browser, async () => {
    const stop = runEffects();
    browser.fire('pointermove', mouse(new FakeElement('button')));
    assert.equal(nodes.paw.style.visibility, 'visible', 'the paw is a picture swap, not motion');
    browser.fire('pointerdown', mouse(new FakeElement('button')));
    assert.deepEqual(nodes.body.animated, []);
    assert.equal(nodes.hearts.children.length, 0);
    browser.fire('pointerdown', mouse(new FakeElement('button'), { button: 2 }));
    assert.deepEqual(nodes.body.animated, [320]);
    stop();
  });
});

// --- StreamArtShelf
const ADMIN = { id: SITE_ACCOUNT_ID, displayName: 'House' };
test('StreamArtShelf: reads the pieces, hidden ones only for the house account', async () => {
  const shelf = async () => {
    asked = [];
    const html = draw(el(StreamArtShelf));
    assert.ok(visible(html).includes('READING...'));
    await inBrowser(fakeBrowser(), async () => runEffects());
    await tick();
    return said('listPieces');
  };
  assert.deepEqual(await shelf(), [['listPieces', { includeHidden: false }]]);
  auth = { status: 'signed-in', user: ADMIN };
  assert.deepEqual(await shelf(), [['listPieces', { includeHidden: true }]]);
});
test('StreamArtShelf: an empty shelf and a failed read each say so', () => {
  assert.ok(visible(draw(el(StreamArtShelf), { StreamArtShelf: slots([]) })).includes('NOTHING SAVED YET.'));
  const html = draw(el(StreamArtShelf), { StreamArtShelf: slots(undefined, 'STREAM ART COULD NOT BE READ.') });
  assert.match(openingTag(html, 'STREAM ART COULD NOT BE READ.'), /role="alert"/);
});
test('StreamArtShelf: a piece shows its title, who saved it, how many snapshots and who drew it, with no HIDE for a reader', () => {
  const html = draw(el(StreamArtShelf), { StreamArtShelf: slots([PIECE]) });
  const words = visible(html);
  assert.ok(html.includes('data-stream-art-piece="canvas-1"'));
  for (const word of ['A Saved Canvas', 'SAVED BY', 'Saver', '2 SNAPSHOTS', 'DRAWN BY', 'Artist', '[ OPEN ]']) assert.ok(words.includes(word), word);
  assert.ok(!words.includes('[ HIDE ]') && !words.includes('HIDDEN'));
  assert.ok(visible(draw(el(StreamArtShelf), { StreamArtShelf: slots([{ ...PIECE, snapshotCount: 1 }]) })).includes('1 SNAPSHOT '), 'one is singular');
});
test('StreamArtShelf: the house account can HIDE a piece, and SHOW one hidden', async () => {
  auth = { status: 'signed-in', user: ADMIN };
  draw(el(StreamArtShelf), { StreamArtShelf: slots([PIECE]) });
  press('[ HIDE ]');
  await tick();
  assert.deepEqual(said('setHidden'), [['setHidden', 'canvas-1', true, ADMIN.id]]);
  asked = [];
  const html = draw(el(StreamArtShelf), { StreamArtShelf: slots([{ ...PIECE, canvas: { ...CANVAS, hidden: true } }]) });
  assert.ok(visible(html).includes('HIDDEN'));
  press('[ SHOW ]');
  await tick();
  assert.deepEqual(said('setHidden'), [['setHidden', 'canvas-1', false, ADMIN.id]]);
});
test('StreamArtShelf: OPEN draws the final snapshot and its credit; the timeline waits for its inputs', () => {
  const html = draw(el(StreamArtShelf), { StreamArtShelf: slots([PIECE], undefined, PIECE) });
  assert.ok(html.includes('data-window="A Saved Canvas"'));
  const words = visible(html);
  assert.ok(words.includes('FINAL SNAPSHOT, TAKEN BY Saver'));
  assert.match(openingTag(html, '[ FINAL ]'), /aria-pressed="true"/);
  assert.match(openingTag(html, '[ TIMELINE ]'), /disabled=""/);
});
test('StreamArtShelf: WHO WAS THERE lists everybody and crowns those who held one; with no record, the host', () => {
  let html = draw(el(StreamArtShelf), { StreamArtShelf: slots([PIECE], undefined, undefined, PIECE) });
  assert.ok(html.includes('data-window="WHO WAS THERE :: A Saved Canvas"'));
  assert.match(html, /data-stream-art-person="host-1" data-crowned="yes"/);
  assert.match(html, /data-stream-art-person="guest-1" data-crowned="no"/);
  html = draw(el(StreamArtShelf), { StreamArtShelf: slots([PIECE], undefined, undefined, { ...PIECE, participants: [] }) });
  assert.match(html, /data-stream-art-person="host-1" data-crowned="yes"/);
  assert.ok(!html.includes('guest-1'));
});

// --- WebBridgeKeys
test('WebBridgeKeys: DISCUSS counts the item\'s own thread and opens a window filed under it', () => {
  let html = draw(el(WebDiscussKey, { item: VIDEO }));
  assert.ok(visible(html).includes('[ DISCUSS ]'));
  assert.deepEqual(said('count'), [['count', VIDEO.id]]);
  commentCount = 3;
  html = draw(el(WebDiscussKey, { item: VIDEO, onOpen: () => say('opened') }));
  assert.match(openingTag(html, '[ DISCUSS (3) ]'), /aria-label="Discuss &quot;A Train Film&quot; on the forum \(3 comments\)"/);
  assert.ok(!html.includes('data-comments'), 'no window until it is pressed');
  press('[ DISCUSS (3) ]');
  assert.deepEqual(said('opened'), [['opened']]);
  html = draw(el(WebDiscussKey, { item: VIDEO }), { WebDiscussKey: slots(true) });
  const anchor = webAnchor(VIDEO);
  assert.ok(html.includes(`data-comments="${anchor.id}"`));
  assert.ok(html.includes(`data-comments-label="${anchor.label}"`));
});
test('WebBridgeKeys: WATCH is offered for a video on a platform with a player, never for a picture, and shows when it is open', () => {
  assert.equal(canWatch(VIDEO), true);
  assert.equal(canWatch(PICTURE), false);
  assert.equal(canWatch(FILM), false, 'a media server plays on its own row only');
  const shut = draw(el(WebWatchKey, { item: VIDEO, open: false, onToggle: () => say('toggled') }));
  assert.match(openingTag(shut, '[ WATCH ]'), /aria-expanded="false"/);
  press('[ WATCH ]');
  assert.deepEqual(said('toggled'), [['toggled']]);
  assert.match(openingTag(draw(el(WebWatchKey, { item: VIDEO, open: true, onToggle: () => undefined })), '[ ■ WATCH ]'), /aria-expanded="true"/);
});
test('WebBridgeKeys: the panel sends a visitor to sign in, and anybody without a room of theirs to CYTUBE', () => {
  auth = { status: 'signed-out', user: null };
  assert.ok(visible(draw(el(WebWatchPanel, { item: VIDEO }))).includes('SIGN IN AND GO LIVE ON'));
  auth = { status: 'signed-in', user: USER };
  let html = draw(el(WebWatchPanel, { item: VIDEO }));
  assert.ok(visible(html).includes("YOU'RE NOT HOSTING A STREAM ROOM"));
  assert.ok(html.includes(`href="${CYTUBE_HREF}"`), 'a link to the page where a room is started');
  assert.ok(!html.includes('ADD TO QUEUE'));
  // In somebody else's room with no crown: the same, and no key to add.
  watching = { userId: USER.id, roomId: 'room-1', hosting: false };
  watchRead = { room: room(), queue: [], crowns: [] };
  html = draw(el(WebWatchPanel, { item: VIDEO }));
  assert.ok(visible(html).includes("YOU'RE NOT HOSTING A STREAM ROOM"));
  assert.ok(!html.includes('ADD TO QUEUE'));
});
test('WebBridgeKeys: a crown in the room adds to its queue, as the next place, then tells the room to refresh', async () => {
  watching = { userId: USER.id, roomId: 'room-1', hosting: false };
  watchRead = { room: room(), queue: [{ position: 4 }], crowns: [{ userId: USER.id }] };
  readRoomAnswer = watchRead;
  draw(el(WebWatchPanel, { item: VIDEO }));
  press('[ + ADD TO QUEUE ]');
  await tick();
  assert.deepEqual(said('addToQueue'), [['addToQueue', { roomId: 'room-1', link: watchLinkForItem(VIDEO), addedBy: USER.id, position: 5, inQueue: true }]]);
  assert.deepEqual(said('applyLocalChange'), [['applyLocalChange', 'room-1', { kind: 'refresh' }]]);
});
test('WebBridgeKeys: a host with the crown off adds to their list; a room gone quiet takes nothing', async () => {
  watching = { userId: USER.id, roomId: 'room-1', hosting: true };
  watchRead = { room: room({ hostId: USER.id }), queue: [], crowns: [] };
  readRoomAnswer = watchRead;
  draw(el(WebWatchPanel, { item: VIDEO }));
  press('[ + ADD TO QUEUE ]');
  await tick();
  assert.equal(said('addToQueue')[0][1].inQueue, false);
  asked = [];
  readRoomAnswer = { ...watchRead, room: room({ hostId: USER.id, updatedAt: ago(600) }) };
  draw(el(WebWatchPanel, { item: VIDEO }));
  press('[ + ADD TO QUEUE ]');
  await tick();
  assert.deepEqual(said('addToQueue'), []);
});

// --- WebMediaRow
const mediaServer = (id) => [SERVER_ONE, SERVER_TWO].find((server) => server.id === id);
const row = (item, seedsFor) => draw(el(WebMediaRow, { item, titleId: 'row-title' }), seedsFor);
const rowPhase = (phase) => ({ WebMediaRow: (initial) => (initial === 'closed' ? phase : undefined) });

test('WebMediaRow: a film says what it is and offers each server, and nothing from a server loads before PLAY', () => {
  const html = row(FILM);
  const words = visible(html);
  assert.match(html, /id="row-title"/);
  for (const word of ['A Long Film', '2014 · 169 MIN · SCIENCE FICTION', 'Prelinger', 'THIS SITE USES THE TMDB API', '[ OWED ONE ]', '[ OWED TWO ]', '[ ▶ PLAY ]']) assert.ok(words.includes(word), word);
  assert.match(openingTag(html, '[ OWED ONE ]'), /aria-pressed="true"/);
  assert.match(openingTag(html, '[ OWED TWO ]'), /aria-pressed="false"/);
  assert.ok(!html.includes('<iframe'));
  assert.ok(!html.includes('owed-one.test'), 'no address of the server on the page yet');
});
test('WebMediaRow: third-party words are text, never markup', () => {
  const html = row({ ...FILM, title: '<img src=x onerror=alert(1)>' });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(visible(html).includes('<img src=x onerror=alert(1)>'));
  assert.ok(html.includes('&lt;b&gt;not markup&lt;/b&gt;'));
});
test('WebMediaRow: PLAY asks our own route whether that server answers, before anything loads', async () => {
  const seen = [];
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    seen.push(url);
    return { ok: true, json: async () => ({ up: true }) };
  };
  try {
    row(FILM);
    press('[ ▶ PLAY ]');
    await tick();
    await tick();
  } finally {
    global.fetch = realFetch;
  }
  assert.deepEqual(seen, ['/api/web/media/ping?server=owed_one']);
});
test('WebMediaRow: playing, the server\'s own player in a sandboxed frame that sends no referrer, with CLOSE in place of PLAY', () => {
  const html = row(FILM, rowPhase('playing'));
  const src = mediaPlayUrl(mediaServer('owed_one'), FILM.media, {});
  assert.equal(src, 'https://owed-one.test/play/movie/157336');
  const frame = /<iframe[^>]*>/.exec(html)?.[0];
  assert.ok(frame, 'the player frame');
  assert.ok(frame.includes(`src="${src}"`));
  assert.ok(frame.includes('referrerPolicy="no-referrer"'));
  assert.ok(frame.includes(`sandbox="${mediaServers.playerSandbox(SERVER_ONE)}"`));
  assert.ok(mediaServers.playerSandbox(SERVER_ONE).length > 0);
  assert.ok(visible(html).includes('[ ■ CLOSE ]') && !visible(html).includes('[ ▶ PLAY ]'));
});
test('WebMediaRow: a server not answering says so in plain words and offers the next, or says there is none', () => {
  let html = row(FILM, rowPhase('down'));
  assert.ok(visible(html).includes('OWED ONE IS NOT ANSWERING.'));
  assert.ok(visible(html).includes('[ TRY OWED TWO ]'));
  assert.ok(!html.includes('<iframe'));
  html = row({ ...FILM, media: { ...FILM.media, copies: [{ server: 'owed_one' }] } }, rowPhase('unasked'));
  assert.ok(visible(html).includes('COULD NOT REACH OWED ONE. TRY AGAIN.'));
  assert.ok(visible(html).includes('NO OTHER SERVER HAS IT.'));
});
test('WebMediaRow: a show picks season and episode; a server without that episode cannot be pressed, and says why', () => {
  const html = row(SHOW);
  const words = visible(html);
  for (const word of ['SEASON 1', 'SEASON 2', 'EPISODE 1', 'EPISODE 2', 'PLAYING: SEASON 1 · EPISODE 1', '[ OWED ONE ]', '[ OWED TWO: NOT THIS EPISODE ]', '[ ▶ WHOLE SERIES ]']) assert.ok(words.includes(word), word);
  assert.match(openingTag(html, '[ OWED TWO: NOT THIS EPISODE ]'), /disabled=""/);
  assert.equal(row(SHOW, rowPhase('playing')).match(/<iframe[^>]*src="([^"]*)"/)[1], 'https://owed-one.test/play/tv/1399/1/1');
});
test('WebMediaRow: KinoRow, TMDB\'s details and its link, its real seasons only, and says no server has it', () => {
  const html = draw(el(KinoRow, { item: KINO, titleId: 'kino-title' }));
  const words = visible(html);
  for (const word of ['A Film Nobody Holds', 'SHOW', 'DRAMA', 'S1: 8 EP', 'NO SERVER HAS THIS.', '[ ON TMDB ↗ ]', 'NOT ENDORSED OR CERTIFIED BY TMDB']) assert.ok(words.includes(word), word);
  assert.ok(!words.includes('S0:'), 'the specials are not a season here');
  assert.match(openingTag(html, '[ ON TMDB ↗ ]'), /href="https:\/\/www\.themoviedb\.org\/movie\/603"/);
  assert.equal(isKinoRow(KINO), true);
  assert.equal(isMediaRow(KINO), false);
  assert.equal(isMediaRow(FILM), true);
  assert.equal(isKinoRow(VIDEO), false);
});

// --- WebSiteFiles
test('WebSiteFiles: no matches, nothing at all', () => {
  assert.equal(draw(el(WebSiteFiles, { matches: [] })), '');
});
test('WebSiteFiles: a track names itself and its server, plays in the bar, and links to the catalogue', () => {
  const audio = file('audio');
  const html = draw(el(WebSiteFiles, { matches: [audio] }));
  const words = visible(html);
  for (const word of ['FROM DEBASER.SITE :: 1 FILE', 'Trains audio', 'Luke', 'AUDIO', '2026-10-02', '3:30', 'DEBASER.SITE', '[ ▶ PLAY ]']) assert.ok(words.includes(word), word);
  assert.ok(!words.includes('1 FILES'));
  assert.ok(html.includes(`href="${siteFileHref(audio)}"`));
  press('Play "Trains audio" in the music player');
  assert.deepEqual(said('play'), [['play', audio.item.src, '/media']]);
});
test('WebSiteFiles: no credit falls back to who filed it', () => {
  assert.ok(visible(draw(el(WebSiteFiles, { matches: [file('audio', { credit: '' })] }))).includes('Uploader'));
});
test('WebSiteFiles: a video loads no player until asked, and only a signed-in reader can stream it', () => {
  const video = file('video');
  let html = draw(el(WebSiteFiles, { matches: [video] }));
  assert.ok(!html.includes('<video'));
  assert.ok(html.includes(`href="${CYTUBE_HREF}"`), 'signed in, not hosting: to the page where a room is started');
  html = draw(el(WebSiteFiles, { matches: [video] }), { SiteFileRow: slots(true) });
  assert.match(html, new RegExp(`<video[^>]*src="${video.item.src}"`));
  assert.ok(visible(html).includes('[ ■ CLOSE ]'));
  auth = { status: 'signed-out', user: null };
  assert.ok(!draw(el(WebSiteFiles, { matches: [video] })).includes(`href="${CYTUBE_HREF}"`));
});
test('WebSiteFiles: a picture opens larger when asked, and shows no PLAY', () => {
  const image = file('image');
  let html = draw(el(WebSiteFiles, { matches: [image] }));
  assert.ok(visible(html).includes('[ VIEW ]'));
  assert.ok(!visible(html).includes('PLAY'));
  assert.equal((html.match(/<img/g) ?? []).length, 1, 'the thumbnail only');
  html = draw(el(WebSiteFiles, { matches: [image] }), { SiteFileRow: slots(true) });
  assert.ok(visible(html).includes('[ ■ CLOSE ]'));
  assert.equal((html.match(/<img/g) ?? []).length, 2, 'and the larger one');
});
test('WebSiteFiles: a long list stops at the limit behind ALL n FILES, which shows the rest', () => {
  const many = Array.from({ length: SITE_FILES_SHOWN + 3 }, (_, index) => ({ ...file('audio'), item: { ...file('audio').item, id: `f${index}`, title: `Track ${index}` } }));
  let html = draw(el(WebSiteFiles, { matches: many }));
  const rows = (markup) => (markup.match(/data-site-file="/g) ?? []).length;
  assert.equal(rows(html), SITE_FILES_SHOWN);
  assert.ok(visible(html).includes(`[ ALL ${many.length} FILES ]`));
  html = draw(el(WebSiteFiles, { matches: many }), { WebSiteFiles: slots(true) });
  assert.equal(rows(html), many.length);
  assert.ok(!visible(html).includes('[ ALL'));
});

// --- WebStream
/** The list as it stands once these rows have arrived and nobody is being waited on. */
const arrived = (items, order = { kind: 'date', dir: 'desc' }) => ({
  WebStream: (initial) => {
    if (initial && typeof initial === 'object' && 'shown' in initial && 'held' in initial) return arrive(emptyLive(order), items);
    if (Array.isArray(initial) && initial.length > 0) return [];
    return undefined;
  },
});

test('WebStream: the plain stream draws the search box and every filter, says it is reading, and asks only the saved stream', async () => {
  const html = draw(el(WebStream));
  const words = visible(html);
  assert.ok(html.includes('role="search"') && html.includes('id="web-search"'));
  for (const group of ['SOURCE:', 'TYPE:', 'VIBE:', 'SORT:', 'READING MEDIA...', '[ YOUTUBE ]', '[ STREAM ART ]']) assert.ok(words.includes(group), group);
  assert.match(openingTag(html, '[ OFF ]'), /aria-pressed="false"/);
  assert.match(openingTag(html, '[ ALL ]'), /aria-pressed="true"/, 'SOURCE starts on ALL');
  assert.ok(!words.includes('[ CLEAR ]'), 'nothing to clear yet');
  await inBrowser(fakeBrowser(), async () => runEffects());
  await tick();
  assert.deepEqual(said('listItems').length, 1);
  assert.deepEqual(said('searchEverywhere'), []);
  assert.deepEqual(said('searchItems'), []);
});
test('WebStream: a search in the address fills the box and asks the stream and every live source, never KINO unasked', async () => {
  address = 'q=trains';
  const browser = fakeBrowser();
  const html = draw(el(WebStream));
  assert.match(html, /<input[^>]*id="web-search"[^>]*value="trains"/);
  assert.ok(visible(html).includes('ASKING: THE STREAM'));
  assert.ok(visible(html).includes('[ CLEAR ]'));
  await inBrowser(browser, async () => {
    const stop = runEffects();
    await tick();
    assert.ok(browser.listeners.length > 0, 'it listens for the reader, to stop rows moving under them');
    stop();
    assert.deepEqual(browser.listeners, []);
  });
  assert.deepEqual(said('searchItems'), [['searchItems', 'trains']]);
  const live = said('searchEverywhere').map((call) => call[1]);
  assert.deepEqual([...live].sort(), [...sourcesToAsk({ source: 'all', type: 'all' }).live].sort());
  assert.ok(live.includes('youtube') && live.includes('internet_archive'));
  assert.ok(!live.includes('kino'), 'an ALL search never fills up with TMDB');
});
test('WebStream: SOURCE in the address presses that key and asks that source alone', async () => {
  address = 'q=trains&in=kino';
  const html = draw(el(WebStream));
  assert.match(openingTag(html, '[ KINO ]'), /aria-pressed="true"/);
  assert.match(openingTag(html, '[ ALL ]'), /aria-pressed="false"/);
  await inBrowser(fakeBrowser(), async () => {
    runEffects();
    await tick();
  });
  assert.deepEqual(said('searchEverywhere'), [['searchEverywhere', 'kino', 'trains']]);
});
test('WebStream: a filter key writes itself into the box and the address, and searches', async () => {
  address = 'q=trains';
  draw(el(WebStream));
  const browser = fakeBrowser();
  await inBrowser(browser, async () => {
    press('Source: YOUTUBE');
    await tick();
  });
  assert.ok(said('searchEverywhere').some((call) => call[1] === 'youtube' && call[2] === 'trains'));
  assert.ok(!said('searchEverywhere').some((call) => call[1] === 'internet_archive'));
  assert.equal(browser.addresses.length, 1);
  assert.match(browser.addresses[0], /in=youtube/);
  assert.match(browser.addresses[0], /q=trains/);
});
test('WebStream: ?art=1 is the saved shelf in place of the stream', () => {
  address = 'art=1';
  const html = draw(el(WebStream));
  assert.ok(html.includes('data-stream-art'));
  assert.match(openingTag(html, '[ STREAM ART ]'), /aria-pressed="true"/);
  assert.ok(!visible(html).includes('READING MEDIA'));
});
test('WebStream: a row names its source, its words as text, and links only where its address passes; no player until asked', () => {
  const also = { ...VIDEO, id: 'vimeo:123', platform: 'vimeo', externalId: '123', url: 'https://vimeo.com/123', title: 'A Train Film' };
  const html = draw(el(WebStream), arrived([{ ...VIDEO, alsoOn: [also] }]));
  const words = visible(html);
  for (const word of ['A Train Film', 'Prelinger', 'VIDEO', '2026-10-01', 'YOUTUBE', '[ OPEN ↗ ]', '[ ▶ PLAY ]', '[ DISCUSS ]', '[ WATCH ]', 'ALSO ON', '[ VIMEO ↗ ]']) assert.ok(words.includes(word), word);
  assert.match(openingTag(html, '[ OPEN ↗ ]'), new RegExp(`href="https://youtu\\.be/${YT_ID}"`));
  assert.ok(html.includes(`src="https://i.ytimg.com/vi/${YT_ID}/hqdefault.jpg"`) && html.includes('referrerPolicy="no-referrer"'));
  assert.ok(html.includes('&lt;b&gt;not markup&lt;/b&gt;') && !html.includes('<b>not markup'));
  assert.ok(!html.includes('<iframe'), 'nothing from the platform loads until the reader asks');
  assert.ok(!words.includes('NOTHING YET'));
});
test('WebStream: a hostile address is dropped: no link, no picture and no player', () => {
  const html = draw(el(WebStream), arrived([{ ...VIDEO, url: 'https://evil.invalid/x', thumbnailUrl: 'javascript:alert(1)', embedUrl: 'https://evil.invalid/embed/abcdefghijk' }]));
  assert.ok(visible(html).includes('A Train Film'));
  assert.ok(!html.includes('evil.invalid') && !html.includes('javascript:'));
  assert.ok(!visible(html).includes('[ OPEN ↗ ]') && !visible(html).includes('[ ▶ PLAY ]'));
});
test('WebStream: PLAY opens the platform\'s own sandboxed player; only YouTube is told our origin', () => {
  let html = draw(el(WebStream), { ...arrived([VIDEO]), WebRow: slots(true) });
  let frame = /<iframe[^>]*>/.exec(html)?.[0];
  assert.ok(frame, 'the player frame');
  assert.ok(frame.includes(`src="https://www.youtube-nocookie.com/embed/${YT_ID}?autoplay=1"`));
  assert.ok(frame.includes('sandbox="allow-scripts allow-same-origin"'));
  assert.ok(frame.includes('referrerPolicy="strict-origin"'));
  assert.ok(visible(html).includes('[ ■ CLOSE ]'));
  const archive = { ...VIDEO, id: 'internet_archive:train', platform: 'internet_archive', externalId: 'train', url: 'https://archive.org/details/train', thumbnailUrl: undefined, embedUrl: 'https://archive.org/embed/train' };
  html = draw(el(WebStream), { ...arrived([archive]), WebRow: slots(true) });
  frame = /<iframe[^>]*>/.exec(html)?.[0];
  assert.ok(frame.includes('referrerPolicy="no-referrer"'));
});
test('WebStream: each row is drawn by its kind: a server\'s title with its keys, a KINO title with no player', () => {
  const html = draw(el(WebStream), arrived([FILM, KINO]));
  const words = visible(html);
  assert.ok(words.includes('[ OWED ONE ]'));
  assert.ok(words.includes('NO SERVER HAS THIS.'));
  assert.ok(html.includes('id="web-row-owed_one-film-1"') && html.includes('id="web-row-kino-film-2"'));
});
test('WebStream: when nothing arrived it says so, for the stream and for a search', () => {
  // Not one wording for the stream: what an empty stream does next is its own feature, and it may still be reading.
  assert.match(draw(el(WebStream), arrived([])), /<p role="status"[^>]*>(NOTHING|READING)[^<]*<\/p>/);
  address = 'q=trains';
  assert.ok(visible(draw(el(WebStream), arrived([]))).includes('NOTHING MATCHES "TRAINS".'));
});
test('WebStream: a search lists the site\'s own files first, and the plain stream does not', () => {
  const audio = file('audio');
  catalogue = { entries: [audio], items: [audio.item] };
  address = 'q=trains';
  const html = draw(el(WebStream), arrived([VIDEO]));
  assert.ok(visible(html).includes('FROM DEBASER.SITE :: 1 FILE'));
  assert.ok(html.indexOf('data-site-files') < html.indexOf(`web-row-youtube-${YT_ID}`), 'before the other rows');
  address = '';
  assert.ok(!draw(el(WebStream), arrived([VIDEO])).includes('data-site-files'));
});

/* --- the run --------------------------------------------------------------------------------------- */

(async () => {
  const lines = [];
  const failures = [];
  for (const { label, fn } of cases) {
    reset();
    try {
      await fn();
      lines.push(`  ok  ${label}`);
    } catch (failure) {
      failures.push(label);
      lines.push(`  FAIL ${label}`);
      lines.push(`       ${String(failure.message).split('\n')[0]}`);
      console.error(`${label}\n${failure.stack}`);
    }
  }
  console.log(failures.length === 0 ? `owed renders passed: ${cases.length} cases across 10 components` : `${failures.length} of ${cases.length} owed render cases failed`);
  console.log(lines.join('\n'));
  // The real modules these load may leave a timer running; nothing here waits on one.
  process.exit(failures.length === 0 ? 0 : 1);
})();
