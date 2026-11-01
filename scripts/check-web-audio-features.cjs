/*
 * WEB audio in the music bar, step B: the bar's other features reach web tracks (run by `npm run checks:web`,
 * part of `npm run verify`):
 *   npx tsc app/lib/web/web-track-lookup.ts app/lib/audio/up-next.ts app/lib/audio/forum-tracks.ts app/lib/audio/loops.ts --outDir Temp/out-web-audio-b --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node --resolveJsonModule --jsx react-jsx
 *
 * - a web track's id and src name the same item and file, and nothing else parses as one
 * - likes and lists may keep an archive song or a web track, never a post's MP3 or a profile song
 * - a web song attached to a post stays a web track (its id, the WEB shelf)
 * - RADI-OH names a web track by the title it was recorded under, not "NOT ON THE SHELF"
 * - the lookup puts a web track back together from its src or id through our own list route only, asks once
 *   per item, says "still asking" until then, and after a failure tries again only after a pause
 * - the follower, the queue card, MY MUSIC, RADI-OH and the song panel all use it
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'Temp', 'out-web-audio-b', 'lib');
const web = require(join(OUT, 'web', 'web-audio.js'));
const { keepableSong } = require(join(OUT, 'audio', 'up-next.js'));
const { postedTrackAsAudio } = require(join(OUT, 'audio', 'forum-tracks.js'));
const { loopLabel } = require(join(OUT, 'audio', 'loops.js'));

let passed = 0;
const ok = (condition, message) => {
  if (!condition) {
    console.log(`FAIL ${message}`);
    process.exit(1);
  }
  passed += 1;
};

/* ------------------------------------------------------------------ ids */
const src = '/api/web/audio/internet_archive/art_of_war_librivox/2';
ok(web.webTrackIdFromSrc(src) === 'web:internet_archive:art_of_war_librivox:2', 'a web src gives its id');
ok(JSON.stringify(web.parseWebTrackId('web:podcast:hpr-abc:0')) === JSON.stringify({ platform: 'podcast', externalId: 'hpr-abc', index: 0 }), 'a web id parses back to its item');
for (const bad of ['web:youtube:x:0', 'web:podcast:../x:0', 'web:podcast:x:01', 'web:podcast:x:300', 'songs/theme.mp3', '/api/web/audio/podcast/x/0']) {
  ok(web.parseWebTrackId(bad) === null, `not a web id: ${bad}`);
}
ok(web.webTrackIdFromSrc('/assets/audio/theme.mp3') === null, 'an archive address has no web id');

/* ------------------------------------------------------------------ what likes and lists may keep */
const archiveSong = { id: 'theme', src: '/assets/audio/theme.mp3' };
const webSong = { id: web.webTrackIdFromSrc(src), src };
const postMp3 = { id: 'https://x.example/a.mp3', src: 'https://x.example/a.mp3' };
const queue = [archiveSong, webSong, postMp3];
ok(keepableSong(queue, 1, archiveSong) === archiveSong, 'an archive song may be liked');
ok(keepableSong(queue, 1, webSong) === webSong, 'a web track may be liked, though it sits after the archive');
ok(keepableSong(queue, 1, postMp3) === undefined, 'a post MP3 may still not be liked');
ok(keepableSong(queue, 1, { id: 'forged', src }) === undefined, 'a track whose id does not match its web src is not kept');

/* ------------------------------------------------------------------ posts and RADI-OH */
const posted = postedTrackAsAudio({ src, title: 'Chapter 3', credit: '', tags: [] }, 'Luke');
ok(posted.id === webSong.id && posted.shelf === 'web' && posted.credit === 'Luke', 'a web song attached to a post stays a web track');
ok(postedTrackAsAudio({ src: postMp3.src, title: 'A', credit: '', tags: [] }, 'Luke').shelf === 'bucket', 'a post MP3 is unchanged');
ok(loopLabel({ trackId: src, label: 'Chapter 3' }, []) === 'Chapter 3', 'RADI-OH names a web track by its recorded title');
ok(/NOT ON THE SHELF/.test(loopLabel({ trackId: '/assets/audio/gone.mp3', label: 'Gone' }, [])), 'a lost archive file still says NOT ON THE SHELF');

/* ------------------------------------------------------------------ the lookup */
(async () => {
  const asked = [];
  let answer = { ok: true, body: { title: 'The Art of War', creator: 'Sun Tzu', files: [{ title: 'One', seconds: 60 }, { title: 'Two', seconds: 61 }, { title: 'Three', seconds: 62 }] } };
  global.fetch = async (url) => {
    asked.push(String(url));
    if (!answer.ok) throw new Error('offline');
    return { ok: true, json: async () => answer.body };
  };
  const lookup = require(join(OUT, 'web', 'web-track-lookup.js'));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  ok(lookup.webTrackNow('/assets/audio/theme.mp3') === null, 'an archive address is not looked up');
  ok(lookup.webTrackNow(src) === undefined, 'a web src reads "still asking" at first');
  ok(lookup.webTrackNow('web:internet_archive:art_of_war_librivox:0') === undefined, 'a second ask for the same item waits on the first');
  ok(lookup.webLookupsPending(['web:internet_archive:art_of_war_librivox:0', 'theme']) === 1, 'a web like still being asked for is pending, not missing');
  await settle();
  await settle();
  ok(lookup.webLookupsPending(['web:internet_archive:art_of_war_librivox:0', 'theme']) === 0, 'and stops being pending once answered');
  ok(asked.length === 1 && asked[0] === '/api/web/audio/internet_archive/art_of_war_librivox', 'one ask per item, to our own list route only');
  const third = lookup.webTrackNow(src);
  ok(third && third.title === 'Three' && third.credit === 'Sun Tzu' && third.shelf === 'web' && third.src === src, 'the track comes back whole, from its src');
  ok(lookup.webTrackNow('web:internet_archive:art_of_war_librivox:0').title === 'One', 'and from its id');
  ok(lookup.webTrackNow('web:internet_archive:art_of_war_librivox:9') === null, 'a file the item does not have is null');

  answer = { ok: false };
  ok(lookup.webTrackNow('/api/web/audio/podcast/hpr-x/0') === undefined, 'another item is asked about');
  await settle();
  await settle();
  const before = asked.length;
  ok(lookup.webTrackNow('/api/web/audio/podcast/hpr-x/0') === null, 'a failed ask reads as no track');
  ok(asked.length === before, 'and is not asked again straight away');

  /* -------------------------------------------------------------- who uses it */
  const read = (path) => readFileSync(join(ROOT, path), 'utf8');
  ok(/webTrackNow\(row\.trackId\)/.test(read('app/components/QueueFollower.tsx')), 'the follower looks up a web track the host plays');
  ok(/useWebTrack\(queue\.trackId\)/.test(read('app/components/QueueProfilePopout.tsx')), 'the queue card names a web track');
  ok(/useWebTracks\(webIds\)/.test(read('app/components/PersonalLibrary.tsx')), 'MY MUSIC draws liked and listed web tracks');
  ok(/useWebTrack\(loop\.trackId\)/.test(read('app/components/LoopPopout.tsx')), 'RADI-OH can go back to a web track');
  ok(/keepableSong\(player\.queue, player\.shelfSize, track\)/.test(read('app/components/SongMenu.tsx')), 'the song panel offers likes and lists on a web track');
  ok(/keepableSong\(player\.queue, player\.shelfSize, track\)/.test(read('app/components/MusicPlayer.tsx')), 'the bar heart works on a web track');
  ok(/loadWebItem\(item\.platform, item\.externalId\)/.test(read('app/components/WebStream.tsx')), 'PLAY on /web shares the same lookup');

  console.log(`ok: ${passed} assertions (WEB audio step B: follow, likes, lists, RADI-OH, posts)`);
})().catch((error) => {
  console.log(`FAIL ${error.message}`);
  process.exit(1);
});
