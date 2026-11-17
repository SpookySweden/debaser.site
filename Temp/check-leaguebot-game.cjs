/*
 * LEAGUEBOT's LIVE and REVIEW tabs (SPEC-leaguebot.md, phases 2 and 3), offline, from made-up and recorded answers.
 *   npx tsc app/lib/leaguebot/sources/live.ts app/lib/leaguebot/sources/review.ts app/lib/leaguebot/sources/opgg-mcp.ts app/lib/leaguebot/live-advice.ts app/lib/leaguebot/review-advice.ts app/lib/leaguebot/pick-source.ts --rootDir app/lib --outDir Temp/leaguebot-game-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --resolveJsonModule
 *   node Temp/check-leaguebot-game.cjs
 *
 * - U.GG's live game: ten players with lanes, ranks, records; U.GG's -1 records read as unknown, never shown as numbers
 * - OP.GG's spectate answer: teams by colour, ranks, the game's length from when it started
 * - the live fallbacks: "not in a game" from U.GG is believed; a broken U.GG falls back to OP.GG; both broken says so
 * - live advice: a one-trick, a first-timer, an off-role player, a duo, the enemy jungler; never a score
 * - the clock: spawn times are patch 26.1's (dragon 5:00, grubs 8:00, herald 15:00, Baron 20:00), and it counts on from
 *   when the source answered
 * - OP.GG's champion spelling (KAISA, NUNU_WILLUMP, TWISTED_FATE, DR_MUNDO) and its matchup guide's shape
 * - a review: you and your lane opponent found by Riot ID, frames by minute, bought items only, skill numbers as letters,
 *   your deaths with who killed you, grubs counted once, objectives by team
 * - review advice: behind at 10 and 15, early deaths, each line with its number
 * - from the files: LIVE asks once a minute and stops while the tab is hidden; it never reads champ select
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const out = path.join(__dirname, 'leaguebot-game-out', 'leaguebot');
const { toUggLive, toOpggLive } = require(path.join(out, 'sources', 'live.js'));
const { toReview } = require(path.join(out, 'sources', 'review.js'));
const { opggChampionWord, toMatchupGuide } = require(path.join(out, 'sources', 'opgg-mcp.js'));
const { findMe, laneOpponentOf, liveAdvice, RIFT_SPAWNS, clockText, gameSeconds } = require(path.join(out, 'live-advice.js'));
const { reviewAdvice } = require(path.join(out, 'review-advice.js'));
const { readLive } = require(path.join(out, 'pick-source.js'));

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const ME = { name: 'Me', tag: 'EUW' };
const name = (id) => `C${id}`;

(async () => {
  // --- U.GG's live game ---
  const part = (over) => ({ championId: 1, riotUserName: 'x', riotTagLine: 'y', currentRole: 'mid', onRole: true, partyNumber: null, summonerSpellA: 4, summonerSpellB: 14, summonerRuneA: 8100, summonerRuneB: 8200, summonerRuneData: [8112, 8139], championWins: 10, championLosses: 5, currentSeasonRankScore: { tier: 'gold', rank: 'ii', lp: 40, wins: 50, losses: 45 }, roleDatas: [{ roleName: 'mid', games: 40, wins: 22 }, { roleName: 'top', games: 5, wins: 2 }], ...over });
  const live = toUggLive({ getLiveGame: { gameLengthSeconds: 300, queueId: 420,
    teamA: [part({ riotUserName: 'Me', riotTagLine: 'EUW', championId: 103 }), part({ championId: 64, currentRole: 'jungle' })],
    teamB: [part({ championId: 517, championWins: 40, championLosses: 10 }), part({ championId: 79, currentRole: 'jungle', championWins: 1, championLosses: 0, onRole: false, roleDatas: [{ roleName: 'top', games: 80, wins: 40 }] }), part({ championId: 222, currentRole: 'adc', partyNumber: 2, championWins: -1, championLosses: -1 }), part({ championId: 412, currentRole: 'supp', partyNumber: 2, currentSeasonRankScore: { tier: 'diamond', rank: 'i', lp: 10 } })] } }, 1000);
  assert.equal(live.players.length, 6);
  assert.equal(live.fetchedAt, 1000);
  const me = findMe(live, { name: 'me', tag: 'euw' });
  assert.equal(me.championId, 103, 'you are found without case');
  assert.equal(me.keystone, 8112);
  assert.deepEqual(me.rank, { tier: 'GOLD', division: 2, lp: 40, wins: 50, losses: 45 });
  assert.equal(laneOpponentOf(live, me).championId, 517);
  const adc = live.players.find((p) => p.championId === 222);
  assert.equal(adc.championGames, null, "U.GG's -1 is unknown, not a number to show");
  assert.equal(adc.lane, 'BOTTOM');
  assert.equal(live.players.find((p) => p.championId === 412).lane, 'SUPPORT');
  assert.equal(toUggLive({ getLiveGame: null }, 0), null);

  // --- live advice ---
  const advice = liveAdvice(live, me, name);
  const keys = advice.map((a) => a.key);
  assert.ok(keys.includes('otp:517'), 'a lane opponent with 50 games on the champion is said');
  assert.ok(keys.includes('new:79'), 'a first-timer is said');
  assert.ok(keys.includes('off:79'), 'an off-role jungler is said');
  assert.ok(keys.includes('duo:2'), 'a duo is said');
  assert.ok(keys.includes('jungle'), 'the enemy jungler is named');
  assert.ok(advice[0].key === 'otp:517', 'your own lane opponent weighs most');
  for (const a of advice) assert.match(a.text, /\d|queued together/, `says its number: ${a.text}`);
  assert.ok(!advice.some((a) => /cooldown|flash is down|summoner.*timer/i.test(a.text)), 'never an enemy cooldown');
  assert.ok(advice.find((a) => a.key === 'jungle').text.includes('jungler'));
  assert.ok(advice.find((a) => a.key === 'otp:517').text.startsWith('Their mid laner'), 'role nouns, not lane words');

  // --- the clock ---
  assert.deepEqual(RIFT_SPAWNS.map((s) => s.at), [300, 480, 900, 1200], 'patch 26.1 spawn times');
  assert.equal(clockText(605), '10:05');
  assert.equal(gameSeconds(live, 1000 + 65_000), 365, 'counts on from when the source answered');

  // --- OP.GG's spectate answer ---
  const spect = toOpggLive({ data: { created_at: '2026-11-17T13:45:15+09:00', queue_id: 420, teams: [{ banned_champions: [1, 2] }, { banned_champions: [3] }],
    participants: [
      { team_key: 'RED', champion_id: 64, position: 'JUNGLE', spells: [11, 4], rune_build: { primary_page_id: 8000, primary_rune_ids: [8010], secondary_page_id: 8300 }, summoner: { game_name: 'Me', tagline: 'EUW', league_stats: [{ game_type: 'SOLORANKED', tier_info: { tier: 'GRANDMASTER', division: 1, lp: 1481 }, win: 10, lose: 9 }] }, most_champion_stat: { id: 64, play: 638, win: 349 } },
      { team_key: 'BLUE', champion_id: 1, position: 'ADC', summoner: { game_name: 'B', tagline: 'X', league_stats: [] }, most_champion_stat: { id: 99, play: 5, win: 1 } },
    ] } }, Date.parse('2026-11-17T04:55:15Z'));
  assert.equal(spect.players[0].team, 200);
  assert.equal(spect.players[0].championGames, 638);
  assert.equal(spect.players[1].championGames, null, "another champion's record is not this one's");
  assert.equal(spect.players[1].lane, 'BOTTOM');
  assert.equal(spect.lengthSec, 600, 'ten minutes since it started');
  assert.deepEqual(spect.bans, [1, 2, 3]);

  // --- live fallbacks ---
  const down = () => Promise.reject(new Error('HTTP 503'));
  let answer = await readLive(ME, {}, { uggLive: async () => null, opggLive: async () => { throw new Error('should not be asked'); } });
  assert.equal(answer.game, null);
  assert.equal(answer.source, 'U.GG', '"not in a game" from U.GG is believed');
  answer = await readLive(ME, {}, { uggLive: down, opggLive: async () => live });
  assert.equal(answer.source, 'OP.GG');
  assert.match(answer.notes[0], /U\.GG didn't answer/);
  answer = await readLive(ME, {}, { uggLive: down, opggLive: down });
  assert.equal(answer.game, null);
  assert.match(answer.notes[0], /Neither/);

  // --- OP.GG's guide ---
  assert.deepEqual(["Kai'Sa", 'Nunu & Willump', 'Twisted Fate', 'Dr. Mundo', 'Wukong', 'Renata Glasc'].map(opggChampionWord), ['KAISA', 'NUNU_WILLUMP', 'TWISTED_FATE', 'DR_MUNDO', 'WUKONG', 'RENATA_GLASC']);
  const guide = toMatchupGuide({ data: { opponent_champion_tip: ' Dodge the E. ', lane_advantage_champion: 'EVEN', lane_solo_kill_advantage_champion: 'Sylas', recommended_play_style: 'defensive',
    summoner_spells: [{ ids: [4, 14] }], starter_items: [{ ids: [1056, 2003] }], core_items: [{ ids: [3118, 4645, 3157] }], boots: [{ ids: [3020] }],
    runes: [{ primary_page_id: 8100, primary_rune_ids: [8112, 8139], secondary_page_id: 8200, secondary_rune_ids: [8210], stat_mod_ids: [5005] }], skills: [{ order: ['Q', 'W', 'E', 'Q', 'X'] }] } }, 'MID', 103, 517);
  assert.equal(guide.tip, 'Dodge the E.');
  assert.deepEqual(guide.core, [3118, 4645, 3157]);
  assert.equal(guide.boots, 3020);
  assert.deepEqual(guide.skills, ['Q', 'W', 'E', 'Q'], 'only Q W E R');
  const recorded = JSON.parse(read('app/lib/leaguebot/fixtures/matchup-guide.json'));
  assert.ok(recorded.core.length === 3 && recorded.skills.length >= 15, 'the recorded guide has a build and a skill order');

  // --- a review ---
  const post = (n, t, champ, team, role, over = {}) => ({ riotUserName: n, riotTagLine: t, championId: champ, teamId: team, role, kills: 1, deaths: 1, assists: 1, cs: 100, jungleCs: 0, gold: 8000, damage: 10000, damageTaken: 9000, visionScore: 10, wardsPlaced: 5, level: 12, items: [1], summonerSpells: [4], keystone: 8112, ...over });
  const frames = (key) => Array.from({ length: 21 }, (_, m) => ({ timestamp: m, youValue: key === 'gold' ? 500 + m * 300 : m * 6, oppValue: key === 'gold' ? 500 + m * 400 : m * 8 }));
  const review = toReview({ match: { winningTeam: 200, matchSummary: { matchDuration: 1500 }, historicalData: {
    goldDifferenceFrames: frames('gold'), csDifferenceFrames: frames('cs'), xpDifferenceFrames: frames('gold'),
    itemPath: [{ itemId: 1056, timestamp: 5000, type: 1 }, { itemId: 3802, timestamp: 600000, type: 1 }, { itemId: 3802, timestamp: 610000, type: 2 }],
    skillPath: [1, 2, 3, 1, 4], runes: [8112], primaryStyle: 8100, subStyle: 8200,
    teamOneOverview: { kills: 10, towerKills: 2, dragonKills: 1 }, teamTwoOverview: { kills: 20, towerKills: 8, dragonKills: 3 },
    postGameData: [post('me', 'euw', 103, 100, 5, { deaths: 9 }), post('Them', 'X', 517, 200, 5), post('Jg', 'Y', 64, 200, 1)],
    timelineData: [
      { eventType: 'champion_kill', timestamp: 200000, riotUserName: 'Them', riotTagLine: 'X', victimRiotUserName: 'Me', victimRiotTagLine: 'EUW' },
      { eventType: 'champion_kill', timestamp: 400000, riotUserName: 'Jg', riotTagLine: 'Y', victimRiotUserName: 'Me', victimRiotTagLine: 'EUW' },
      { eventType: 'champion_kill', timestamp: 700000, riotUserName: 'Me', riotTagLine: 'EUW', victimRiotUserName: 'Them', victimRiotTagLine: 'X' },
      { eventType: 'monster_kill', timestamp: 480000, riotUserName: 'Jg', riotTagLine: 'Y', monsterType: 'horde' },
      { eventType: 'monster_kill', timestamp: 485000, riotUserName: 'Jg', riotTagLine: 'Y', monsterType: 'horde' },
      { eventType: 'monster_kill', timestamp: 1300000, riotUserName: 'Me', riotTagLine: 'EUW', monsterType: 'baron_nashor' },
      { eventType: 'ward_placed', timestamp: 100000, riotUserName: 'Me', riotTagLine: 'EUW' },
    ] } } }, ME, '42');
  assert.equal(review.me.championId, 103);
  assert.equal(review.opponent.championId, 517);
  assert.equal(review.win, false);
  assert.equal(review.durationSec, 1500);
  assert.deepEqual(review.frames[10].cs, [60, 80]);
  assert.deepEqual(review.buys.map((b) => b.itemId), [1056, 3802], 'bought items only, not sold ones');
  assert.deepEqual(review.skills, ['Q', 'W', 'E', 'Q', 'R']);
  assert.deepEqual(review.events.map((e) => e.kind), ['death', 'death', 'grubs', 'kill', 'baron'], 'grubs counted once, in time order');
  assert.equal(review.events[1].championId, 64, 'who killed you');
  assert.equal(review.events[4].team, 100);
  assert.equal(review.wardsPlaced, 1);
  assert.equal(toReview({ match: null }, ME, '1'), null);

  // --- review advice ---
  const lines = reviewAdvice(review, name, null);
  const lk = lines.map((l) => l.key);
  assert.ok(lk.includes('cs10'), '20 CS behind at 10 is said');
  assert.ok(lk.includes('gold15'), '1,500 gold behind at 15 is said');
  assert.ok(lk.includes('early'), 'two deaths before 10:00 are said');
  assert.ok(lk.includes('deaths'), 'nine deaths are said');
  assert.ok(lines.length <= 5);
  for (const l of lines) assert.match(l.text, /\d/);
  assert.match(lines.find((l) => l.key === 'early').text, /3:20 to C517/);

  // --- from the files ---
  const liveTab = read('app/components/LeagueLive.tsx');
  assert.match(liveTab, /WAITING_EVERY_MS = 60_000/, 'asks once a minute while waiting');
  assert.match(liveTab, /if \(!visible\) return;/, 'stops while the tab is hidden');
  assert.ok(!/liveGameChampSelect|champSelect/.test(read('app/lib/leaguebot/sources/live.ts')), 'never reads champ select');
  assert.match(read('app/components/LeagueBot.tsx'), /tab: 'review', label: 'REVIEW'/);

  console.log('check-leaguebot-game: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
