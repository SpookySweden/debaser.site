/*
 * The beat box page's own parts, drawn: it loads in the browser only, says what it's doing while it loads, asks signed-out
 * people to sign in rather than offering what they can't do, and gives the page the song in the address. The beat box itself
 * needs a browser, so a stand-in is drawn in its place here; its tests live with the package.
 *   npx tsc app/components/BeatBoxLoader.tsx app/components/BeatBoxRoom.tsx app/components/BeatBoxSongs.tsx app/components/ShareSongToForum.tsx --rootDir app --outDir Temp/beatbox-render-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strictNullChecks
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const el = React.createElement;
const OUT = path.join(__dirname, 'beatbox-render-out');

function stub(file, exports) {
  const resolved = require.resolve(file);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } };
}

let auth = { status: 'signed-out', user: null };
stub(path.join(OUT, 'components/AuthProvider.js'), { useAuth: () => auth });
stub(path.join(OUT, 'components/ForumProvider.js'), { useForum: () => ({ createThread: async () => ({}) }) });

let dynamicOptions = null;
stub('next/dynamic', {
  default: (load, options) => {
    dynamicOptions = options;
    return () => options.loading();
  },
});

const handed = {};
stub(path.join(OUT, 'features/beatbox/index.js'), {
  BeatBox: (props) => {
    Object.assign(handed, props);
    return el('div', null, 'THE BEAT BOX', props.extras(() => ({ link: 'https://debaser.site/beatbox#9n31', json: '{}' })));
  },
});

global.window = { location: { hash: '#9n31abc', origin: 'https://debaser.site' } };

const BeatBoxLoader = require('./beatbox-render-out/components/BeatBoxLoader.js').default;
const BeatBoxRoom = require('./beatbox-render-out/components/BeatBoxRoom.js').default;
const BeatBoxSongs = require('./beatbox-render-out/components/BeatBoxSongs.js').default;
const ShareSongToForum = require('./beatbox-render-out/components/ShareSongToForum.js').default;

const getSong = () => ({ link: 'https://debaser.site/beatbox#9n31', json: '{}' });

// It loads in the browser only, and says so while it does.
const loader = renderToStaticMarkup(el(BeatBoxLoader));
assert.equal(dynamicOptions.ssr, false, 'audio and MIDI do not exist on the server');
assert.match(loader, /LOADING THE BEAT BOX/);
assert.match(loader, /role="status"/);

// Signed out: an invitation to sign in, and nothing that would only fail.
let songs = renderToStaticMarkup(el(BeatBoxSongs, { getSong, onOpen() {} }));
assert.match(songs, /href="\/account"/);
assert.match(songs, /Sign in to save songs/);
assert.doesNotMatch(songs, /<input/);
let share = renderToStaticMarkup(el(ShareSongToForum, { getSong }));
assert.match(share, /href="\/account"/);
assert.doesNotMatch(share, /Share to forum/);

// Signed in: a title and a save, labelled, with a place for messages already there for screen readers.
auth = { status: 'signed-in', user: { id: 'someone' } };
songs = renderToStaticMarkup(el(BeatBoxSongs, { getSong, onOpen() {} }));
assert.match(songs, /Save as new song/);
assert.match(songs, /<label[^>]*>Title<input/);
assert.match(songs, /role="status"/);
assert.doesNotMatch(songs, /href="\/account"/);

// Sharing takes two presses: the first only opens it.
share = renderToStaticMarkup(el(ShareSongToForum, { getSong }));
assert.match(share, /Share to forum/);
assert.doesNotMatch(share, /<input/);

// The page hands over the song in the address, this site's own links, and the art slots, and hides the second title.
const room = renderToStaticMarkup(el(BeatBoxRoom));
assert.match(room, /THE BEAT BOX/);
assert.equal(handed.initialSong, '#9n31abc');
assert.equal(handed.shareLinkStart, 'https://debaser.site/beatbox');
assert.equal(handed.hideTitle, true);
assert.equal(handed.art.channelIcons.length, 4);
assert.ok(Object.values(handed.art).flat().every((file) => file.startsWith('/assets/beatbox/')), 'slots, pointing at files Luke draws');
assert.match(room, /href="\/beatbox\/credits"/);

console.log('beat box page: loading, signed out, signed in, two presses to share, and what the page hands over: OK');
