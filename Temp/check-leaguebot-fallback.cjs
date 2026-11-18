/*
 * LEAGUEBOT when U.GG turns the server away (the live site, 2026-11-17: "! U.GG didn't answer: the last 20 games from OP.GG
 * instead of 100."), offline:
 *   npx tsc app/lib/leaguebot/fallback.ts app/lib/leaguebot/opgg-site.ts app/lib/leaguebot/pick-source.ts --rootDir app/lib --outDir Temp/leaguebot-fallback-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --resolveJsonModule
 *   node Temp/check-leaguebot-fallback.cjs
 *
 * - the server keeps why U.GG failed (`HTTP 403`, `timed out`) and says it plainly: "Only your last 20 games: U.GG isn't
 *   answering LEAGUEBOT's server right now." (never "didn't answer: ... instead of 100")
 * - the window then reads the 100 games from OP.GG itself: the list is replaced, the "only 20" line goes; if that fails
 *   too the server's 20 and its line stand; U.GG answering, or nobody by that name, asks nothing more
 * - the live game: the browser asks OP.GG when the server's answer didn't come from U.GG; "not in a game" from U.GG is believed
 * - OP.GG's site answers shape into games (remakes out, vision and kill share kept, the player found without case) and the
 *   addresses take only a known server, an encoded Riot ID and OP.GG's own summoner id
 * - from the files: the window's look-ups go through the fallback, and the browser's reader never imports server fetching code
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const out = path.join(__dirname, 'leaguebot-fallback-out', 'leaguebot');
const { withBrowserHistory, withBrowserLive, ONLY_SOME_GAMES, LIVE_FROM_BROWSER } = require(path.join(out, 'fallback.js'));
const { toOpggSiteMatches, opggGamesUrl, opggSummonerUrl, opggSpectateUrl, summonerIdOf } = require(path.join(out, 'opgg-site.js'));
const { readPlayer, readLive, troubleOf } = require(path.join(out, 'pick-source.js'));

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const ME = { name: 'Me', tag: 'EUW' };
const EUW = { id: 'EUW', ugg: 'euw1', opgg: 'euw' };
const game = (i) => ({ id: `g${i}`, at: 1000 - i, durationSec: 1800, win: i % 2 === 0, championId: 1, lane: 'MID', kills: 1, deaths: 1, assists: 1, cs: 100, gold: 5000, damage: 1000, vision: 10, killParticipation: 50, items: [], spells: [], runes: [], primaryStyle: null, subStyle: null, team: 100, players: [], version: '' });
const twenty = Array.from({ length: 20 }, (_, i) => game(i));
const hundred = Array.from({ length: 100 }, (_, i) => game(i));
const refused = Object.assign(new Error('HTTP 403'), { name: 'SafeFetchError', status: 403 });

(async () => {
  // --- the server says why, plainly ---
  assert.equal(troubleOf(refused), 'HTTP 403');
  assert.equal(troubleOf(new Error('timed out')), 'timed out');
  const profile = { riotId: ME, region: 'EUW', level: 1, iconId: null, ranks: [], lpHistory: [], pastSeasons: [] };
  const served = await readPlayer(ME, EUW, { opggProfile: async () => profile, uggRanks: async () => ({ ranks: [], pastSeasons: [] }), uggMatches: () => Promise.reject(refused), opggMatches: async () => twenty });
  assert.equal(served.uggTrouble, 'HTTP 403', 'the server keeps what U.GG said');
  assert.equal(served.matchesSource, 'OP.GG');
  assert.deepEqual(served.notes, ["Only your last 20 games: U.GG isn't answering LEAGUEBOT's server right now."]);
  assert.ok(!served.notes.some((n) => /didn't answer: the last 20 games/.test(n)), 'the old wording is gone');
  const fine = await readPlayer(ME, EUW, { opggProfile: async () => profile, uggRanks: async () => ({ ranks: [], pastSeasons: [] }), uggMatches: async () => hundred, opggMatches: async () => twenty });
  assert.equal(fine.uggTrouble, null);

  // --- the browser fills in the 100 ---
  let asked = 0;
  const filled = await withBrowserHistory(served, async () => {
    asked += 1;
    return hundred;
  });
  assert.equal(asked, 1);
  assert.equal(filled.matches.length, 100, 'the 100 games from OP.GG');
  assert.equal(filled.matchesSource, 'OP.GG');
  assert.ok(!filled.notes.some((n) => n.startsWith(ONLY_SOME_GAMES)), 'the "only 20" line goes');
  const failed = await withBrowserHistory(served, () => Promise.reject(new Error('HTTP 429')));
  assert.equal(failed.matches.length, 20, "the browser's look-up failing too leaves the server's 20");
  assert.ok(failed.notes.some((n) => n.startsWith(ONLY_SOME_GAMES)), 'and its line');
  asked = 0;
  await withBrowserHistory(fine, async () => ((asked += 1), hundred));
  await withBrowserHistory({ ...served, notFound: true }, async () => ((asked += 1), hundred));
  assert.equal(asked, 0, 'U.GG answering, or nobody by that name, asks nothing more');
  const fewer = await withBrowserHistory(served, async () => twenty.slice(0, 5));
  assert.equal(fewer.matches.length, 20, 'never fewer games than the server had');

  // --- the live game ---
  const liveGame = { queueId: 420, lengthSec: 60, fetchedAt: 0, players: [], bans: [] };
  const serverLive = await readLive(ME, EUW, { uggLive: () => Promise.reject(refused), opggLive: async () => null });
  assert.equal(serverLive.uggTrouble, 'HTTP 403');
  let browserLive = await withBrowserLive(serverLive, async () => liveGame);
  assert.equal(browserLive.game, liveGame, "the browser's OP.GG answer is used");
  assert.deepEqual(browserLive.notes, [LIVE_FROM_BROWSER]);
  browserLive = await withBrowserLive(serverLive, async () => null);
  assert.equal(browserLive.game, null);
  assert.deepEqual(browserLive.notes, [], 'not in a game says nothing extra');
  // (2026-11-18) Updated on purpose: the server asks OP.GG itself when U.GG says "not in a game" (check-leaguebot-game), so
  // the browser has nothing more to ask when U.GG answered at all.
  const seenByOpgg = await readLive(ME, EUW, { uggLive: async () => null, opggLive: async () => liveGame });
  assert.equal(seenByOpgg.game, liveGame, "the server shows OP.GG's game when U.GG hasn't seen it yet");
  asked = 0;
  await withBrowserLive(seenByOpgg, async () => ((asked += 1), liveGame));
  assert.equal(asked, 0, 'U.GG answered: the browser asks nothing more');
  assert.equal((await withBrowserLive(serverLive, () => Promise.reject(new Error('x')))).source, serverLive.source, 'a failing browser look-up leaves the server answer');

  // --- OP.GG's site shapes ---
  const page = {
    data: [
      { id: 'a', created_at: '2026-11-16T10:00:00+09:00', game_length_second: 1500, is_remake: false,
        participants: [
          { champion_id: 103, team_key: 'BLUE', position: 'MID', items: [3118, 0], spells: [4, 14], rune: { primary_page_id: 8100, primary_rune_id: 8112, secondary_page_id: 8200 }, summoner: { game_name: 'me', tagline: 'euw' }, stats: { kill: 4, death: 2, assist: 6, minion_kill: 180, neutral_minion_kill: 12, gold_earned: 11000, total_damage_dealt_to_champions: 20000, vision_score: 22, result: 'WIN' } },
          { champion_id: 7, team_key: 'RED', position: 'MID', summoner: { game_name: 'Them', tagline: 'X' }, stats: {} },
        ],
        teams: [{ key: 'BLUE', game_stat: { champion_kill: 20 } }, { key: 'RED', game_stat: { champion_kill: 9 } }] },
      { id: 'b', created_at: '2026-11-16T09:00:00+09:00', game_length_second: 200, is_remake: true, participants: [], teams: [] },
    ],
  };
  const shaped = toOpggSiteMatches(page, ME);
  assert.equal(shaped.length, 1, 'remakes out');
  assert.equal(shaped[0].cs, 192);
  assert.equal(shaped[0].vision, 22, "OP.GG's site gives vision");
  assert.equal(shaped[0].killParticipation, 50);
  assert.deepEqual(shaped[0].items, [3118], 'empty slots out');
  assert.equal(shaped[0].players[1].lane, 'MID');
  assert.equal(summonerIdOf({ data: [{ summoner_id: '3fnG7E3JTjXuKozDZ1yO2edDCFH4pO2SRLUsqSzzqJikQP_zACkNngydxw' }] }), '3fnG7E3JTjXuKozDZ1yO2edDCFH4pO2SRLUsqSzzqJikQP_zACkNngydxw');
  assert.equal(summonerIdOf({ data: [{ summoner_id: '../../etc' }] }), null);
  assert.throws(() => opggGamesUrl(EUW, '../x'), /summoner id/);
  assert.throws(() => opggSpectateUrl(EUW, 'a b'), /summoner id/);
  assert.match(opggSummonerUrl(EUW, { name: 'A 99 mid', tag: 'EUW' }), /riot_id=A%2099%20mid%23EUW/);
  assert.match(opggGamesUrl(EUW, 'abcdefghijkl', '2026-11-16T09:00:00+09:00'), /ended_at=2026-11-16T09%3A00%3A00%2B09%3A00/);
  assert.ok(!opggGamesUrl(EUW, 'abcdefghijkl', 'nonsense').includes('ended_at'), 'a bad page edge is left out');

  // --- from the files ---
  const client = read('app/lib/leaguebot/client.ts');
  assert.match(client, /withBrowserHistory\(answer, \(\) => browserOpggHistory\(id, region\)\)/, "the window's game list goes through the fallback");
  assert.match(client, /withBrowserLive\(answer, \(\) => browserOpggLive\(id, region\)\)/, "the window's live game goes through the fallback");
  assert.ok(!/safe-fetch|sources\//.test(read('app/lib/leaguebot/browser-opgg.ts')), "the browser's reader never imports server fetching code");
  const windowCode = read('app/components/LeagueBot.tsx');
  // (2026-11-17) The fill covers LP over time too now (check-leaguebot-lp.cjs), so the window asks wantsBrowserFill.
  assert.match(windowCode, /if \(wantsBrowserFill\(answer\)\)/, 'the window fills in when U.GG turned the server away');
  assert.match(windowCode, /setLooked\(\{ id, region: where, answer \}\);[\s\S]{0,250}wantsBrowserFill/, 'the server answer shows first, the 100 come after');
  assert.match(windowCode, /READING YOUR LAST 100 GAMES FROM OP\.GG/, 'and says so while it reads');

  console.log('check-leaguebot-fallback: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
