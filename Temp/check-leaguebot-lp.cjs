/*
 * LEAGUEBOT's LP OVER TIME (Luke, 2026-11-17: "the lp over time graph also seems non functional lets get it working"), offline,
 * from recorded answers (app/lib/leaguebot/fixtures/: U.GG's rank snapshots and OP.GG's daily LP, no Riot IDs in either):
 *   npx tsc app/lib/leaguebot/sources/ugg.ts app/lib/leaguebot/opgg-site.ts app/lib/leaguebot/pick-source.ts app/lib/leaguebot/fallback.ts app/lib/leaguebot/lp-view.ts --rootDir app/lib --outDir Temp/leaguebot-lp-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --resolveJsonModule
 *   node Temp/check-leaguebot-lp.cjs
 *
 * The chart had only OP.GG's app server's few points (4 for a player OP.GG's own site shows 11 days of, U.GG 101 games of),
 * and drew nothing at all under two. Now:
 * - U.GG's snapshot after every game, oldest first, repeats dropped; the server prefers it whenever U.GG answers
 * - OP.GG's point a day, read by the browser when the server has fewer than 5 (U.GG turned it away, or nobody had any)
 * - the caption says who kept the points, how often and how far back; under two points the section stays and says why
 * - from the files: the server asks U.GG for snapshots, the window's fill asks OP.GG, STATS shows the section for any profile
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const out = path.join(__dirname, 'leaguebot-lp-out', 'leaguebot');
const { toUggLpHistory } = require(path.join(out, 'sources', 'ugg.js'));
const { toOpggSiteLpHistory, opggLpHistoryUrl } = require(path.join(out, 'opgg-site.js'));
const { readPlayer } = require(path.join(out, 'pick-source.js'));
const { withBrowserLp, wantsBrowserLp, LP_POINTS_WANTED } = require(path.join(out, 'fallback.js'));
const { lpCaption, lpEmpty } = require(path.join(out, 'lp-view.js'));

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const fixture = (name) => JSON.parse(read(`app/lib/leaguebot/fixtures/${name}`));
const ME = { name: 'Me', tag: 'EUW' };
const EUW = { id: 'EUW', ugg: 'euw1', opgg: 'euw' };

(async () => {
  // --- the two keyless histories ---
  const ugg = toUggLpHistory(fixture('ugg-rank-snapshots.json').data);
  assert.ok(ugg.length >= 90, `U.GG's snapshot after every game (${ugg.length})`);
  for (let i = 1; i < ugg.length; i += 1) assert.ok(ugg[i - 1].at <= ugg[i].at, 'oldest first');
  assert.equal(ugg[ugg.length - 1].tier, 'GRANDMASTER');
  assert.equal(ugg[0].division, 1, 'I read as 1');
  const days = (Date.parse(ugg[ugg.length - 1].at) - Date.parse(ugg[0].at)) / 86400000;
  assert.ok(days > 10, `two weeks of points (${days.toFixed(1)} days)`);
  assert.deepEqual(toUggLpHistory({ getSummonerRankSnapshots: [{ insertedAt: 2, lp: 5, rank: 'II', tier: 'gold' }, { insertedAt: 1, lp: 5, rank: 'II', tier: 'gold' }, { insertedAt: 3, lp: 9, rank: 'II', tier: 'gold' }] }).map((p) => p.lp), [5, 9], 'a repeat says nothing new');
  const opgg = toOpggSiteLpHistory(fixture('opgg-lp-histories.json'));
  assert.equal(opgg.length, 11, "OP.GG's point a day");
  assert.ok(opgg[0].at < opgg[10].at);
  assert.throws(() => opggLpHistoryUrl(EUW, '../x'), /summoner id/);

  // --- the server prefers U.GG's ---
  const few = [
    { at: '2026-11-06T15:11:38.000Z', tier: 'MASTER', division: 1, lp: 1260 },
    { at: '2026-11-16T16:01:46.000Z', tier: 'MASTER', division: 1, lp: 1815 },
  ];
  const profile = { riotId: ME, region: 'EUW', level: 1, iconId: null, ranks: [], lpHistory: few, lpFrom: 'OP.GG', pastSeasons: [] };
  const base = { opggProfile: async () => profile, uggRanks: async () => ({ ranks: [], pastSeasons: [] }), uggMatches: async () => [], opggMatches: async () => [] };
  let answer = await readPlayer(ME, EUW, { ...base, uggLpHistory: async () => ugg });
  assert.equal(answer.profile.lpHistory.length, ugg.length, "U.GG's snapshots replace OP.GG's few");
  assert.equal(answer.profile.lpFrom, 'U.GG');
  answer = await readPlayer(ME, EUW, { ...base, uggLpHistory: () => Promise.reject(Object.assign(new Error('HTTP 403'), { status: 403 })) });
  assert.equal(answer.profile.lpFrom, 'OP.GG', "U.GG turning the server away keeps OP.GG's");
  assert.equal(answer.profile.lpHistory.length, 2);

  // --- the browser fills from OP.GG's point a day ---
  assert.equal(LP_POINTS_WANTED, 5);
  assert.ok(wantsBrowserLp(answer), 'two points: the browser asks');
  const filled = await withBrowserLp(answer, async () => opgg);
  assert.equal(filled.profile.lpHistory.length, 11);
  assert.equal(filled.profile.lpFrom, 'OP.GG');
  let asked = 0;
  const rich = { ...answer, profile: { ...answer.profile, lpHistory: ugg, lpFrom: 'U.GG' } };
  await withBrowserLp(rich, async () => ((asked += 1), opgg));
  assert.equal(asked, 0, "U.GG's history asks nothing more");
  assert.equal((await withBrowserLp(answer, () => Promise.reject(new Error('x')))).profile.lpHistory.length, 2, 'a failing browser look-up keeps what came');
  const none = { ...answer, profile: { ...answer.profile, lpHistory: [], lpFrom: null } };
  assert.equal((await withBrowserLp(none, async () => [])).profile.lpHistory.length, 0, 'nobody has any: still none');
  assert.equal((await withBrowserLp({ ...answer, profile: null }, async () => opgg)).profile, null, 'no profile, nothing to fill');

  // --- the words ---
  assert.match(lpCaption(ugg, 'U.GG'), /^ranked solo, last 1[45] days, a point after every game, from U\.GG$/);
  assert.equal(lpCaption(opgg, 'OP.GG'), 'ranked solo, last 10 days, a point a day, from OP.GG');
  assert.match(lpEmpty([]), /No LP history for this player yet/);
  assert.match(lpEmpty([few[0]]), /Only one LP point so far/);

  // --- from the files ---
  assert.match(read('app/api/leaguebot/player/route.ts'), /uggLpHistory: \(id, region\) => uggLpHistory\(id, region\)/, 'the server asks U.GG for snapshots');
  assert.match(read('app/lib/leaguebot/client.ts'), /withBrowserLp\(games, \(\) => browserOpggLpHistory\(id, region\)\)/, "the window's fill asks OP.GG");
  const stats = read('app/components/LeagueStats.tsx');
  assert.match(stats, /\{profile \? \(\s*<Section title="LP OVER TIME"/, 'the section shows for any profile, empty or not');
  assert.match(stats, /data-leaguebot-lp-empty/);
  assert.ok(!/this season, from OP\.GG/.test(stats), 'no more fixed caption claiming a season of points');

  console.log('check-leaguebot-lp: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
