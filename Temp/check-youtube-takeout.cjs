/*
 * Importing a person's own YouTube history from Google Takeout (lib/recommender/takeout.ts; Luke, 2026-11-14), offline:
 *   npx tsc app/lib/recommender/takeout.ts app/lib/recommender/youtube-picks.ts app/lib/recommender/engine.ts app/lib/recommender/types.ts app/lib/web/recommend.ts --rootDir app/lib --outDir Temp/youtube-takeout-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *
 * - both files Takeout makes are read (watch-history.json and .html), adverts and removed videos passed over
 * - only a summary comes out: channel names with a strength from 1 to 5 and a month, and topic words; never a video,
 *   a title, an address or a time of day
 * - often and lately count for more; what was watched over two years ago is left out
 * - a file that is not a watch history says so in plain words
 * - the file is read in the browser and nothing of it is sent anywhere; ERASE and REMOVE IMPORT delete the summary
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { watchedFrom, summarise, readTakeout, asSummary, MAX_CHANNELS, MAX_WORDS } = require('./youtube-takeout-out/recommender/takeout.js');
const { channelStandings } = require('./youtube-takeout-out/recommender/youtube-picks.js');

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-14T12:00:00Z');
const at = (days) => new Date(NOW - days * DAY).toISOString();
const watched = (title, channel, days, over = {}) => ({
  header: 'YouTube',
  title: `Watched ${title}`,
  titleUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  subtitles: [{ name: channel, url: 'https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx' }],
  time: at(days),
  products: ['YouTube'],
  activityControls: ['YouTube watch history'],
  ...over,
});

// 1. watch-history.json, as Takeout writes it.
const json = JSON.stringify([
  ...[1, 3, 5, 8, 12, 20].map((days, n) => watched(`Restoring a rusty lathe part ${n}`, 'Workshop Wanda', days)),
  ...[2, 9].map((days) => watched('Restoring an old hand plane', 'Bench Notes', days)),
  watched('Lathe basics for beginners', 'Bench Notes', 15),
  watched('One synth, one take', 'Tape Loop', 400),
  watched('A song', 'Tape Loop', 2, { header: 'YouTube Music' }),
  watched('Ancient upload', 'Long Gone', 900),
  watched('An advert', 'Some Brand', 1, { details: [{ name: 'From Google Ads' }] }),
  { header: 'YouTube', title: 'Watched a video that has been removed', time: at(4), products: ['YouTube'] },
  watched('No time', 'Bad Entry', 1, { time: 'yesterday-ish' }),
  { header: 'Search', title: 'Searched for lathes', time: at(1) },
  'junk',
]);
const list = watchedFrom(json);
assert.equal(list.length, 12, 'YouTube and YouTube Music; no advert, removed video, undated entry, other product or junk');
assert.ok(!list.some((video) => ['Some Brand', 'Bad Entry'].includes(video.channel)));

const summary = summarise(list, NOW);
assert.deepEqual(summary.channels.map((channel) => channel.name), ['Workshop Wanda', 'Bench Notes', 'Tape Loop'], 'most and latest watched first; a channel last watched over two years ago is left out');
assert.equal(summary.channels[0].strength, 5, 'the most-watched channel is the strongest');
assert.ok(summary.channels[1].strength < 5 && summary.channels[1].strength >= 2);
assert.ok(summary.channels.every((channel) => Number.isInteger(channel.strength) && channel.strength >= 1 && channel.strength <= 5), 'a strength from 1 to 5');
assert.equal(summary.channels[0].last, at(1).slice(0, 7), 'the month it was last watched, no finer');
assert.ok(summary.words.includes('lathe') && summary.words.includes('restoring'), 'words their watched titles share, from more than one channel');
assert.ok(!summary.words.includes('watched') && !summary.words.includes('part') && !summary.words.includes('synth'), "not Takeout's own word, a dull word, or a word seen once");
// Often and lately: one watch today outweighs one a year ago.
const lately = summarise([{ title: 'a', channel: 'Now', at: NOW - DAY }, { title: 'b', channel: 'Then', at: NOW - 365 * DAY }], NOW);
assert.deepEqual([lately.channels[0].name, lately.channels[1].strength < lately.channels[0].strength], ['Now', true]);

// 2. Only the summary: no video, title, address or time of day.
const kept = JSON.stringify(summary);
assert.deepEqual(Object.keys(summary).sort(), ['channels', 'importedAt', 'words']);
assert.ok(summary.channels.every((channel) => Object.keys(channel).join() === 'name,strength,last'));
assert.doesNotMatch(kept, /watch\?v=|youtube\.com|dQw4w9WgXcQ|UCxxxx|rusty|hand plane|One synth/, 'no address, id or title');
assert.equal((kept.match(/\d{4}-\d{2}-\d{2}T/g) ?? []).length, 1, 'the only time is when it was imported');

// 3. watch-history.html, the same history as Takeout's page (with its odd spaces and escaped characters).
const cell = (title, channel, date) =>
  `<div class="outer-cell mdl-cell mdl-cell--12-col mdl-shadow--2dp"><div class="mdl-grid"><div class="header-cell mdl-cell mdl-cell--12-col"><p class="mdl-typography--title">YouTube<br></p></div><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Watched <a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">${title}</a><br><a href="https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx">${channel}</a><br>${date}<br></div><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1 mdl-typography--text-right"></div><div class="content-cell mdl-cell mdl-cell--12-col mdl-typography--caption"><b>Products:</b><br>&emsp;YouTube<br></div></div></div>`;
const html = `<!DOCTYPE html><html><head><title>My Activity History</title></head><body><div class="mdl-grid">${[
  cell('Tom &amp; Jerry&#39;s lathe', 'Workshop Wanda &amp; Co', 'Nov 13, 2026, 9:15:02 PM GMT'),
  cell('Restoring a rusty lathe', 'Workshop Wanda &amp; Co', 'Nov 10, 2026, 8:00:00 AM GMT'),
  cell('Old one', 'Bench Notes', 'Oct 2, 2026, 11:59:59 PM GMT'),
  '<div class="outer-cell"><div class="mdl-grid"><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Watched a video that has been removed<br>Nov 1, 2026, 1:00:00 PM GMT<br></div></div></div>',
  cell('Unreadable date', 'Elsewhere', '13 нояб. 2026 г., 21:15:02 GMT'),
].join('')}</div></body></html>`;
const fromPage = watchedFrom(html);
assert.deepEqual(fromPage.map((video) => video.channel), ['Workshop Wanda & Co', 'Workshop Wanda & Co', 'Bench Notes'], 'the channel of each; a removed video and a date it cannot read are passed over');
assert.equal(fromPage[0].title, "Tom & Jerry's lathe", 'escaped characters are read as text');
assert.equal(new Date(fromPage[0].at).toISOString(), '2026-11-13T21:15:02.000Z', "Google's date, odd spaces and all");
assert.deepEqual(readTakeout(html, NOW).summary.channels.map((channel) => channel.name), ['Workshop Wanda & Co', 'Bench Notes']);

// 4. A file that is not a watch history says so, in plain words.
for (const [text, says] of [
  ['{"not":"a list"}', /NOT A WATCH HISTORY FILE/],
  ['<html><body>hello</body></html>', /NOT A WATCH HISTORY FILE/],
  ['this is not json [', /NOT A WATCH HISTORY FILE/],
  ['[]', /NO WATCHED VIDEOS/],
  [JSON.stringify([{ header: 'Search', title: 'Searched for x', time: at(1) }]), /NO WATCHED VIDEOS/],
  [JSON.stringify([watched('Ancient upload', 'Long Gone', 900)]), /LAST TWO YEARS/],
]) {
  const result = readTakeout(text, NOW);
  assert.equal(result.ok, false);
  assert.match(result.problem, says);
  assert.doesNotMatch(result.problem, /[a-z]/, 'said in the page\'s own capitals, with no error text');
}
const good = readTakeout(json, NOW);
assert.equal(good.ok, true);

// 5. Caps, and what comes back from storage.
const many = summarise(Array.from({ length: 400 }, (_, n) => ({ title: `word${n % 90} alpha${n % 90} shared`, channel: `Channel ${n}`, at: NOW - (n % 300) * DAY })), NOW);
assert.equal(many.channels.length, MAX_CHANNELS, 'two hundred channels at most');
assert.ok(many.words.length <= MAX_WORDS, 'sixty words at most');
assert.equal(asSummary(null), null);
assert.equal(asSummary({ channels: [{ name: 'x', strength: 'high', last: '2026-10' }] }), null, 'nothing shaped like a channel: no summary');
assert.deepEqual(asSummary({ channels: [{ name: 'Wanda', strength: 9.4, last: '2026-10', extra: 'dropped' }, { name: 'Bad', strength: 2, last: 'October' }], words: ['lathe', 7], importedAt: at(1), videos: ['dropped'] }), { channels: [{ name: 'Wanda', strength: 5, last: '2026-10' }], words: ['lathe'], importedAt: at(1) });

// 6. What it teaches: an imported channel stands by name alone, with no YouTube link at all.
const standings = channelStandings({ evidence: [], rows: [], summary, now: NOW });
assert.deepEqual(standings.filter((standing) => standing.live).map((standing) => standing.name), ['Workshop Wanda', 'Bench Notes', 'Tape Loop']);
assert.ok(standings[0].why === 'FROM YOUR YOUTUBE HISTORY' && standings[0].subscribed === false);

// 7. From the files: read in the browser, never sent; removable; erased with the history; explained on the key.
const store = fs.readFileSync('app/lib/recommender/watch-summary.ts', 'utf8');
assert.match(store, /text = await file\.text\(\);/, 'the file is read in the browser');
assert.doesNotMatch(store, /fetch\(|FormData|XMLHttpRequest|\.storage\b|upload\(/, '... and no request or upload carries it');
assert.match(store, /upsert\(\{ person, channels: summary\.channels, words: summary\.words, imported_at: summary\.importedAt \}\)/, 'only the summary is saved');
assert.match(store, /from\('user_watch_summary'\)\.delete\(\)\.eq\('person', person\)/, 'REMOVE IMPORT deletes the row');
assert.match(fs.readFileSync('app/lib/recommender/history.ts', 'utf8'), /export async function eraseHistory\(\): Promise<boolean> \{\s*recent\.clear\(\);\s*void removeSummary\(\);/, 'ERASE MY HISTORY removes it too');
const key = fs.readFileSync('app/components/ImportYouTubeHistory.tsx', 'utf8');
assert.match(key, /\[ IMPORT YOUTUBE HISTORY \]/);
assert.match(key, /aria-expanded=\{open\}/, 'the key says when its panel is open');
assert.match(key, /TAKEOUT\.GOOGLE\.COM/, 'it says where to get the file');
assert.match(key, /SET HISTORY TO JSON/, '... and which format');
assert.match(key, /READ IN YOUR BROWSER AND NEVER UPLOADED/, '... and what happens to it');
assert.match(key, /\[ REMOVE IMPORT \]/);
assert.match(fs.readFileSync('app/lib/web/youtube-link.ts', 'utf8'), /weigh\(read, rows, now, \{ related, summary \}\)/, 'the shelf is weighed with it');
assert.match(fs.readFileSync('app/privacy/page.tsx', 'utf8'), /Google Takeout/, 'the privacy page says so');

console.log('ok: Takeout import: both files read, only a summary kept, plain problems, never uploaded, removable');
