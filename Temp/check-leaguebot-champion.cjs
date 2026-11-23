/*
 * LEAGUEBOT LIVE's CHAMPION panel (SPEC-leaguebot-live-champs.md), offline, from Riot's recorded files and made-up games.
 *   npx tsc app/lib/leaguebot/champion-kit.ts app/lib/leaguebot/player-champ.ts app/lib/leaguebot/notes-store.ts app/lib/leaguebot/advice-notes.ts --rootDir app/lib --outDir Temp/leaguebot-champion-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --resolveJsonModule
 *   node Temp/check-leaguebot-champion.cjs
 *
 * - the kit: Data Dragon's per-champion file (Evelynn, Leona, recorded) as passive + Q W E R with Riot's icons, plain-text
 *   descriptions, cooldowns at every rank, and the crowd control Riot's text names (Allure charms; Leona's Q stuns, E roots)
 * - the player on one champion: only that champion's games, the newest 20, form, short against long, finished items by
 *   share with boots apart, keystone, spell pairs
 * - the rules about the player: whose good news it is depends on the side; a small sample says so; never a score
 * - the kept notes: your note about the picked champion, an ally note from either side, CC only once that champion's own
 *   parts are written, a file name that isn't an alias refused
 * - the batch's checks (scripts/leaguebot-advice-batch.mjs): a missing opponent, a time in seconds, too few lines
 * - from the files: the rows are keys with aria-pressed, the panel renders text never HTML, the advice route checks aliases
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const out = path.join(__dirname, 'leaguebot-champion-out', 'leaguebot');
const { buildChampionKit, ccIn, perRank, plainText } = require(path.join(out, 'champion-kit.js'));
const { summarisePlayerChamp, playerChampAdvice, CHAMPION_GAMES } = require(path.join(out, 'player-champ.js'));
const { pairFrom, readChampionNotes } = require(path.join(out, 'notes-store.js'));
const { isChampionAlias, modelWords } = require(path.join(out, 'advice-notes.js'));

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const fixture = (name) => JSON.parse(read(`app/lib/leaguebot/fixtures/${name}`));

(async () => {
  // --- the kit ---
  const eve = buildChampionKit('16.23.1', fixture('ddragon-evelynn.json'));
  assert.equal(eve.alias, 'Evelynn');
  assert.equal(eve.id, 28);
  assert.deepEqual(eve.abilities.map((a) => a.key), ['P', 'Q', 'W', 'E', 'R']);
  for (const a of eve.abilities) {
    assert.match(a.icon, /^https:\/\/ddragon\.leagueoflegends\.com\/cdn\/16\.23\.1\/img\/(passive|spell)\/.+\.png$/, `${a.key} icon from Riot's server`);
    assert.ok(!/[<>{}]/.test(a.description), `${a.key} description is plain text`);
    assert.ok(a.description.length > 20, `${a.key} has a description`);
  }
  const allure = eve.abilities.find((a) => a.key === 'W');
  assert.ok(allure.cc.includes('charm'), 'Allure charms');
  assert.equal(eve.abilities.find((a) => a.key === 'Q').cooldowns.length, 5, 'Q has five ranks of cooldown');
  assert.equal(eve.abilities.find((a) => a.key === 'R').cooldowns.length, 3, 'R has three');
  assert.deepEqual(eve.abilities.find((a) => a.key === 'P').cooldowns, [], 'no passive cooldown');

  const leona = buildChampionKit('16.23.1', fixture('ddragon-leona.json'));
  assert.ok(leona.abilities.find((a) => a.key === 'Q').cc.includes('stun'), "Leona's Q stuns");
  assert.ok(leona.abilities.find((a) => a.key === 'E').cc.includes('root'), "Leona's E roots");
  assert.ok(leona.abilities.find((a) => a.key === 'R').cc.length > 0, "Leona's R crowd-controls");
  assert.deepEqual(leona.abilities.find((a) => a.key === 'W').cc, [], "Leona's W has no CC");

  assert.deepEqual(ccIn('Knocks them up. Then knocks enemies back.'), ['knock-up', 'knockback']);
  assert.deepEqual(ccIn('Gains a shield and bonus armor.'), []);
  assert.equal(plainText('Deals <magicDamage>{{ e1 }} magic damage</magicDamage>&nbsp;and stuns.<br>Next'), 'Deals magic damage and stuns. Next');
  assert.equal(perRank([5, 5, 5, 5, 5]), '5');
  assert.equal(perRank([14, 13, 12]), '14 / 13 / 12');
  assert.equal(buildChampionKit('16.23.1', { data: {} }), null);

  // --- the player on one champion ---
  const game = (i, over) => ({ id: `g${i}`, version: '16_23', at: 1_000_000 - i * 1000, durationSec: 1800, win: true, championId: 28, lane: 'JUNGLE', kills: 8, deaths: 8, assists: 6, cs: 180, gold: 12000, damage: 24000, vision: 15, killParticipation: 70, items: [3020, 4645, 3157, 2055, 1001, 0, 3364], spells: [11, 4], runes: [8112, 8139], primaryStyle: 8100, subStyle: 8200, team: 100, players: [], ...over });
  const matches = [];
  for (let i = 0; i < 24; i += 1) matches.push(game(i, { win: i % 3 !== 0, durationSec: i % 2 === 0 ? 1200 : 2100, spells: i === 5 ? [4, 11] : [11, 4] }));
  matches.push(game(99, { championId: 103 }));
  const items = (id) => ({ 3020: { completed: true, boots: true }, 4645: { completed: true, boots: false }, 3157: { completed: true, boots: false }, 2055: { completed: false, boots: false }, 1001: { completed: false, boots: true } })[id];
  const s = summarisePlayerChamp(matches, 28, items);
  assert.equal(s.games, CHAMPION_GAMES, 'the newest 20 games on the champion only');
  assert.equal(s.form.length, 10);
  assert.equal(s.form[0], false, 'newest first (game 0 was a loss)');
  assert.equal(s.short.games + s.long.games, 20);
  assert.equal(s.short.games, 10);
  assert.deepEqual(s.items.map((x) => x.id), [3157, 4645], 'finished items only, boots apart');
  assert.equal(s.items[0].games, 20);
  assert.deepEqual(s.boots, [{ id: 3020, games: 20 }]);
  assert.deepEqual(s.keystones, [{ id: 8112, games: 20 }]);
  assert.deepEqual(s.spellPairs[0], { pair: [4, 11], games: 20 }, 'a pair is the same either way round');
  assert.equal(s.lane, 'JUNGLE');
  assert.equal(Math.round(s.csPerMin * 10) / 10 > 0, true);
  assert.equal(summarisePlayerChamp(matches, 999, items), null, 'no games, no summary');

  // --- the rules about the player ---
  const enemy = playerChampAdvice(s, 'Evelynn', 'enemy');
  const ally = playerChampAdvice(s, 'Evelynn', 'ally');
  const deathsEnemy = enemy.find((l) => l.key === 'deaths-high');
  const deathsAlly = ally.find((l) => l.key === 'deaths-high');
  assert.equal(deathsEnemy.mark, '+', "an enemy who dies a lot is a chance");
  assert.equal(deathsAlly.mark, '!', 'an ally who dies a lot is a worry');
  assert.match(deathsEnemy.text, /8\.0 times a game/);
  assert.ok(enemy.some((l) => l.key === 'kp-high'));
  assert.ok(enemy.length <= 5);
  const few = summarisePlayerChamp(matches.slice(0, 3), 28, items);
  assert.ok(playerChampAdvice(few, 'Evelynn', 'enemy').some((l) => l.key === 'few'), 'three games say to read loosely');
  const late = summarisePlayerChamp(matches.map((m) => ({ ...m, win: m.durationSec > 1500 })), 28, items);
  assert.match(playerChampAdvice(late, 'Evelynn', 'enemy').find((l) => l.key === 'length').text, /end the game early/);
  for (const line of [...enemy, ...ally]) assert.ok(!/score|rating|rank(ed)? them|mmr/i.test(line.text), 'never a score of the player');

  // --- the kept notes ---
  const lines = [{ mark: '!', text: 'A made-up line about this matchup for the check.' }];
  const notes = (alias, over) => ({ champion: alias, patch: '16.23.1', model: 'claude-opus-5-5', writtenAt: '2026-11-23T00:00:00Z', deep: false, cc: [{ key: 'W', type: 'charm', dodge: 'Step away.' }], arena: { duos: [], notes: [] }, against: {}, with: {}, ...over });
  const evelynn = notes('Evelynn', { deep: true, against: { Ahri: { lines, model: 'claude-opus-5-5', deep: true } }, with: { Leona: { lines, model: 'claude-opus-5-5' } } });
  const ahriOnlyMentioned = notes('Ahri', { writtenAt: '', model: '', cc: [], against: { Evelynn: { lines, model: 'claude-opus-5-5', deep: false } } });
  const p1 = pairFrom(evelynn, ahriOnlyMentioned, 'Evelynn', 'Ahri', 'against');
  assert.deepEqual(p1.lines, lines);
  assert.equal(p1.deep, true);
  assert.equal(p1.cc, null, "a champion whose own parts aren't written has no CC lines yet (not an empty list)");
  const leonaNotes = notes('Leona', { with: {} });
  const p2 = pairFrom(leonaNotes, evelynn, 'Leona', 'Evelynn', 'with');
  assert.deepEqual(p2.lines, lines, 'an ally note from either side');
  assert.equal(p2.cc.length, 1);
  assert.equal(pairFrom(null, null, 'Zed', 'Ahri', 'against').lines, null, 'nothing written yet');
  assert.equal(pairFrom(evelynn, null, 'Evelynn', 'Evelynn', 'self').cc.length, 1);
  assert.equal(modelWords('claude-haiku-5-5'), 'CLAUDE HAIKU 5.5');

  assert.equal(isChampionAlias('MonkeyKing'), true);
  for (const bad of ['../Evelynn', 'Eve lynn', 'Evelynn.json', '', 'a']) assert.equal(isChampionAlias(bad), false, `refuses ${JSON.stringify(bad)}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-notes-'));
  fs.writeFileSync(path.join(dir, 'Evelynn.json'), JSON.stringify(evelynn));
  fs.writeFileSync(path.join(dir, 'Wrong.json'), JSON.stringify(notes('Other')));
  assert.equal((await readChampionNotes('Evelynn', dir)).champion, 'Evelynn');
  assert.equal(await readChampionNotes('Ahri', dir), null, 'no file, no notes');
  assert.equal(await readChampionNotes('Wrong', dir), null, "a file that names another champion isn't trusted");
  assert.equal(await readChampionNotes('../Evelynn', dir), null);

  // --- the batch's checks ---
  const { checkAnswer } = await import(pathToFileURL(path.join(root, 'scripts', 'leaguebot-advice-batch.mjs')).href);
  const L = (n, text = 'A line long enough to pass the length rule here.') => Array.from({ length: n }, () => ({ mark: '>', text }));
  const good = { pairs: [{ opponent: 'Ahri', against: L(4), their_side: L(3), with: L(2) }] };
  assert.deepEqual(checkAnswer(good, { subject: 'Evelynn', opponents: ['Ahri'], own: false, deep: false }), []);
  assert.ok(checkAnswer(good, { subject: 'Evelynn', opponents: ['Ahri', 'Zed'], own: false, deep: false }).some((p) => p.startsWith('Zed: missing')));
  assert.ok(checkAnswer(good, { subject: 'Evelynn', opponents: ['Ahri'], own: false, deep: true }).some((p) => p.startsWith('Ahri.against')), 'deep wants 6 or more lines');
  const seconds = { pairs: [{ opponent: 'Ahri', against: L(4, 'Her charm lasts 1.5 seconds so wait it out first.'), their_side: L(3), with: L(2) }] };
  assert.ok(checkAnswer(seconds, { subject: 'Evelynn', opponents: ['Ahri'], own: false, deep: false }).some((p) => /seconds/.test(p)), 'a time in seconds is refused');
  assert.ok(checkAnswer(good, { subject: 'Evelynn', opponents: ['Ahri'], own: true, deep: false }).includes('own: missing'));

  // --- from the files ---
  const live = read('app/components/LeagueLive.tsx');
  assert.match(live, /aria-pressed=\{picked === pickOf\(p\)\}/, 'the rows are keys that say which is picked');
  assert.match(live, /<LeagueChampion /);
  const panel = read('app/components/LeagueChampion.tsx');
  assert.ok(!/dangerouslySetInnerHTML/.test(panel), 'Claude and Riot text is plain text');
  assert.ok(!/splash/i.test(panel), 'no splash art');
  const route = read('app/api/leaguebot/advice/route.ts');
  assert.match(route, /isChampionAlias\(mine\)/);
  const champRoute = read('app/api/leaguebot/champion/route.ts');
  assert.match(champRoute, /keeper\.allow\(visitorOf\(request\)\)/, 'the per-visitor limit holds');
  const script = read('scripts/leaguebot-advice-batch.mjs');
  assert.ok(!/console\.log\([^)]*apiKey\(\)/.test(script), 'the key is never printed');

  console.log('check-leaguebot-champion: all good');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
