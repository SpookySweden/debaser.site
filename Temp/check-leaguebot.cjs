/*
 * LEAGUEBOT (SPEC-leaguebot.md, Luke 2026-11-17): the sources' shaping, the fallbacks, the stats, the advice rules, the
 * memory keeper and the Riot ID rules, offline, from recorded answers (app/lib/leaguebot/fixtures/, every name renamed).
 *   npx tsc app/lib/leaguebot/opgg-decode.ts app/lib/leaguebot/sources/opgg-mcp.ts app/lib/leaguebot/sources/ugg.ts app/lib/leaguebot/stats.ts app/lib/leaguebot/advice.ts app/lib/leaguebot/cache.ts app/lib/leaguebot/pick-source.ts app/lib/leaguebot/riot-id.ts app/lib/leaguebot/ladder.ts app/lib/leaguebot/regions.ts --rootDir app/lib --outDir Temp/leaguebot-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --resolveJsonModule
 *   node Temp/check-leaguebot.cjs
 *
 * - OP.GG's compact class text decodes into the profile: rank, wins, losses, streak, LP history oldest first, past seasons
 * - U.GG's summary row becomes a match with CS counting jungle monsters, the right team, lane numbers read right
 * - the fallbacks: OP.GG down -> rank from U.GG with a note; U.GG down -> 20 games from OP.GG with a note; nobody -> not found
 * - stats: win rate, KDA (deaths at least 1), CS a minute, remakes under 5 minutes left out, lane opponents, after two losses
 *   (a fresh sitting resets the run), the last 20 against the rest
 * - advice: each rule speaks only with enough games, says its number, and the window gets at most five, weightiest first
 * - the keeper: a kept answer costs nothing; a failure, or an answer that only says the sources broke, is not kept; a
 *   failed refresh leaves the good answer; the per-minute limit; a refresh at most every 2 minutes
 * - Riot IDs: Name#TAG, Name-TAG and spaces read; nonsense refused
 * - from the files: no source is fetched from a browser file; no score or rating of a player is shown (no threatLevel, op_score)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const out = path.join(__dirname, 'leaguebot-out', 'leaguebot');
const { decodeOpggText } = require(path.join(out, 'opgg-decode.js'));
const { toProfile, toOpggMatches } = require(path.join(out, 'sources', 'opgg-mcp.js'));
const { toMatchSummary, uggLane } = require(path.join(out, 'sources', 'ugg.js'));
const { readPlayer } = require(path.join(out, 'pick-source.js'));
const { computeStats, line } = require(path.join(out, 'stats.js'));
const { statsAdvice } = require(path.join(out, 'advice.js'));
const { createKeeper, LOOKUPS_PER_MINUTE } = require(path.join(out, 'cache.js'));
const { parseRiotId, riotIdFrom } = require(path.join(out, 'riot-id.js'));
const { ladderValue, ladderText } = require(path.join(out, 'ladder.js'));
const { regionById } = require(path.join(out, 'regions.js'));

const root = path.join(__dirname, '..');
const fixtures = path.join(root, 'app', 'lib', 'leaguebot', 'fixtures');
const EUW = regionById('EUW');
const ME = { name: 'MOCK PLAYER', tag: 'EUW' };

(async () => {
  // --- OP.GG's class text ---
  const decoded = decodeOpggText(fs.readFileSync(path.join(fixtures, 'opgg-profile.txt'), 'utf8'));
  const profile = toProfile(decoded, ME, EUW);
  const solo = profile.ranks.find((r) => r.queue === 'SOLO');
  assert.deepEqual(solo, { queue: 'SOLO', tier: 'GRANDMASTER', division: 1, lp: 1837, wins: 1149, losses: 1084, hotStreak: true });
  assert.equal(profile.ranks.find((r) => r.queue === 'FLEX').tier, null, 'an unranked queue keeps a null tier');
  assert.equal(profile.iconId, 6621);
  assert.equal(profile.level, 619);
  assert.equal(profile.lpHistory.length, 4);
  assert.ok(profile.lpHistory[0].at < profile.lpHistory[3].at, 'LP history oldest first');
  assert.deepEqual(profile.pastSeasons.map((s) => s.season), [31, 29, 27, 25], 'past seasons newest first');
  assert.deepEqual(decodeOpggText('A(1,"x",[B(true),null])\n'.replace(/^/, 'class A: n,s,l\nclass B: ok\n\n')), { n: 1, s: 'x', l: [{ ok: true }, null] });
  assert.deepEqual(decodeOpggText('{"a":1}'), { a: 1 }, 'a JSON answer passes through');
  assert.throws(() => decodeOpggText('class A: x\n\nZ(1)'), /unknown class/);

  // --- U.GG's row ---
  const row = {
    matchId: 1, matchCreationTime: 1000, matchDuration: 1800, version: '16_22', win: true, championId: 103, role: 5, kills: 7, deaths: 0, assists: 5,
    cs: 200, jungleCs: 12, gold: 11000, damage: 20000, visionScore: 20, killParticipation: 50, items: [1, 2], summonerSpells: [4, 12], runes: [8112], primaryStyle: 8100, subStyle: 8200,
    teamA: [{ championId: 30, riotUserName: 'Other', riotTagLine: 'X', role: 5, teamId: 100 }],
    teamB: [{ championId: 103, riotUserName: 'mock player', riotTagLine: 'euw', role: 5, teamId: 200 }],
  };
  const match = toMatchSummary(row, ME);
  assert.equal(match.cs, 212, 'CS counts jungle monsters too');
  assert.equal(match.team, 200, 'the team is found by Riot ID, without case');
  assert.equal(match.lane, 'MID');
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(uggLane), ['JUNGLE', 'SUPPORT', 'BOTTOM', 'TOP', 'MID', null]);

  // --- OP.GG's fallback history ---
  const opggHistory = toOpggMatches(
    { data: { game_history: [
      { id: 'g1', created_at: '2026-11-16T10:00:00+09:00', game_length_second: 1500, game_type: 'SOLORANKED',
        participants: [
          { champion_id: 103, position: 'MID', team_key: 'BLUE', items: [1], spells: [4], summoner: { game_name: 'MOCK PLAYER', tagline: 'EUW' }, rune: { primary_page_id: 8100, primary_rune_id: 8112, secondary_page_id: 8200 }, stats: { kill: 3, death: 2, assist: 7, minion_kill: 150, neutral_minion_kill: 10, gold_earned: 9000, total_damage_dealt_to_champions: 15000, result: 'WIN' } },
          { champion_id: 30, position: 'MID', team_key: 'RED', summoner: { game_name: 'Them', tagline: 'X' }, stats: {} },
        ],
        teams: [{ key: 'BLUE', game_stat: { champion_kill: 20 } }, { key: 'RED', game_stat: { champion_kill: 10 } }] },
      { id: 'g2', game_type: 'ARAM', participants: [] },
    ] } },
    ME,
  );
  assert.equal(opggHistory.length, 1, 'ranked solo only');
  assert.equal(opggHistory[0].killParticipation, 50);
  assert.equal(opggHistory[0].vision, null, "OP.GG's history has no vision score: null, never 0");
  assert.equal(opggHistory[0].cs, 160);

  // --- fallbacks ---
  const matches = JSON.parse(fs.readFileSync(path.join(fixtures, 'player-matches.json'), 'utf8'));
  const down = () => Promise.reject(new Error('HTTP 503'));
  const missing = () => { const e = new Error('not found'); e.name = 'OpggNotFound'; return Promise.reject(e); };
  const ok = {
    opggProfile: async () => profile,
    uggRanks: async () => ({ ranks: [solo], pastSeasons: [] }),
    uggMatches: async () => matches,
    opggMatches: async () => matches.slice(0, 20),
  };
  let answer = await readPlayer(ME, EUW, ok);
  assert.equal(answer.profileSource, 'OP.GG');
  assert.equal(answer.matchesSource, 'U.GG');
  assert.equal(answer.matches.length, 100);
  assert.deepEqual(answer.notes, []);
  answer = await readPlayer(ME, EUW, { ...ok, opggProfile: down });
  assert.equal(answer.profileSource, 'U.GG', 'OP.GG down: the rank comes from U.GG');
  assert.equal(answer.profile.lpHistory.length, 0);
  assert.match(answer.notes.join(' '), /OP\.GG didn't answer/);
  answer = await readPlayer(ME, EUW, { ...ok, uggMatches: down });
  assert.equal(answer.matchesSource, 'OP.GG', 'U.GG down: the games come from OP.GG');
  assert.equal(answer.matches.length, 20);
  assert.match(answer.notes.join(' '), /last 20 games from OP\.GG/);
  answer = await readPlayer(ME, EUW, { opggProfile: missing, uggRanks: async () => ({ ranks: [], pastSeasons: [] }), uggMatches: async () => [], opggMatches: missing });
  assert.equal(answer.notFound, true, 'nobody by that name');
  answer = await readPlayer(ME, EUW, { opggProfile: down, uggRanks: down, uggMatches: down, opggMatches: down });
  assert.equal(answer.notFound, false, 'everything broken is not "not found"');
  assert.equal(answer.notes.length, 2);

  // --- stats ---
  const g = (fields) => ({ id: String(Math.random()), version: '', at: 0, durationSec: 1800, win: true, championId: 1, lane: 'MID', kills: 0, deaths: 0, assists: 0, cs: 0, gold: 0, damage: 0, vision: null, killParticipation: null, items: [], spells: [], runes: [], primaryStyle: null, subStyle: null, team: 100, players: [], ...fields });
  const l = line([g({ kills: 5, deaths: 0, assists: 5, cs: 240, gold: 12000 }), g({ win: false, kills: 1, deaths: 4, assists: 1, cs: 180, gold: 9000, vision: 30 })]);
  assert.equal(l.winRate, 0.5);
  assert.equal(l.kda, 3, '(6 + 6) / 4');
  assert.equal(l.csPerMin, 7, '420 CS in 60 minutes');
  assert.equal(l.visionPerMin, 1, 'vision a minute counts only games that have it');
  assert.equal(line([g({ kills: 3, deaths: 0, assists: 0 })]).kda, 3, 'no deaths counts as one');
  const H = 60 * 60 * 1000;
  // Oldest to newest: L L W (after two) L L L (after two) ... then a fresh sitting
  const run = [false, false, true, false, false, false].map((win, i) => g({ win, at: i * 40 * 60 * 1000 }));
  const fresh = g({ win: true, at: 6 * 40 * 60 * 1000 + 5 * H });
  const st = computeStats([...run, fresh, g({ durationSec: 200, at: 1 })]);
  assert.equal(st.all.games, 7, 'a remake (under 5 minutes) is left out');
  assert.equal(st.afterTwoLosses.games, 2, 'the win after two losses and the third loss; the next day starts fresh');
  assert.equal(st.afterTwoLosses.wins, 1);
  const opp = (championId, win) => g({ win, lane: 'TOP', team: 100, players: [{ championId: 9, name: 'a', tag: 'b', lane: 'TOP', team: 100 }, { championId, name: 'c', tag: 'd', lane: 'TOP', team: 200 }] });
  const vs = computeStats([opp(55, false), opp(55, false), opp(55, true), opp(66, true), opp(66, true), opp(77, false)]);
  assert.deepEqual(vs.opponents.map((o) => [o.championId, o.wins, o.games]), [[55, 1, 3], [66, 2, 2]], 'met twice or more, hardest first');
  const full = computeStats(matches);
  assert.equal(full.recent.games, 20);
  assert.ok(full.before.games >= 70);

  // --- advice ---
  const name = (id) => `CHAMP${id}`;
  const lines = statsAdvice(full, name);
  assert.ok(lines.length > 0 && lines.length <= 5, 'at most five lines');
  for (let i = 1; i < lines.length; i += 1) assert.ok(lines[i - 1].weight >= lines[i].weight, 'weightiest first');
  for (const each of lines) assert.match(each.text, /\d/, `every line says its number: ${each.text}`);
  assert.deepEqual(statsAdvice(computeStats([g({}), g({})]), name), [], 'two games say nothing');
  const tilted = [];
  for (let i = 0; i < 40; i += 1) tilted.push(g({ at: i * 35 * 60 * 1000, win: i % 8 < 4 }));
  const tiltLines = statsAdvice(computeStats(tilted), name);
  assert.ok(tiltLines.some((x) => x.key === 'tilt'), 'losing after two losses is said');
  const fewChamps = statsAdvice(computeStats(Array.from({ length: 4 }, (_, i) => g({ championId: 5, win: false, at: i }))), name);
  assert.ok(!fewChamps.some((x) => x.key.startsWith('worst')), 'a champion needs five games before it is called weak');
  const spread = Array.from({ length: 20 }, (_, i) => g({ championId: i, at: i * H * 4 }));
  assert.ok(statsAdvice(computeStats(spread), name).some((x) => x.key === 'pool'), 'twenty champions in twenty games is said');

  // --- keeper ---
  let now = 0;
  const keeper = createKeeper(() => now);
  let made = 0;
  const make = async () => { made += 1; return made; };
  assert.equal(await keeper.get('a', 1000, make), 1);
  assert.equal(await keeper.get('a', 1000, make), 1, 'kept');
  assert.ok(keeper.has('a'));
  now = 1001;
  assert.equal(await keeper.get('a', 1000, make), 2, 'gone after its time');
  assert.equal(await keeper.get('a', 1000, make, true), 3, 'a refresh asks again');
  await keeper.get('b', 1000, () => Promise.reject(new Error('x'))).catch(() => null);
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(!keeper.has('b'), 'a failure is not kept');
  await keeper.get('c', 1000, async () => ({ broken: true }), false, (v) => !v.broken);
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(!keeper.has('c'), 'an answer that only says the sources broke is not kept');
  await keeper.get('d', 1000, async () => 'good');
  await keeper.get('d', 1000, () => Promise.reject(new Error('flaky')), true).catch(() => null);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(await keeper.get('d', 1000, async () => 'asked again'), 'good', 'a failed refresh leaves the good answer in place');
  for (let i = 0; i < LOOKUPS_PER_MINUTE; i += 1) assert.ok(keeper.allow('v'));
  assert.equal(keeper.allow('v'), false, 'the per-minute limit');
  assert.ok(keeper.allow('w'), 'another visitor is untouched');
  now += 61_000;
  assert.ok(keeper.allow('v'), 'a minute later it opens again');
  assert.ok(keeper.mayRefresh('p'));
  assert.equal(keeper.mayRefresh('p'), false, 'one refresh per two minutes');
  now += 121_000;
  assert.ok(keeper.mayRefresh('p'));

  // --- Riot IDs and the ladder ---
  assert.deepEqual(parseRiotId('Posty#Herta'), { name: 'Posty', tag: 'Herta' });
  assert.deepEqual(parseRiotId('  A 99 mid laner #EUW '), { name: 'A 99 mid laner', tag: 'EUW' });
  assert.deepEqual(parseRiotId('Faker-KR1'), { name: 'Faker', tag: 'KR1' });
  assert.deepEqual(parseRiotId('강인할 기#氣魄'), { name: '강인할 기', tag: '氣魄' });
  for (const bad of ['', 'NoTag', '#TAG', 'Name#', 'Name#T', 'a<script>#EUW', 'Name#TOOLONG', null]) assert.equal(parseRiotId(bad), null, `refused: ${bad}`);
  assert.equal(riotIdFrom('x'.repeat(17), 'EUW'), null);
  assert.equal(ladderValue('GOLD', 2, 40), 3 * 400 + 200 + 40);
  assert.equal(ladderText(ladderValue('GOLD', 2, 40)), 'GOLD II 40 LP');
  assert.ok(ladderValue('MASTER', 1, 10) > ladderValue('DIAMOND', 1, 99));
  assert.ok(ladderValue('GRANDMASTER', 1, 900) > ladderValue('MASTER', 1, 800));

  // --- from the files ---
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  for (const file of ['app/components/LeagueBot.tsx', 'app/components/LeagueStats.tsx', 'app/lib/leaguebot/client.ts', 'app/lib/leaguebot/static-data.ts']) {
    const text = read(file);
    assert.ok(!/sources\/(ugg|opgg)|safe-fetch/.test(text), `${file}: the browser never imports the server's fetching code`);
  }
  for (const file of fs.readdirSync(path.join(root, 'app/components')).filter((f) => f.startsWith('League'))) {
    assert.ok(!/threatLevel|op_score|opScore|threat/i.test(read(`app/components/${file}`)), `${file}: no score of a player is shown`);
  }
  assert.match(read('app/lib/ui/modules.ts'), /key: 'leaguebot'[^\n]*startsOn: false[^\n]*wip: true/, 'LEAGUEBOT is off until ticked, WIP');
  assert.match(read('app/components/DesktopSidebar.tsx'), /href="\/leaguebot"/, 'the shelf key');
  assert.match(read('app/components/LeagueBot.tsx'), /isn&apos;t endorsed by Riot Games/, "Riot's notice");
  assert.ok(!/Posty|Herta/.test(fs.readdirSync(fixtures).map((f) => fs.readFileSync(path.join(fixtures, f), 'utf8')).join('')), 'fixtures carry no real Riot ID');
  const sql = read('supabase/migrations/20261117060000_user_league.sql');
  assert.match(sql, /enable row level security/);
  assert.ok(!/to anon|grant[^;]*anon/i.test(sql.replace(/revoke all[^;]*;/g, '')), 'no grant to visitors');
  for (const word of ['readable', 'addable', 'changeable', 'deletable']) assert.match(sql, new RegExp(`own league ${word}[\\s\\S]*?person = auth\\.uid\\(\\)`), `owner only: ${word}`);

  console.log('check-leaguebot: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
