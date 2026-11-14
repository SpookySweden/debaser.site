/*
 * YOUR YOUTUBE, closer to what a person watches (Luke, 2026-11-14), offline:
 *   npx tsc app/lib/recommender/youtube-picks.ts app/lib/recommender/youtube-read.ts app/lib/recommender/watch-signals.ts app/lib/recommender/engine.ts app/lib/recommender/types.ts app/lib/web/recommend.ts --rootDir app/lib --outDir Temp/youtube-picks-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *
 * "many users are subscribed to many channels they no longer watch, and most often watch videos from channels they are
 * not subscribed to":
 * - a subscription with nothing recent to show drops out (taste and shelf); one they still like, save or play here stays
 * - a channel they never subscribed to rises on its likes and on what they play here
 * - recent likes weigh most and fade
 * - on this site a finish counts strongly, a quick skip a little against, NOT FOR ME strongly against
 * - the shelf keeps about 7 familiar to 3 new, steady for a day
 * - SHOW LESS FROM THIS CHANNEL and MORE LIKE THIS (the feedback key) reshape it
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { channelStandings, youTubeTaste, youTubeShelf, seedVideos, liveChannelIds } = require('./youtube-picks-out/recommender/youtube-picks.js');
const { asRead, weigh, watchedHere, keptChannels, keptAsEvidence } = require('./youtube-picks-out/recommender/youtube-read.js');
const { tasteFromHistory, lessMakers } = require('./youtube-picks-out/recommender/engine.js');
const { actionAfter, makerRef } = require('./youtube-picks-out/recommender/types.js');
const { leftAs } = require('./youtube-picks-out/recommender/watch-signals.js');
const { NO_TASTE } = require('./youtube-picks-out/web/recommend.js');

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-14T12:00:00Z');
const ago = (days) => new Date(NOW - days * DAY).toISOString();
const id = (n) => `UC${String(n).padStart(22, 'a')}`;
const channel = (n, name, over = {}) => ({ id: id(n), name, subscribed: false, liked: [], saved: [], ...over });
const row = (over) => ({ kind: 'media', ref: 'youtube:xxxxxxxxxxx', title: 'X', maker: '', words: [], action: 'played', firstAt: ago(1), lastAt: ago(1), ...over });
const video = (vid, creator, days = 2) => ({ id: `youtube:${vid.padEnd(11, '0')}`, title: `${creator} ${vid}`, creator, publishedAt: ago(days) });

// 1. Where channels stand. YouTube's own order of the subscriptions is the order given.
const evidence = [
  channel(1, 'Dead Sub', { subscribed: true }),
  channel(2, 'Old Flame', { subscribed: true, liked: [ago(400)] }),
  channel(3, 'Live Sub', { subscribed: true, liked: [ago(60)] }),
  channel(4, 'Watched Sub', { subscribed: true }),
  channel(5, 'Stranger', { liked: [ago(5), ago(20)] }),
  channel(6, 'Playlisted', { saved: [ago(30)] }),
];
const rows = [
  row({ ref: 'youtube:siteonly001', title: 'A talk', maker: 'Site Only', action: 'finished', lastAt: ago(3) }),
  row({ ref: 'youtube:watchedsub1', title: 'Their video', maker: 'watched sub', action: 'played', lastAt: ago(6) }),
];
const standings = channelStandings({ evidence, rows, now: NOW });
const of = (name, list = standings) => list.find((standing) => standing.name.toLowerCase() === name.toLowerCase());

assert.equal(of('Dead Sub').live, false, 'a subscription with nothing to show is not live');
assert.equal(of('Dead Sub').outside, 0, '... and teaches nothing');
assert.equal(of('Old Flame').live, false, 'a like from over a year ago does not keep a subscription alive');
assert.ok(of('Old Flame').weight < 0.1, '... and has all but faded');
assert.equal(of('Live Sub').live, true, 'a subscription liked lately counts');
assert.equal(of('Watched Sub').live, true, 'a subscription played on this site counts, with no like at all');
assert.equal(of('Stranger').live, true, 'a channel never subscribed to counts on its likes');
assert.equal(of('Stranger').subscribed, false);
assert.ok(of('Stranger').weight > of('Live Sub').weight, 'two recent likes outweigh one like and a subscription');
assert.equal(of('Playlisted').live, true, 'a channel in their playlists lately counts');
assert.equal(of('Site Only').live, true, 'a channel only ever played here counts');
assert.equal(of('Site Only').id, null, '... though YouTube never named it');
assert.equal(of('Site Only').why, 'YOU WATCH THEM HERE');
assert.equal(of('Stranger').why, 'YOU LIKED THEIR VIDEOS LATELY');
const order = standings.map((standing) => standing.name);
assert.ok(order.indexOf('Stranger') < order.indexOf('Dead Sub') && order.indexOf('Site Only') < order.indexOf('Dead Sub'), 'unsubscribed channels they watch rise above dead subscriptions');
assert.deepEqual(order.slice(-2).sort(), ['Dead Sub', 'Old Flame'], 'the dead subscriptions come last');
assert.deepEqual(liveChannelIds(standings).sort(), [id(3), id(4), id(5), id(6)].sort(), "new videos are read for the channels that stand, the stranger's too");

// 1b. Likes fade: last week > four months ago > last year.
const fading = channelStandings({ evidence: [channel(1, 'Week', { liked: [ago(7)] }), channel(2, 'Months', { liked: [ago(120)] }), channel(3, 'Year', { liked: [ago(365)] })], rows: [], now: NOW });
assert.deepEqual(fading.map((standing) => standing.name), ['Week', 'Months', 'Year']);
assert.ok(of('Week', fading).weight > 2 * of('Months', fading).weight, 'a like from last week weighs more than twice one from four months ago');

// 1c. Nothing at all to go on (just linked, never likes): YouTube's own first subscriptions stand in, lightly.
const blank = channelStandings({ evidence: Array.from({ length: 14 }, (_, n) => channel(n, `Sub ${n}`, { subscribed: true })), rows: [], now: NOW });
assert.equal(blank.filter((standing) => standing.live).length, 10, 'the first ten, and no more');
assert.equal(blank[0].name, 'Sub 0', "in YouTube's order");
assert.ok(blank[0].outside <= 1, '... each counting for less than one real like');

// 1d. An imported YouTube history (Google Takeout): channels by name with a strength and a month.
const summary = { channels: [{ name: 'Dead Sub', strength: 5, last: '2026-10' }, { name: 'Long Gone', strength: 5, last: '2024-01' }], words: ['woodworking'], importedAt: ago(1) };
const imported = channelStandings({ evidence, rows, summary, now: NOW });
assert.equal(of('Dead Sub', imported).live, true, 'a subscription the import shows watched last month is alive again');
assert.equal(of('Long Gone', imported).live, false, 'a channel last watched years ago is not');
assert.equal(of('Dead Sub', imported).why, 'FROM YOUR YOUTUBE HISTORY');

// 2. The taste: dead subscriptions add nothing, strangers add as much as anyone.
const taste = youTubeTaste(NO_TASTE, { standings, topics: ['Film', 'Jazz'], playlists: ['Rainy day'], summary });
assert.equal(taste.creators['dead sub'], undefined, 'a dead subscription is not in the taste at all');
assert.ok(taste.creators.stranger > taste.creators['live sub'] && taste.creators['live sub'] > 0);
assert.equal(taste.creators['site only'], undefined, 'what they did here is already in the taste from their history: not added twice');
assert.ok(taste.tags.film > 0 && taste.tags['rainy day'] > 0 && taste.tags.woodworking > 0, "topics, playlist names and an import's words");
assert.deepEqual(youTubeTaste(NO_TASTE, { standings: [], topics: [], playlists: [] }), NO_TASTE, 'no YouTube: nothing changes');

// 3. The shelf.
const uploads = [
  ...['a', 'b', 'c'].map((n) => video(`dead${n}`, 'Dead Sub')),
  ...['a', 'b', 'c'].map((n) => video(`live${n}`, 'Live Sub')),
  ...['a', 'b', 'c'].map((n) => video(`strg${n}`, 'Stranger')),
  ...['a', 'b', 'c'].map((n) => video(`wtch${n}`, 'Watched Sub')),
];
const shelf = youTubeShelf({ uploads, liked: [video('liked1', 'Stranger', 300)], related: [], standings, rows, now: NOW, size: 20 });
assert.ok(shelf.length >= 9);
const dead = shelf.filter((pick) => pick.item.creator === 'Dead Sub');
assert.deepEqual([dead.length, shelf.indexOf(dead[0]), dead[0].why, dead[0].fresh], [1, 5, 'FROM A CHANNEL YOU SUBSCRIBE TO', true], "a dead subscription is not among the familiar picks: one video of theirs, as a surprise in a new place");
assert.ok(shelf.some((pick) => pick.item.creator === 'Stranger' && pick.item.id.includes('strg')), "an unsubscribed channel's new videos are");
assert.equal(shelf[0].item.creator, 'Stranger', 'the channel that stands highest leads');
assert.equal(shelf.at(-1).why, 'YOU LIKED THIS', 'their own likes come last');
assert.equal(shelf.find((pick) => pick.item.creator === 'Watched Sub').why, 'YOU WATCH THEM HERE', 'every pick says why, in words');
for (const pick of shelf) assert.doesNotMatch(pick.why, /\d/, 'no numbers in a why-line');
assert.ok(shelf.slice(0, 4).filter((pick) => pick.item.creator === 'Stranger').length <= 2, "one channel can't fill the top of the shelf");

// 3b. About 7 familiar to 3 new: YouTube's "watch next" from channels they have never met takes the new places.
const many = Array.from({ length: 14 }, (_, n) => video(`fam${n}`, n % 2 ? 'Live Sub' : 'Stranger'));
const related = [
  ...Array.from({ length: 8 }, (_, n) => ({ item: video(`new${n}`, `Unknown ${n}`), seed: 'A talk' })),
  { item: video('relknown', 'Live Sub'), seed: 'A talk' },
  { item: video('reldead', 'Dead Sub'), seed: 'A talk' },
];
const mixed = youTubeShelf({ uploads: many, liked: [], related, standings, rows, now: NOW, size: 10 });
assert.deepEqual(mixed.map((pick) => pick.fresh), [false, false, true, false, false, true, false, false, true, false], '7 familiar to 3 new, in steady places');
assert.ok(mixed.filter((pick) => pick.fresh).every((pick) => pick.why === "NEW TO YOU: YOUTUBE'S NEXT AFTER A TALK"), 'a new one says where it came from');
const everything = youTubeShelf({ uploads: many, liked: [], related, standings, rows, now: NOW, size: 40 });
assert.equal(everything.find((pick) => pick.item.id.includes('relknown')).why, "YOUTUBE'S NEXT AFTER A TALK", 'a "watch next" from a channel that stands is familiar');
assert.equal(everything.find((pick) => pick.item.id.includes('reldead')).fresh, true, 'a "watch next" from a dead subscription is offered only as something new');
const ids = (picks) => picks.map((pick) => pick.item.id).join(',');
assert.equal(ids(youTubeShelf({ uploads: many, liked: [], related, standings, rows, now: NOW + 3_600_000, size: 10 })), ids(mixed), 'the same all day');
assert.notEqual(ids(youTubeShelf({ uploads: many, liked: [], related, standings, rows, now: NOW + 3 * DAY, size: 10 })), ids(mixed), 'different another day');

// 3c. A thin shelf is topped up from the other subscriptions, last and plainly said.
const thin = youTubeShelf({ uploads, liked: [], related: [], standings: channelStandings({ evidence: [evidence[0], evidence[2]], rows: [], now: NOW }), rows: [], now: NOW, size: 20 });
assert.deepEqual(thin.slice(0, 3).map((pick) => pick.item.creator), ['Live Sub', 'Live Sub', 'Live Sub']);
assert.ok(thin.length > 3 && thin.slice(3).every((pick) => pick.why === 'FROM A CHANNEL YOU SUBSCRIBE TO'), 'the rest of the subscriptions fill it, after');

// 3d. Surprises (Luke, 2026-11-14: "regarding 'dead subscribes' add them in occasionally as surprises too"): one in ten,
// a different quiet subscription each time and each day; playing one brings its channel back; NOT FOR ME or SHOW LESS quiets it.
const quietSubs = ['Quiet A', 'Quiet B', 'Quiet C', 'Quiet D'].map((name, n) => channel(20 + n, name, { subscribed: true }));
const quietEvidence = [...evidence, ...quietSubs];
const quietUploads = [...Array.from({ length: 30 }, (_, n) => video(`fill${n}`, n % 2 ? 'Live Sub' : 'Stranger')), ...quietSubs.flatMap(({ name }) => [video(`${name.slice(-1)}one`, name), video(`${name.slice(-1)}two`, name)])];
const surprised = (extraRows = [], now = NOW) => {
  const all = [...rows, ...extraRows];
  return youTubeShelf({ uploads: quietUploads, liked: [], related: [], standings: channelStandings({ evidence: quietEvidence, rows: all, now }), rows: all, now, size: 30 });
};
const isQuiet = (pick) => pick.item.creator.startsWith('Quiet');
const first = surprised();
assert.deepEqual(first.map((pick, at) => (isQuiet(pick) ? at : -1)).filter((at) => at >= 0), [5, 15, 25], 'one surprise in every ten, and no more');
assert.equal(new Set(first.filter(isQuiet).map((pick) => pick.item.creator)).size, 3, 'a different channel each time');
assert.ok(first.filter(isQuiet).every((pick) => pick.why === 'FROM A CHANNEL YOU SUBSCRIBE TO' && pick.fresh), 'said plainly, in a new place');
const leaders = new Set([0, 1, 2, 3, 4, 5, 6].map((days) => surprised([], NOW + days * DAY).find(isQuiet).item.creator));
assert.ok(leaders.size >= 2, 'the channels take turns from day to day');
const leader = first.find(isQuiet).item;
const engaged = surprised([row({ ref: leader.id, title: leader.title, maker: leader.creator, action: 'played', lastAt: ago(0) })]);
const back = engaged.filter((pick) => pick.item.creator === leader.creator);
assert.ok(back.length > 0 && back.every((pick) => !pick.fresh && pick.why === 'YOU WATCH THEM HERE'), 'played once, the channel is alive again: its other video is a familiar pick');
const refused = surprised([row({ ref: leader.id, title: leader.title, maker: leader.creator, action: 'not_for_me' })]);
assert.ok(!refused.some((pick) => pick.item.creator === leader.creator), 'NOT FOR ME on a surprise: that channel is not offered again');
const lessOfIt = surprised([{ kind: 'maker', ref: makerRef(leader.creator), title: leader.creator, maker: leader.creator, words: [], action: 'less', firstAt: ago(0), lastAt: ago(0) }]);
assert.ok(!lessOfIt.some((pick) => pick.item.creator === leader.creator), 'SHOW LESS FROM THIS CHANNEL: nor then');
assert.equal(youTubeTaste(NO_TASTE, { standings: channelStandings({ evidence: quietEvidence, rows, now: NOW }), topics: [], playlists: [] }).creators['quiet a'], undefined, 'a surprise is only on the shelf: a quiet subscription still teaches the taste nothing');

// 4. What they do on this site: finish > play > open, a quick skip against, NOT FOR ME strongly against.
const acted = (action, over = {}) => tasteFromHistory([row({ maker: 'Maker', words: ['word'], action, lastAt: ago(0), ...over })], NOW);
assert.ok(acted('finished').creators.maker >= 2 * acted('played').creators.maker, 'a finish counts strongly: at least twice a play');
assert.ok(acted('played').creators.maker > acted('opened').creators.maker);
assert.ok(acted('skipped').creators.maker < 0 && acted('skipped').tags.word < 0, 'a quick skip counts against');
assert.ok(acted('not_for_me').creators.maker <= 3 * acted('skipped').creators.maker, 'NOT FOR ME counts at least three times a skip');
assert.ok(Math.abs(acted('skipped', { lastAt: ago(30) }).creators.maker) < Math.abs(acted('skipped').creators.maker), 'a skip fades');
assert.equal(acted('not_for_me', { lastAt: ago(80) }).creators.maker, acted('not_for_me').creators.maker, 'NOT FOR ME does not');

// 4b. The shelf listens: NOT FOR ME hides the video, a fresh skip with nothing to set against it drops the channel.
const hide = [...rows, row({ ref: uploads[3].id, maker: 'Live Sub', action: 'not_for_me' })];
assert.ok(!youTubeShelf({ uploads, liked: [], related: [], standings: channelStandings({ evidence, rows: hide, now: NOW }), rows: hide, now: NOW, size: 20 }).some((pick) => pick.item.id === uploads[3].id), 'NOT FOR ME takes the video off the shelf');
const skipped = [row({ ref: 'youtube:unknownskip', maker: 'Unknown 0', action: 'skipped', lastAt: ago(0) })];
const afterSkip = youTubeShelf({ uploads: [], liked: [], related, standings: channelStandings({ evidence, rows: skipped, now: NOW }), rows: skipped, now: NOW, size: 40 });
assert.ok(!afterSkip.some((pick) => pick.item.creator === 'Unknown 0') && afterSkip.some((pick) => pick.item.creator === 'Unknown 1'), 'a channel just skipped is not offered as something new');
const likedButSkipped = [row({ ref: 'youtube:strangerskp', maker: 'Stranger', action: 'skipped', lastAt: ago(0) })];
assert.equal(of('Stranger', channelStandings({ evidence, rows: likedButSkipped, now: NOW })).live, true, 'one skip does not undo a channel they like');

// 5. The feedback key. SHOW LESS FROM THIS CHANNEL is one row about the maker; MORE LIKE THIS lifts the thing's words and maker.
const less = [...rows, { kind: 'maker', ref: makerRef(' Stranger '), title: 'Stranger', maker: 'Stranger', words: [], action: 'less', firstAt: ago(0), lastAt: ago(0) }];
assert.equal(makerRef(' Live  SUB '), 'live sub', 'one row a channel, whatever the case or spacing');
assert.ok(lessMakers(less).has('stranger'));
const lessStandings = channelStandings({ evidence, rows: less, now: NOW });
assert.equal(of('Stranger', lessStandings).live, false, 'SHOW LESS: the channel no longer stands');
assert.equal(of('Stranger', lessStandings).outside, 0, '... its likes teach nothing');
assert.ok(!youTubeShelf({ uploads, liked: [video('liked1', 'Stranger', 300)], related: [{ item: video('relstrg', 'Stranger'), seed: 'A talk' }], standings: lessStandings, rows: less, now: NOW, size: 40 }).some((pick) => pick.item.creator === 'Stranger'), '... and nothing of theirs is on the shelf: uploads, likes or "watch next"');
assert.ok(tasteFromHistory(less, NOW).creators.stranger < -5, '... and MEDIA sinks their rows');
assert.equal(tasteFromHistory(less, NOW).tags.stranger, undefined, '... without holding any word against anything else');
const more = tasteFromHistory([row({ ref: 'youtube:morelikeit1', title: 'Synth build', maker: 'Maker', words: ['synthesizer'], action: 'more', lastAt: ago(80) })], NOW);
assert.ok(more.creators.maker >= acted('finished').creators.maker && more.tags.synthesizer > 0, 'MORE LIKE THIS counts like a finish, and does not fade');
assert.equal(of('Maker', channelStandings({ evidence: [], rows: [row({ maker: 'Maker', action: 'more', lastAt: ago(80) })], now: NOW })).live, true, '... and its channel stands');
const wanted = [...rows, row({ ref: uploads[3].id, title: uploads[3].title, maker: 'Live Sub', action: 'more', lastAt: ago(0) })];
assert.ok(youTubeShelf({ uploads, liked: [], related: [], standings: channelStandings({ evidence, rows: wanted, now: NOW }), rows: wanted, now: NOW, size: 20 }).some((pick) => pick.item.id === uploads[3].id), '... and the pick it was pressed on stays where it is');
const playedOne = [...rows, row({ ref: uploads[3].id, title: uploads[3].title, maker: 'Live Sub', action: 'played', lastAt: ago(0) })];
assert.ok(!youTubeShelf({ uploads, liked: [], related: [], standings: channelStandings({ evidence, rows: playedOne, now: NOW }), rows: playedOne, now: NOW, size: 20 }).some((pick) => pick.item.id === uploads[3].id), 'while a video already played here is not offered again');

// 5b. Which note wins on one row: a press replaces anything, and only another press replaces a press.
assert.equal(actionAfter(null, 'played'), 'played');
assert.equal(actionAfter('played', 'opened'), 'played', 'a weaker thing never replaces a stronger one');
assert.equal(actionAfter('played', 'skipped'), 'skipped', 'a video played, then let go at once, was skipped');
assert.equal(actionAfter('skipped', 'played'), 'skipped');
assert.equal(actionAfter('skipped', 'finished'), 'finished', 'finishing it later replaces the skip');
assert.equal(actionAfter('finished', 'skipped'), 'finished');
assert.equal(actionAfter('finished', 'not_for_me'), 'not_for_me');
assert.equal(actionAfter('not_for_me', 'finished'), 'not_for_me', 'NOT FOR ME stays whatever is played after');
assert.equal(actionAfter('not_for_me', 'more'), 'more', 'the newest press wins');
assert.equal(actionAfter('more', 'played'), 'more');

// 5c. Skipped or not: closed or replaced within 30 seconds of starting, having started, and not finished.
assert.equal(leftAs({ done: false, sinceMs: 5_000, startedPlaying: true }), 'skipped');
assert.equal(leftAs({ done: false, sinceMs: 31_000, startedPlaying: true }), null, 'watched past half a minute: not a skip');
assert.equal(leftAs({ done: true, sinceMs: 5_000, startedPlaying: true }), null, 'a finished video is not skipped');
assert.equal(leftAs({ done: false, sinceMs: 5_000, startedPlaying: false }), null, 'a player that never started (blocked, unavailable) is not the person skipping');

// 6. The videos "watch next" is asked about: finished here and liked lately, taking turns, never something turned down.
const seeds = seedVideos({
  liked: [{ ...video('likedold', 'Stranger'), likedAt: ago(40) }, { ...video('likednew', 'Stranger'), likedAt: ago(2) }, { ...video('likedbad', 'Stranger'), likedAt: ago(1) }],
  rows: [
    row({ ref: 'youtube:playedone11', title: 'Played', maker: 'P', action: 'played', lastAt: ago(0) }),
    row({ ref: 'youtube:finishedone', title: 'Finished', maker: 'F', action: 'finished', lastAt: ago(9) }),
    row({ ref: 'youtube:likedbad000', title: 'Bad', maker: 'Stranger', action: 'not_for_me' }),
    row({ ref: 'internet_archive:film', title: 'A film', maker: 'A', action: 'finished' }),
    row({ ref: 'youtube:skippedone1', title: 'Skipped', maker: 'S', action: 'skipped' }),
  ],
  limit: 3,
});
assert.deepEqual(seeds.map((seed) => seed.id), ['finishedone', 'playedone11', 'likednew000'], 'a finish before a play, then the newest like still wanted; nothing skipped, turned down or from another site');
assert.deepEqual(Object.keys(seeds[0]).sort(), ['creator', 'id', 'title'], 'only the id, title and channel go');

// 7. What the browser keeps, and an older kept copy.
const read = asRead({ uploads, liked: [video('liked1', 'Stranger', 300)], likedAt: { 'youtube:liked100000': ago(2), bad: 7 }, channels: [{ id: id(1), name: 'Dead Sub' }, { nope: true }], topics: ['Film', 3], playlists: ['Rainy day'], evidence: [...evidence, { id: 5 }] });
assert.equal(read.evidence.length, evidence.length, 'anything not shaped like a read is dropped');
assert.deepEqual(read.likedAt, { 'youtube:liked100000': ago(2) });
const found = weigh(read, rows, NOW);
assert.deepEqual(found.subscribed, [{ id: id(1), name: 'Dead Sub' }], 'the plain list of subscriptions is still there');
assert.ok(!found.channels.some((one) => one.name === 'Dead Sub') && found.channels.some((one) => one.name === 'Stranger'), 'the channels that teach the page are the ones that stand, not the subscriptions');
assert.ok(!weigh(asRead({ uploads, channels: [], evidence }), rows, NOW).channels.some((one) => one.name === 'Old Flame'), '... and a subscription liked once, long ago, is not one of them');
assert.equal(found.items.length, found.picks.length);
assert.ok(found.seeds.some((seed) => seed.id === 'siteonly001'), 'a video finished here is asked about');
assert.deepEqual(watchedHere(read, rows), [id(4)], "the read's hint: subscriptions played here, by YouTube id");
const old = asRead({ items: uploads, channels: [{ id: id(1), name: 'Dead Sub' }, { id: id(3), name: 'Live Sub' }], topics: [], playlists: [] });
assert.equal(old.uploads.length, uploads.length, "a copy kept before this change: its videos are read as uploads");
assert.ok(old.evidence.every((one) => one.subscribed && one.liked.length === 0), '... and its subscriptions stand in until the next read');

// 7b. What the account keeps (Luke's OK 2026-11-14: "up to 50 channels that matter, each with subscribed yes/no and its
// latest like or add date"): the channels that stand first, a day and never a count, and nothing from this site's history.
const account = keptChannels(evidence, channelStandings({ evidence, rows: [], now: NOW }));
assert.deepEqual(account.slice(0, 3).map((one) => one.name).sort(), ['Live Sub', 'Playlisted', 'Stranger'], 'the channels that stand lead, the strangers too');
assert.deepEqual(account.find((one) => one.name === 'Stranger'), { id: id(5), name: 'Stranger', sub: false, seen: ago(5).slice(0, 10) }, 'subscribed or not, and the day of the latest like');
assert.deepEqual(account.find((one) => one.name === 'Dead Sub'), { id: id(1), name: 'Dead Sub', sub: true, seen: null }, 'the other subscriptions follow, with no day');
assert.ok(account.every((one) => Object.keys(one).join() === 'id,name,sub,seen'), 'nothing else is kept');
assert.equal(keptChannels(Array.from({ length: 80 }, (_, n) => channel(100 + n, `Many ${n}`, { subscribed: true })), []).length, 50, 'fifty at most');
const second = keptAsEvidence(JSON.parse(JSON.stringify(account)));
const secondStandings = channelStandings({ evidence: second, rows: [], now: NOW });
assert.equal(of('Stranger', secondStandings).live, true, 'on another device a channel liked lately still stands');
assert.equal(of('Dead Sub', secondStandings).live, false, '... and a dead subscription is still dead');
assert.deepEqual(keptAsEvidence([{ id: id(1), name: 'Old row' }, { id: 'nonsense', name: 'x' }, 'junk']), [{ id: id(1), name: 'Old row', subscribed: true, liked: [], saved: [] }], 'a row saved before this change reads as subscriptions; junk is dropped');
const taste2 = fs.readFileSync('app/lib/web/youtube-taste.ts', 'utf8');
assert.match(taste2, /channels: keptChannels\(taste\.evidence, taste\.standings\)/, 'the account copy is built by that rule');
assert.match(fs.readFileSync('app/lib/web/youtube-link.ts', 'utf8'), /standings: weigh\(read, \[\], Date\.now\(\)\)\.standings/, "... from YouTube's own evidence, never from what was played here");

// 8. From the files: where it is wired.
const link = fs.readFileSync('app/lib/web/youtube-link.ts', 'utf8');
assert.match(link, /const first = weigh\(read, rows, now, \{ summary \}\);/, 'what the page is handed is weighed with the history (and an imported summary) on every visit');
assert.match(link, /weigh\(read, rows, now, \{ related, summary \}\)/, '... and again with YouTube\'s "watch next" once it is in');
assert.match(link, /prefer: watchedHere\(saved, rows\)/, 'the read is told which channels are watched here');
const history = fs.readFileSync('app/lib/recommender/history.ts', 'utf8');
assert.match(history, /if \(note\.kind === 'media' && note\.action === 'played'\) watchPlayback\(/, 'a played video is watched to its end or its quick close');
const lane = fs.readFileSync('app/components/ForYouYouTube.tsx', 'utf8');
assert.match(lane, /mine\?\.picks/, "DISCOVER's FROM YOUR YOUTUBE lane is the same shelf, with its whys");

console.log('ok: YOUR YOUTUBE: dead subscriptions out, watched strangers in, likes fade, finish and skip count, 7 to 3, the feedback presses');
