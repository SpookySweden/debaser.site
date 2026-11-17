/*
 * LEAGUEBOT on screen (SPEC-leaguebot.md, Luke 2026-11-17): every tab's component drawn from recorded, renamed answers.
 * (The arithmetic is check-leaguebot.cjs and check-leaguebot-game.cjs; the Riot ID table is check-leaguebot-live.cjs.)
 *   npx tsc app/components/LeagueBot.tsx app/components/LeagueStats.tsx app/components/LeagueLive.tsx app/components/LeagueReview.tsx app/components/LeagueChart.tsx app/components/LeagueAdvice.tsx app/components/LeagueIcon.tsx --rootDir app --outDir Temp/leaguebot-render-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --resolveJsonModule --strictNullChecks
 *   node Temp/check-leaguebot-render.cjs
 *
 * - the window first draws the Riot ID field, the server list (every server) and LOOK UP, and Riot's notice, no player yet
 * - STATS draws advice, the overview, form (twenty W/L marks), LATELY, LP over time, champions, lanes and opponents, every
 *   number labelled with its sample; champion names come from Riot's data (a stand-in before it loads, never a guess)
 * - LIVE first draws "not in a game" with CHECK NOW (it asks once mounted, never during a server render)
 * - REVIEW draws the twenty newest games with W/L, KDA, CS; an OP.GG game list says REVIEW needs U.GG
 * - the chart draws only lines, in the ink and accent tokens, with a table of the same numbers for screen readers
 * - an advice line wears its mark and its words; a missing icon keeps its square
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const el = React.createElement;
const OUT = path.join(__dirname, 'leaguebot-render-out');
const root = path.join(__dirname, '..');

function stub(file, exports) {
  const resolved = require.resolve(file);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } };
}
stub(path.join(OUT, 'components/AuthProvider.js'), { useAuth: () => ({ status: 'anonymous', user: null }) });
stub(path.join(OUT, 'lib/supabase/client.js'), { getSupabaseBrowserClient: () => null, isSupabaseConfigured: false });

const LeagueBot = require('./leaguebot-render-out/components/LeagueBot.js').default;
const LeagueStats = require('./leaguebot-render-out/components/LeagueStats.js').default;
const LeagueLive = require('./leaguebot-render-out/components/LeagueLive.js').default;
const LeagueReview = require('./leaguebot-render-out/components/LeagueReview.js').default;
const LeagueChart = require('./leaguebot-render-out/components/LeagueChart.js').default;
const LeagueAdvice = require('./leaguebot-render-out/components/LeagueAdvice.js').default;
const LeagueIcon = require('./leaguebot-render-out/components/LeagueIcon.js').default;

const fixtures = path.join(root, 'app/lib/leaguebot/fixtures');
const matches = JSON.parse(fs.readFileSync(path.join(fixtures, 'player-matches.json'), 'utf8'));
const html = (node) => renderToStaticMarkup(node);
const text = (markup) => markup.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, ' ');
const ME = { name: 'MOCK PLAYER', tag: 'EUW' };
const profile = { riotId: ME, region: 'EUW', level: 619, iconId: 6621, ranks: [{ queue: 'SOLO', tier: 'GRANDMASTER', division: 1, lp: 1837, wins: 1149, losses: 1084, hotStreak: true }], lpHistory: [{ at: '2026-11-06T15:11:38.000Z', tier: 'MASTER', division: 1, lp: 1260 }, { at: '2026-11-12T21:41:42.000Z', tier: 'MASTER', division: 1, lp: 1455 }], pastSeasons: [{ season: 31, tier: 'MASTER', division: 1, lp: 471 }] };
const data = { patch: '16.22.1', champions: new Map([[103, { name: 'Ahri', alias: 'Ahri', icon: 'https://ddragon.leagueoflegends.com/cdn/16.22.1/img/champion/Ahri.png' }]]), items: new Map(), spells: new Map(), runes: new Map() };

// The window, first draw.
const first = html(el(LeagueBot));
assert.match(first, /data-leaguebot-id/);
assert.equal((first.match(/<option /g) ?? []).length, 17, 'every server');
assert.match(text(first), /LOOK UP/);
assert.match(text(first), /isn't endorsed by Riot Games/);
assert.ok(!/data-leaguebot-player/.test(first), 'no player until one is looked up');

// STATS.
const stats = html(el(LeagueStats, { profile, matches, matchesSource: 'U.GG', data }));
const statsText = text(stats);
for (const title of ['ADVICE', 'OVERVIEW', 'FORM', 'LATELY', 'LP OVER TIME', 'PAST SEASONS', 'CHAMPIONS', 'LANES', 'HARDEST LANE OPPONENTS']) assert.ok(statsText.includes(title), `STATS draws ${title}`);
assert.match(statsText, /LAST \d+ RANKED SOLO GAMES, FROM U\.GG/, 'numbers say their sample and source');
assert.equal((stats.match(/>W<|>L</g) ?? []).length, 20, 'twenty W/L marks');
assert.ok(statsText.includes('Ahri'), "names from Riot's data");
assert.match(statsText, /CHAMPION \d+/, 'a champion not in the data shows a plain stand-in');
assert.ok(!/NaN|undefined|Infinity/.test(statsText), 'no broken numbers');
assert.match(text(html(el(LeagueStats, { profile: null, matches: [], matchesSource: 'U.GG', data: null }))), /NO RANKED SOLO GAMES/);

// LIVE, first draw.
const live = text(html(el(LeagueLive, { id: ME, region: 'EUW', data })));
assert.match(live, /NOT IN A GAME RIGHT NOW/);
assert.match(live, /CHECK NOW/);
assert.match(live, /not during champ select/);

// REVIEW, the list.
const review = html(el(LeagueReview, { id: ME, region: 'EUW', matches, matchesSource: 'U.GG', data }));
assert.equal((review.match(/<li /g) ?? []).length, 20, 'the twenty newest games');
assert.match(text(review), /RECENT GAMES/);
assert.ok(!/NaN|undefined/.test(text(review)));
assert.match(text(html(el(LeagueReview, { id: ME, region: 'EUW', matches, matchesSource: 'OP.GG', data }))), /NO MINUTE-BY-MINUTE DETAIL/);

// The chart.
const chart = html(el(LeagueChart, { series: [{ label: 'LP', points: [{ x: 0, y: 1 }, { x: 1, y: 3 }], tone: 'ink' }], label: 'LP over time', yText: String, xText: String }));
assert.match(chart, /<polyline/);
assert.ok(!/<(path|circle|rect|text|image)[\s>]/.test(chart), 'lines only');
assert.match(chart, /class="sr-only"/, 'a table of the same numbers for screen readers');
assert.equal(html(el(LeagueChart, { series: [{ label: 'LP', points: [{ x: 0, y: 1 }], tone: 'ink' }], label: 'x', yText: String, xText: String })), '', 'one point draws nothing');

// Advice and icons.
const advice = html(el(LeagueAdvice, { lines: [{ key: 'a', mark: '!', text: 'Down: 50% in your last 20 games.', weight: 1 }], empty: 'NOTHING' }));
assert.match(advice, /aria-label="Problem"/);
assert.match(text(advice), /Down: 50%/);
assert.match(text(html(el(LeagueAdvice, { lines: [], empty: 'NOTHING STANDS OUT' }))), /NOTHING STANDS OUT/);
assert.match(html(el(LeagueIcon, { src: null, name: 'Ahri' })), /role="img"[^>]*|aria-label="Ahri"/, 'a missing icon keeps its square, named');

console.log('check-leaguebot-render: ok');
