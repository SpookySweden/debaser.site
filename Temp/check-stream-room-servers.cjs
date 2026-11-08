/*
 * Stream rooms, Luke's four fixes of 2026-11-08 (and his chat addition), run offline:
 *   npx tsc app/lib/web/server-picks.ts app/lib/watch/rules.ts app/lib/watch/room-notes.ts app/lib/watch/blank-screen.ts app/lib/web/bridges.ts --outDir Temp/out-room-servers --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *   node Temp/check-stream-room-servers.cjs
 *
 * 1. A server's player starts together: the host's PLAY writes 0 and the beat walks up, so a restart is the room's position going
 *    back on the same play (`serverRestarted`), never a beat, a new play or a hand-over; every tab makes its player again on it.
 *    The NOT IN STEP line under the player is gone; the chat says it once per play (room-notes.ts).
 * 2. The queue browser's TMDB rows get the MEDIA page's choices (ServerPickers.tsx, server-picks.ts): FILM, SEASON and EPISODE,
 *    the server choice among the servers that hold the pick, and queue what was picked. A friend's server title is listed in an
 *    ordinary search, not only a KINO one (`roomListable`).
 * 3. ALL, first in the EPISODE list: every episode the server holds, season by season, as one block, at most ALL_EPISODES_MAX,
 *    and a longer show says so in words.
 * 4. The host's PLAY: a skip's old player never writes the next play's name with its own place (`hostMayPublish`), and only a real
 *    refusal raises the JOIN PLAYBACK key (`refusedByBrowser`), which is large.
 * Fewer automatic lines: UP NEXT every two minutes, and never a repeat of the line above it with nothing said since.
 */
const fs = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'Temp', 'out-room-servers');
const lib = (...parts) => join(OUT, 'lib', ...parts);

process.exitCode = 1;
let passed = 0;
const ok = (condition, message) => {
  if (!condition) {
    console.log(`FAIL ${message}`);
    process.exit(1);
  }
  passed += 1;
};
const same = (a, b, message) => ok(JSON.stringify(a) === JSON.stringify(b), `${message} (got ${JSON.stringify(a)})`);
const read = (file) => fs.readFileSync(join(ROOT, file), 'utf8');

// Three fake friends, as the media-server harness has them: alpha has every player, bravo no whole-series player.
const servers = require(lib('web', 'media-servers.js'));
servers.MEDIA_SERVERS.push(
  { id: 'alpha', label: 'ALPHA', base: 'https://alpha.fake-friend.test', listPath: '/debaser/list.json', play: { movie: '/debaser/play/movie/{tmdb}', tv: '/debaser/play/tv/{tmdb}/{season}/{episode}', series: '/debaser/play/tv/{tmdb}' } },
  { id: 'bravo', label: 'BRAVO', base: 'https://bravo.fake-friend.test', listPath: '/debaser/list.json', play: { movie: '/debaser/play/movie/{tmdb}', tv: '/debaser/play/tv/{tmdb}/{season}/{episode}' } },
);
const picks = require(lib('web', 'server-picks.js'));
const bridges = require(lib('web', 'bridges.js'));
const rules = require(lib('watch', 'rules.js'));
const notes = require(lib('watch', 'room-notes.js'));
const blank = require(lib('watch', 'blank-screen.js'));

/* --- 2 and 3: the pickers' choices, and what is queued -------------------------------------------------- */
const show = { type: 'tv', tmdbId: 900002, copies: [{ server: 'alpha', episodes: [[2, 2], [1, 1], [1, 2], [1, 3], [2, 1]] }, { server: 'bravo', episodes: [[1, 1]] }] };
const first = picks.firstPick(show);
same([first.season, first.episode, first.whole, first.all], [1, 1, false, false], 'a show starts on its first season\'s first episode');
same(picks.pickHolders(show, first), ['alpha', 'bravo'], 'S1 E1: both servers hold it, so both are offered');
const s2e2 = { ...first, season: 2, episode: 2 };
same(picks.pickHolders(show, s2e2), ['alpha'], 'S2 E2: only the server that holds it is offered');
const one = picks.roomAddFor('alpha', show, 'EPISODE SHOW', s2e2);
same(one.kind === 'one' && [one.link.url, one.link.title], ['https://alpha.fake-friend.test/debaser/play/tv/900002/2/2', 'EPISODE SHOW · SEASON 2 · EPISODE 2'], 'the picked episode is queued, named for its season and episode');
ok(picks.roomAddFor('bravo', show, 'EPISODE SHOW', s2e2) === null, 'a server without that episode queues nothing');
const all = { ...first, all: true };
same(picks.pickHolders(show, all), ['alpha', 'bravo'], 'ALL: every server holding any episode is offered');
const block = picks.roomAddFor('alpha', show, 'EPISODE SHOW', all);
ok(block.kind === 'series' && block.title === 'EPISODE SHOW', 'ALL is one series block under the show\'s name');
same(block.links.map((link) => link.url.split('/tv/900002/')[1]), ['1/1', '1/2', '1/3', '2/1', '2/2'], 'ALL: every episode, season by season, in order (the list file\'s order does not matter)');
same(block.links.map((link) => link.title), ['SEASON 1 · EPISODE 1', 'SEASON 1 · EPISODE 2', 'SEASON 1 · EPISODE 3', 'SEASON 2 · EPISODE 1', 'SEASON 2 · EPISODE 2'], 'each episode is named in the queue');
ok(block.links.every((link) => bridges.isQueueableWebLink(link)), 'every link ALL makes passes the queue\'s own check');
ok(picks.allAddNote(block) === null, 'a show that fits says nothing more');
same(picks.roomAddFor('bravo', show, 'EPISODE SHOW', all).links.map((link) => link.url), ['https://bravo.fake-friend.test/debaser/play/tv/900002/1/1'], 'ALL on a server adds what that server holds');
same(picks.choiceFor(show, all, 'alpha'), { season: 1, episode: 1 }, 'ALL\'s PLAY on the MEDIA page plays the server\'s first episode');
same(picks.pickedLine(show, all, 'alpha'), 'ALL: 5 EPISODES, EVERY SEASON', 'the line under the pickers counts ALL');
const long = { type: 'tv', tmdbId: 1, copies: [{ server: 'alpha', episodes: Array.from({ length: 250 }, (_, i) => [Math.floor(i / 25) + 1, (i % 25) + 1]) }] };
const capped = picks.roomAddFor('alpha', long, 'LONG SHOW', { ...picks.firstPick(long), all: true });
ok(picks.ALL_EPISODES_MAX === 200, 'ALL adds at most 200 at once');
same([capped.links.length, capped.total, capped.links[199].title], [200, 250, 'SEASON 8 · EPISODE 25'], 'a longer show adds its first 200, in order, and knows how many there were');
same(picks.allAddNote(capped), 'ADDED THE FIRST 200 OF 250 EPISODES: 200 IS THE MOST AT ONCE.', 'and says so in words');
same(picks.pickedLine(long, { ...picks.firstPick(long), all: true }, 'alpha'), 'ALL: THE FIRST 200 OF 250 EPISODES', 'before it is added, too');
const whole = { type: 'tv', tmdbId: 900003, copies: [{ server: 'alpha', series: true, episodes: [[1, 1]] }] };
const wholeAdd = picks.roomAddFor('alpha', whole, 'WHOLE SHOW', { ...picks.firstPick(whole), whole: true });
same(wholeAdd.kind === 'one' && [wholeAdd.link.url, wholeAdd.link.title], ['https://alpha.fake-friend.test/debaser/play/tv/900003', 'WHOLE SHOW'], 'WHOLE SERIES queues the server\'s whole-series player');
const series = { type: 'movie', tmdbId: 900011, copies: [{ server: 'alpha' }, { server: 'bravo' }], parts: [{ id: 'one', title: 'SERIES FILM ONE', tmdbId: 900011, copies: [{ server: 'alpha' }] }, { id: 'two', title: 'SERIES FILM TWO', tmdbId: 900012, copies: [{ server: 'alpha' }, { server: 'bravo' }] }] };
same(picks.pickHolders(series, { ...picks.firstPick(series), partIndex: 0 }), ['alpha'], 'FILM one: only its own server');
const filmTwo = picks.roomAddFor('bravo', series, 'FAKE FILM SERIES', { ...picks.firstPick(series), partIndex: 1 });
same(filmTwo.kind === 'one' && [filmTwo.link.url, filmTwo.link.title], ['https://bravo.fake-friend.test/debaser/play/movie/900012', 'SERIES FILM TWO'], 'FILM two on the server picked is queued, by its own title');

// A friend's title is listed in an ordinary search; a KINO title only in a KINO lookup.
const serverRow = { id: 'media:tmdb-tv-900002', platform: 'alpha', kind: 'video', title: 'EPISODE SHOW', externalId: 'tmdb-tv-900002', url: 'https://www.themoviedb.org/tv/900002', publishedAt: '2026-01-01T00:00:00.000Z', media: show };
const kinoRow = { ...serverRow, id: 'media:tmdb-movie-1', platform: 'kino', media: { type: 'movie', tmdbId: 1, copies: [] } };
ok(blank.roomListable(serverRow, 'both', false), 'a title on a friend\'s server is listed in an ordinary search of a room');
ok(blank.roomListable(serverRow, 'video', false), 'and in a VIDEO search');
ok(!blank.roomListable(kinoRow, 'both', false), 'a KINO title nobody holds is not listed in an ordinary search (nothing to play)');
ok(blank.roomListable(kinoRow, 'both', true), 'but is in a KINO lookup');

/* --- 1: a server's player starts together --------------------------------------------------------------- */
const mark = { entryId: 'e1', position: 30 };
ok(rules.serverRestarted(mark, { currentEntryId: 'e1', positionSeconds: 0 }), 'the host\'s PLAY (0 after 30) is a restart');
ok(rules.serverRestarted(mark, { currentEntryId: 'e1', positionSeconds: 3 }), 'and is still seen from the next beat if its own write was missed');
ok(!rules.serverRestarted(mark, { currentEntryId: 'e1', positionSeconds: 33 }), 'a beat walking up is not a restart');
ok(!rules.serverRestarted(mark, { currentEntryId: 'e1', positionSeconds: 29.5 }), 'two beats crossing in flight are not a restart');
ok(!rules.serverRestarted({ entryId: 'e1', position: 0 }, { currentEntryId: 'e1', positionSeconds: 0 }), 'an older host still writing 0 every beat restarts nobody');
ok(!rules.serverRestarted(mark, { currentEntryId: 'e2', positionSeconds: 0 }), 'a new play is not a restart (its player is new anyway)');
ok(!rules.serverRestarted(null, { currentEntryId: 'e1', positionSeconds: 0 }), 'a viewer who just came in restarts nothing');
const room = read('app/components/WatchRoom.tsx');
ok(/<OfficialEmbedStage key=\{`official-\$\{entryId\}-\$\{serverOn \? serverSeen\.restarts : 0\}`\}/.test(room), 'every tab makes the server\'s player again on each restart (the counter is in its key)');
ok(/serverRestarted\(serverSeen\.mark, room\)/.test(room), 'counted from the room\'s own rows');
ok(/onClick=\{playServerForAll\}/.test(room) && /positionSeconds: 0, isPlaying: true/.test(room.slice(room.indexOf('function playServerForAll'), room.indexOf('function playServerForAll') + 600)), 'the host\'s PLAY FOR ALL writes 0, playing');
ok(!/NOT IN STEP: EVERYONE PRESSES PLAY ON THIS ONE\.<\/p>/.test(room), 'no line under the player any more (it never covers the picture)');
ok(/fixed visible frame bg-ink-plate pt-10 max-sm:pt-14 fullscreen:pt-0/.test(room), 'floating, the picture keeps clear of its title strip, deeper on a phone where its keys are the tap size (measured: it covered the picture\'s top)');
ok(/allow=\{server !== undefined \? 'autoplay; fullscreen' : 'fullscreen'\}/.test(room), 'a server\'s player may start by itself when it is made again');
ok(/notInStep=\{live && officialOn && entryId !== null \? \{ entryId, text: notInStepNote\(serverOn\) \} : null\}/.test(room), 'the chat is told about a play the room can\'t keep in step');

/* --- the chat's own lines -------------------------------------------------------------------------------- */
ok(notes.UP_NEXT_EVERY_MS === 120000, 'UP NEXT every two minutes, not every minute');
const upNext = { id: 'n1', at: '2026-11-08T10:00:00.000Z', kind: 'next', text: 'FILM' };
ok(notes.upNextRepeats([upNext], 'FILM', '2026-11-08T09:59:00.000Z'), 'the same UP NEXT with nothing said since is not said again');
ok(!notes.upNextRepeats([upNext], 'FILM', '2026-11-08T10:01:00.000Z'), 'once somebody has spoken it is said again');
ok(!notes.upNextRepeats([upNext], 'ANOTHER FILM', ''), 'a new next title is always said');
ok(!notes.upNextRepeats([upNext, { id: 's', at: '2026-11-08T10:00:30.000Z', kind: 'step', text: 'x' }], 'FILM', ''), 'nor is a line below another kind held back');
ok(!notes.upNextRepeats([], 'FILM', ''), 'the first is always said');
ok(/PAUSING AND SKIPPING IN THIS PLAYER ARE EACH PERSON'S OWN\./.test(notes.notInStepNote(true)) && /THE HOST'S PLAY STARTS EVERYONE'S PLAYER FROM THE TOP, TOGETHER\./.test(notes.notInStepNote(true)), 'the server\'s line says the host\'s PLAY starts everyone, and pausing and skipping are each person\'s own');
ok(/PAUSING AND SKIPPING IN THIS PLAYER ARE EACH PERSON'S OWN\./.test(notes.notInStepNote(false)), 'and a platform\'s own player says so too');
same(notes.notInStepId('e1'), notes.notInStepId('e1'), 'one note per play');
ok(/kept\.some\(\(note\) => note\.id === notInStepId\(stepEntry\)\)/.test(room), 'the room says it once per play, not on every redraw or restart');

/* --- 4: the host's PLAY keeps everyone in step ------------------------------------------------------------ */
ok(!rules.hostMayPublish('next', 'ending'), 'moving on, the old player does not write while the room still names the play that is ending');
ok(rules.hostMayPublish('next', 'next'), 'once the room names the next play, the host writes again');
ok(rules.hostMayPublish(null, 'any'), 'a host that has not moved on writes as ever');
ok((room.match(/if \(!hostMayPublish\(hostEntry\.current, room\.currentEntryId\)\) return;/g) ?? []).length === 2, 'the host\'s write asks it, and so does the beat for a platform\'s or a server\'s own player');
ok(/hostEntry\.current = null;\s*setFault\(failure instanceof Error \? failure\.message : 'THE NEXT FILE COULD NOT START\.'\);/.test(room), 'a start that failed (or whose answer was lost) never leaves the host silent');
// A follower's jump (live drive, 2026-11-08: a viewer 6 to 12 s behind after the host jumped, re-sent every half second).
const T = 1_000_000;
const firstJump = rules.followerJump(null, 100, 10, true, T);
same(firstJump && [firstJump.to, firstJump.mark.behind], [100, 0], 'the first jump goes straight to the host');
ok(rules.followerJump(firstJump.mark, 102, 10, true, T + 2000) === undefined, 'a jump on its way is let land: not sent again every half second');
ok(rules.followerJump(firstJump.mark, 160, 10, true, T + 2000) !== undefined, 'unless the host jumped again meanwhile');
const second = rules.followerJump(firstJump.mark, 104.5, 101, true, T + 4500);
same(second && [second.to, second.mark.behind], [106.5, 1], 'landed behind (the time it took to load): the next jump aims 2 s ahead');
const third = rules.followerJump(second.mark, 109, 106, true, T + 9000);
const fourth = rules.followerJump({ ...third.mark, behind: 5 }, 120, 110, true, T + 14000);
same([third.to - 109, fourth.to - 120], [4, rules.SEEK_LEAD_MAX_SECONDS], '4 s the time after, and never more than 6');
same(rules.followerJump(second.mark, 90, 99, true, T + 9000).to, 90, 'a player that landed ahead jumps back with no lead');
same(rules.followerJump(second.mark, 50, 40, false, T + 9000).to, 50, 'nor with the host paused');
ok(rules.followerJump(firstJump.mark, 130, 100, true, T + 6000, true) === undefined, 'a file still fetching the place it was sent to is waited for');
ok(rules.followerJump(firstJump.mark, 130, 100, true, T + 13000, true) !== undefined, 'but not for ever');
ok(/const jump = followerJump\(lastJump, step\.at, video\.currentTime, step\.playing, Date\.now\(\), loading\);/.test(room) && /if \(jump !== undefined\) \{\s*lastJump = jump\.mark;/.test(room), 'the follower asks it before every jump');
ok(!rules.refusedByBrowser({ name: 'AbortError' }), 'a start cut short by a pause or a new file raises no key');
ok(rules.refusedByBrowser({ name: 'NotAllowedError' }), 'the browser refusing sound raises the key');
ok(rules.refusedByBrowser(new Error('YouTube did not start.')), 'an embedded player that did not start raises the key');
ok((room.match(/refusedPlay/g) ?? []).length >= 7 && !/\(\) => setNeedsPress\(true\)\)/.test(room), 'every refused play goes through that one rule');
ok(/const JOIN_KEY = PLATE_MAIN\.replace\('px-3 py-1 text-key', 'min-h-tap px-6 py-2 text-heading'\);/.test(room) && /className=\{`\$\{JOIN_KEY\} pointer-events-auto`\}/.test(room), 'JOIN PLAYBACK is large: the 44px tap height at every width, in the heading size');
ok(read('app/lib/ui/controls.ts').includes('px-3 py-1 text-key'), 'and the main key still has the sizes it is made from');

/* --- the wiring ------------------------------------------------------------------------------------------- */
const queue = read('app/components/StreamQueueWindow.tsx');
ok(/<ServerPickers media=\{media\} pick=\{pick\}/.test(queue) && /roomAddFor\(server, media, item\.title, pick\)/.test(queue), 'the queue browser draws the MEDIA page\'s pickers and queues what they picked');
ok(/roomListable\(item, ask\.keep, lookingUp\)/.test(queue), 'and lists a friend\'s titles by the same rule');
ok(!/function serverLinkFor/.test(queue), 'the old always-the-first-episode link is gone');
ok(/putSeries\(add\.title, add\.links, straight\)/.test(queue), 'ALL goes in as one series block');
const row = read('app/components/WebMediaRow.tsx');
ok(/<ServerPickers media=\{media\} pick=\{pick\}/.test(row) && /roomAddFor\(server, media, item\.title, pick\)/.test(row), 'the MEDIA page\'s row uses the same pickers and the same room add');
ok(/series=\{\{ title: roomAdd\.title, links: roomAdd\.links, note: allAddNote\(roomAdd\) \}\}/.test(row), 'its ADD TO ROOM / WATCH IN ROOM takes ALL as a block');
const pickers = read('app/components/ServerPickers.tsx');
ok(/<option value=\{ALL_OPTION\}>ALL \(EVERY SEASON\)<\/option>\s*\{\(pick\.season/.test(pickers), 'ALL is the first option, above the episodes');
const key = read('app/components/WatchInRoomKey.tsx');
ok(/repository\.addSeriesToQueue\(\{ roomId, addedBy: user\.id, position: nextQueuePosition\(fresh\.queue\), inQueue, seriesTitle: series\.title, links: series\.links \}\)/.test(key), 'ADD TO ROOM adds ALL in one write, by the room\'s crown rule');
ok(/start\.series !== undefined/.test(read('app/lib/watch/go-live.ts')), 'WATCH IN ROOM starts a new room with ALL\'s block');

console.log(`ok ${passed} stream-room server checks`);
process.exitCode = 0;
