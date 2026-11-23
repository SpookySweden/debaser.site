#!/usr/bin/env node
/**
 * LEAGUEBOT's Claude-written notes, written ahead of time in batches (SPEC-leaguebot-live-champs.md). Run by hand on
 * SERVER, never by the site. Luke's answers (2026-11-23): Evelynn first and deep on Claude Opus 5.5, then every other
 * champion A to Z on Claude Haiku 5.5, the notes kept in a folder on SERVER, one handoff per champion with Arena notes.
 *
 *   node scripts/leaguebot-advice-batch.mjs submit --champion Evelynn --deep --model claude-opus-5-5
 *   node scripts/leaguebot-advice-batch.mjs submit --next 20 --model claude-haiku-5-5   (the next 20 champions A to Z)
 *   node scripts/leaguebot-advice-batch.mjs collect          (reads every finished batch, checks and keeps the answers)
 *   node scripts/leaguebot-advice-batch.mjs retry            (asks again for what failed the checks)
 *   node scripts/leaguebot-advice-batch.mjs status
 *   node scripts/leaguebot-advice-batch.mjs try --champion Evelynn --against Ahri --model claude-haiku-5-5   (one direct call, prints only)
 *   add --dry to submit or retry to see the plan and an estimate without asking Anthropic.
 *
 * How it batches: one request carries one champion's kit (cached) and up to ten opponents' kits (six when deep), and
 * writes, for each pair, the matchup from both sides and the "with" note once. Pairs already written, or waiting in a
 * batch not yet collected, are never asked twice. Answers come back as JSON in a fixed shape and are checked before they
 * are kept: every opponent present, line counts and lengths in bounds, no cooldown numbers (the page prints Riot's).
 *
 * The key: ANTHROPIC_API_KEY from `--env` (default the site's own env file on SERVER, G:\DEBASER-HOST\site.env), read and
 * never printed. The notes: `--out` or LEAGUEBOT_ADVICE_DIR, default I:\DEBASER\leaguebot-advice (one `<alias>.json`
 * per champion, `_batches.json` for the batches, `_kits/` for Riot's files). Handoffs: docs/leaguebot/champions/.
 */

import Anthropic from '@anthropic-ai/sdk';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerSchema, SYSTEM, task } from './leaguebot-advice/prompt.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DDRAGON = 'https://ddragon.leagueoflegends.com';
const LANG = 'en_GB';

// ---------- arguments ----------
const argv = process.argv.slice(2);
const command = argv[0];
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const OUT = option('out', process.env.LEAGUEBOT_ADVICE_DIR || 'I:\\DEBASER\\leaguebot-advice');
const ENV_FILE = option('env', 'G:\\DEBASER-HOST\\site.env');
const HANDOFFS = path.join(ROOT, 'docs', 'leaguebot', 'champions');
const STATE_FILE = path.join(OUT, '_batches.json');

/** List prices per million tokens (Anthropic, cached 2026-11-03); batches are half. */
const PRICES = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
};

// ---------- small helpers ----------
function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 1));
  renameSync(tmp, file);
}
function apiKey() {
  if (!existsSync(ENV_FILE)) throw new Error(`No env file at ${ENV_FILE}: pass --env <file> holding ANTHROPIC_API_KEY.`);
  for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = /^\s*ANTHROPIC_API_KEY\s*=\s*(.*)\s*$/.exec(line);
    if (m) return m[1].replace(/^["']|["']$/g, '').trim();
  }
  throw new Error(`${ENV_FILE} has no ANTHROPIC_API_KEY.`);
}
function costOf(model, usage) {
  const price = PRICES[model] ?? PRICES['claude-opus-5-5'];
  const input = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) * 1.25 + (usage.cache_read_input_tokens ?? 0) * 0.1;
  return ((input * price.input + (usage.output_tokens ?? 0) * price.output) / 1e6) * 0.5;
}

// ---------- Riot's data ----------
async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Data Dragon answered ${response.status} for ${url}`);
  return response.json();
}
async function latestPatch() {
  const versions = await getJson(`${DDRAGON}/api/versions.json`);
  return versions.find((v) => /^\d+\.\d+\.\d+$/.test(v));
}
async function championList(patch) {
  const file = path.join(OUT, '_kits', patch, '_list.json');
  let list = readJson(file, null);
  if (!list) {
    const data = await getJson(`${DDRAGON}/cdn/${patch}/data/${LANG}/champion.json`);
    list = Object.values(data.data).map((c) => ({ alias: c.id, name: c.name, tags: c.tags }));
    writeJson(file, list);
  }
  return list.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}
const plain = (html) =>
  String(html ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
/** The same crowd-control words the panel finds (app/lib/leaguebot/champion-kit.ts, CC_WORDS); keep the two in step. */
const CC_WORDS = [
  [/\bsuppress/i, 'suppression'], [/\bstun/i, 'stun'], [/\b(?:root|snare|immobiliz)/i, 'root'],
  [/\bknock(?:s|ing|ed)?(?:[- ]\w+){0,2}?[- ]up\b|\bairborne/i, 'knock-up'], [/\bknock(?:s|ing|ed)?(?:[- ]\w+){0,2}?[- ](?:back|aside|away)\b|\bknockback|\bdisplac/i, 'knockback'],
  [/\bpull(?:s|ing|ed)? (?:the |an |all |nearby |enemies|enemy|them|target)/i, 'pull'], [/\bcharm/i, 'charm'], [/\b(?:fear|flee|terrif)/i, 'fear'],
  [/\btaunt/i, 'taunt'], [/\bsilenc/i, 'silence'], [/\b(?:sleep|asleep|drows)/i, 'sleep'], [/\bpolymorph/i, 'polymorph'],
  [/\bground(?:ed|s)\b/i, 'grounded'], [/\bberserk/i, 'berserk'], [/\bblind/i, 'blind'], [/\bnearsight/i, 'nearsight'], [/\bdisarm/i, 'disarm'], [/\bslow/i, 'slow'],
];
const ccIn = (text) => CC_WORDS.filter(([w]) => w.test(text)).map(([, n]) => n);

/** One champion's kit, cut down for a prompt (about 800 tokens), with the CC Riot's text names. Cached per patch. */
async function kitOf(patch, alias) {
  const file = path.join(OUT, '_kits', patch, `${alias}.json`);
  let raw = readJson(file, null);
  if (!raw) {
    raw = await getJson(`${DDRAGON}/cdn/${patch}/data/${LANG}/champion/${alias}.json`);
    writeJson(file, raw);
  }
  const c = Object.values(raw.data)[0];
  const keys = ['Q', 'W', 'E', 'R'];
  const abilities = [{ key: 'P', name: c.passive.name, text: plain(c.passive.description), cooldowns: [] }].concat(
    c.spells.slice(0, 4).map((s, i) => ({ key: keys[i], name: s.name, text: plain(s.description), tooltip: plain(s.tooltip), cooldowns: s.cooldown ?? [] })),
  );
  for (const a of abilities) a.cc = [...new Set([...ccIn(a.text), ...ccIn(a.tooltip ?? '')])];
  const lines = [`${c.name} (${c.id}), ${c.title}. Tags: ${c.tags.join(', ')}. Resource: ${c.partype || 'none'}.`];
  for (const a of abilities) {
    const cd = a.cooldowns.length ? ` Cooldown by rank: ${a.cooldowns.join('/')}.` : '';
    const cc = a.cc.length ? ` Crowd control named: ${a.cc.join(', ')}.` : '';
    lines.push(`${a.key === 'P' ? 'Passive' : a.key} - ${a.name}: ${a.text.slice(0, 420)}${cd}${cc}`);
  }
  return { alias: c.id, name: c.name, text: lines.join('\n'), abilities };
}

// ---------- the notes files ----------
const notesFile = (alias) => path.join(OUT, `${alias}.json`);
function readNotes(alias, patch) {
  return readJson(notesFile(alias), null) ?? { champion: alias, patch, model: '', writtenAt: '', deep: false, cc: [], arena: { duos: [], notes: [] }, against: {}, with: {} };
}

// ---------- checks ----------
const SECONDS = /\b\d+(?:\.\d+)?\s?(?:s|sec|secs|second|seconds)\b/i;
function checkLines(lines, min, max, where, problems) {
  if (!Array.isArray(lines) || lines.length < min || lines.length > max) problems.push(`${where}: ${Array.isArray(lines) ? lines.length : 'no'} lines (wants ${min} to ${max})`);
  for (const line of Array.isArray(lines) ? lines : []) {
    if (!['!', '+', '>'].includes(line?.mark)) problems.push(`${where}: a line without a mark`);
    const text = String(line?.text ?? '');
    if (text.length < 20 || text.length > 450) problems.push(`${where}: a line ${text.length} characters long`);
    if (SECONDS.test(text)) problems.push(`${where}: states a time in seconds ("${text.match(SECONDS)[0]}")`);
  }
}
/** The answer's problems for one request (an empty list means keep it). Exported shape for the check script. */
export function checkAnswer(answer, request) {
  const problems = [];
  if (!answer || typeof answer !== 'object') return ['not JSON'];
  if (request.own) {
    const own = answer.own;
    if (!own || !Array.isArray(own.cc) || !own.arena) problems.push('own: missing');
    else {
      for (const c of own.cc) if (!['P', 'Q', 'W', 'E', 'R'].includes(c.key) || !c.type || String(c.dodge ?? '').length < 15) problems.push(`own.cc: a bad entry (${c.key})`);
      for (const c of own.cc) if (SECONDS.test(String(c.dodge ?? ''))) problems.push(`own.cc ${c.key}: states a time in seconds`);
    }
  }
  const pairs = new Map((Array.isArray(answer.pairs) ? answer.pairs : []).map((p) => [p.opponent, p]));
  for (const opponent of request.opponents) {
    const p = pairs.get(opponent);
    if (!p) {
      problems.push(`${opponent}: missing`);
      continue;
    }
    checkLines(p.against, request.deep ? 6 : 3, request.deep ? 12 : 6, `${opponent}.against`, problems);
    checkLines(p.their_side, 3, 6, `${opponent}.their_side`, problems);
    checkLines(p.with, 2, 4, `${opponent}.with`, problems);
  }
  return problems;
}

// ---------- planning ----------
const pairKey = (a, b) => [a, b].sort().join('|');
function pendingPairs(state) {
  const set = new Set();
  const own = new Set();
  for (const batch of state.batches.filter((b) => !b.collected)) {
    for (const r of Object.values(batch.requests)) {
      for (const o of r.opponents) set.add(pairKey(r.subject, o));
      if (r.own) own.add(r.subject);
    }
  }
  return { set, own };
}
/** The requests for these subjects, skipping every pair already written or waiting in a batch. */
function plan(subjects, all, patch, state, deep, groupSize) {
  const { set: planned, own: ownPlanned } = pendingPairs(state);
  const requests = [];
  for (const subject of subjects) {
    const notes = readNotes(subject.alias, patch);
    const opponents = all.filter((o) => o.alias !== subject.alias && !notes.against[o.alias] && !planned.has(pairKey(subject.alias, o.alias))).map((o) => o.alias);
    for (const o of opponents) planned.add(pairKey(subject.alias, o));
    const needOwn = !notes.writtenAt && !ownPlanned.has(subject.alias);
    const groups = [];
    for (let i = 0; i < opponents.length; i += groupSize) groups.push(opponents.slice(i, i + groupSize));
    if (groups.length === 0 && needOwn) groups.push([]);
    groups.forEach((group, i) => requests.push({ subject: subject.alias, opponents: group, own: needOwn && i === 0, deep }));
  }
  return requests;
}
async function buildParams(request, patch, model, all) {
  const subject = await kitOf(patch, request.subject);
  const opponents = [];
  for (const alias of request.opponents) opponents.push(await kitOf(patch, alias));
  const deep = request.deep;
  return {
    model,
    max_tokens: deep ? 32000 : 16000,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: `FIRST CHAMPION\n${subject.text}`, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: `SECOND CHAMPIONS\n\n${opponents.map((o) => o.text).join('\n\n') || '(none in this request)'}` },
          { type: 'text', text: task(subject, opponents.length ? opponents : request.opponents.map((a) => all.find((c) => c.alias === a)), request.own, deep) },
        ],
      },
    ],
    output_config: { effort: deep ? 'high' : 'medium', format: { type: 'json_schema', schema: answerSchema(request.own) } },
  };
}

// ---------- keeping answers ----------
function keep(answer, request, model, patch, written) {
  const now = new Date().toISOString();
  // Several requests in one batch share a subject (Evelynn's 29): build on what this batch has already kept.
  const subject = written.get(request.subject) ?? readNotes(request.subject, patch);
  if (request.own && answer.own) {
    subject.cc = answer.own.cc.map((c) => ({ key: c.key, type: String(c.type).toLowerCase(), dodge: c.dodge }));
    subject.arena = { duos: answer.own.arena.duos.slice(0, 6), notes: answer.own.arena.notes.slice(0, 5) };
    subject.model = model;
    subject.writtenAt = now;
    subject.deep = request.deep;
    subject.patch = patch;
  }
  for (const p of answer.pairs ?? []) {
    if (!request.opponents.includes(p.opponent)) continue;
    subject.against[p.opponent] = { lines: p.against, model, deep: request.deep };
    subject.with[p.opponent] = { lines: p.with, model };
    const other = written.get(p.opponent) ?? readNotes(p.opponent, patch);
    other.against[request.subject] = { lines: p.their_side, model, deep: false };
    other.with[request.subject] = { lines: p.with, model };
    written.set(p.opponent, other);
  }
  written.set(request.subject, subject);
}
function flush(written) {
  for (const [alias, notes] of written) writeJson(notesFile(alias), notes);
}

// ---------- handoffs ----------
async function writeHandoff(alias, patch, total, log) {
  const notes = readNotes(alias, patch);
  if (!notes.writtenAt) return;
  const kit = await kitOf(patch, alias);
  const theirs = kit.abilities.filter((a) => a.cc.length > 0).map((a) => a.key);
  const claude = notes.cc.map((c) => c.key);
  const onlyRiot = theirs.filter((k) => !claude.includes(k));
  const onlyClaude = claude.filter((k) => !theirs.includes(k));
  const against = Object.keys(notes.against).length;
  const allies = Object.keys(notes.with).length;
  const lines = [
    `# ${kit.name}: LEAGUEBOT notes handoff`,
    '',
    `Written by \`scripts/leaguebot-advice-batch.mjs\` (SPEC-leaguebot-live-champs.md). The notes live on SERVER in`,
    `\`${notesFile(alias)}\`; this file is the record and the place for hand notes. Re-running the script rewrites the`,
    'sections above HAND NOTES only.',
    '',
    '## What was written',
    `- Patch ${notes.patch}; own parts (CC, Arena) by ${notes.model} on ${notes.writtenAt.slice(0, 10)}${notes.deep ? ', DEEP prompt' : ''}.`,
    `- Matchups: ${against} of ${total - 1} opponents from ${kit.name}'s side; ${allies} ally notes.`,
    ...(log.length ? log.map((l) => `- ${l}`) : ['- Every answer passed the checks first time.']),
    '',
    '## Crowd control',
    ...notes.cc.map((c) => `- ${c.key} (${c.type}): ${c.dodge}`),
    ...(onlyRiot.length ? [`- CHECK BY HAND: Riot's text names CC on ${onlyRiot.join(', ')} that Claude didn't list.`] : []),
    ...(onlyClaude.length ? [`- CHECK BY HAND: Claude lists CC on ${onlyClaude.join(', ')} that Riot's text doesn't name plainly (often right: Riot's short text leaves effects out).`] : []),
    '',
    '## ARENA (later)',
    'Kept for the Arena support planned later (nothing for Arena is built yet; SPEC-leaguebot.md 11A stands until it starts).',
    `- Duo partners: ${notes.arena.duos.join(', ') || 'none written'}`,
    ...notes.arena.notes.map((n) => `- ${n}`),
    '- What Arena support will need: Arena queue ids in the live-game check, 2v2v2v2 teams in the LIVE tables (not two',
    '  teams of five), augment data from Community Dragon (the cherry-augments file), and these duo notes per pair.',
    '',
    ...(notes.deep
      ? [
          '## The deep prompt',
          `${kit.name} got the DEEP brief (scripts/leaguebot-advice/prompt.mjs, deepBrief): 6 to 10 lines from ${kit.name}'s side`,
          `covering kill threshold, gank or invade angle and what reveals stealth, the level 6 window, what punishes ${kit.name}, and when`,
          'behind; Opus 5.5 at high effort, six opponents a request. Reuse it for any champion with --champion X --deep.',
          '',
        ]
      : []),
  ];
  const file = path.join(HANDOFFS, `${alias}.md`);
  const old = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const hand = old.includes('## HAND NOTES') ? old.slice(old.indexOf('## HAND NOTES')) : '## HAND NOTES\n\n(none yet)\n';
  mkdirSync(HANDOFFS, { recursive: true });
  writeFileSync(file, `${lines.join('\n')}\n${hand}`);
}

// ---------- commands ----------
async function submit(requests, model, patch, all, state, label) {
  const estimateIn = requests.length * (requests[0]?.deep ? 7000 : 10000);
  const estimateOut = requests.reduce((s, r) => s + r.opponents.length * (r.deep ? 1400 : 700) + (r.own ? 600 : 0), 0) * 1.6;
  const estimate = costOf(model, { input_tokens: estimateIn, output_tokens: estimateOut });
  console.log(`${requests.length} requests, ${requests.reduce((s, r) => s + r.opponents.length, 0)} pairs, model ${model}; rough estimate $${estimate.toFixed(2)}.`);
  if (flag('dry') || requests.length === 0) return;
  const client = new Anthropic({ apiKey: apiKey() });
  const batchRequests = [];
  const map = {};
  for (const [i, r] of requests.entries()) {
    const id = `${r.subject}-${String(i).padStart(3, '0')}`;
    map[id] = r;
    batchRequests.push({ custom_id: id, params: await buildParams(r, patch, model, all) });
  }
  const batch = await client.messages.batches.create({ requests: batchRequests });
  state.batches.push({ id: batch.id, label, model, patch, submittedAt: new Date().toISOString(), requests: map, collected: false });
  writeJson(STATE_FILE, state);
  console.log(`Submitted batch ${batch.id} (${label}).`);
}

function textOf(message) {
  return message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

async function collect(state, all, patch) {
  const client = new Anthropic({ apiKey: apiKey() });
  for (const batch of state.batches.filter((b) => !b.collected)) {
    const info = await client.messages.batches.retrieve(batch.id);
    if (info.processing_status !== 'ended') {
      console.log(`${batch.id} (${batch.label}): ${info.processing_status}, ${info.request_counts.processing} still working.`);
      continue;
    }
    const written = new Map();
    const logs = new Map();
    let cost = 0;
    let kept = 0;
    state.failed ??= [];
    for await (const result of await client.messages.batches.results(batch.id)) {
      const request = batch.requests[result.custom_id];
      if (!request) continue;
      const log = logs.get(request.subject) ?? [];
      logs.set(request.subject, log);
      if (result.result.type !== 'succeeded') {
        state.failed.push({ ...request, why: result.result.type });
        log.push(`${result.custom_id}: ${result.result.type}, queued for retry`);
        continue;
      }
      const message = result.result.message;
      cost += costOf(batch.model, message.usage);
      if (message.stop_reason !== 'end_turn') {
        state.failed.push({ ...request, why: message.stop_reason });
        log.push(`${result.custom_id}: stopped (${message.stop_reason}), queued for retry`);
        continue;
      }
      let answer = null;
      try {
        answer = JSON.parse(textOf(message));
      } catch {
        answer = null;
      }
      const problems = checkAnswer(answer, request);
      // Keep the pairs that passed; ask again only for the rest.
      const badOpponents = new Set(problems.map((p) => p.split(/[.:]/)[0]).filter((o) => request.opponents.includes(o)));
      const ownBad = problems.some((p) => p.startsWith('own'));
      if (answer && problems.length === 0) {
        keep(answer, request, batch.model, patch, written);
        kept += request.opponents.length;
      } else if (answer && (badOpponents.size < request.opponents.length || (request.own && !ownBad))) {
        const good = { ...request, own: request.own && !ownBad, opponents: request.opponents.filter((o) => !badOpponents.has(o)) };
        keep(answer, good, batch.model, patch, written);
        kept += good.opponents.length;
        state.failed.push({ ...request, own: request.own && ownBad, opponents: [...badOpponents], why: problems.slice(0, 3).join('; ') });
        log.push(`${result.custom_id}: ${problems.length} problems (${problems.slice(0, 2).join('; ')}), ${badOpponents.size} pairs queued for retry`);
      } else {
        state.failed.push({ ...request, why: problems.slice(0, 3).join('; ') || 'no answer' });
        log.push(`${result.custom_id}: failed the checks (${problems.slice(0, 2).join('; ')}), queued for retry`);
      }
    }
    // Every file this batch touched is written once, at the end.
    flush(written);
    batch.collected = true;
    batch.collectedAt = new Date().toISOString();
    batch.cost = Number(cost.toFixed(4));
    writeJson(STATE_FILE, state);
    for (const [alias, log] of logs) await writeHandoff(alias, patch, all.length, log);
    console.log(`${batch.id} (${batch.label}): kept ${kept} pairs; cost $${cost.toFixed(2)}; ${state.failed.length} items waiting for retry.`);
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const patch = await latestPatch();
  const all = await championList(patch);
  const state = readJson(STATE_FILE, { batches: [], failed: [] });
  const model = option('model', 'claude-haiku-5-5');
  if (!PRICES[model]) throw new Error(`Unknown model ${model}.`);

  if (command === 'submit') {
    const deep = flag('deep');
    let subjects;
    if (option('champion')) {
      const one = all.find((c) => c.alias.toLowerCase() === option('champion').toLowerCase());
      if (!one) throw new Error(`No champion ${option('champion')} on patch ${patch}.`);
      subjects = [one];
    } else {
      const { own } = pendingPairs(state);
      const next = Number(option('next', '10'));
      subjects = all.filter((c) => !readNotes(c.alias, patch).writtenAt && !own.has(c.alias)).slice(0, next);
    }
    const requests = plan(subjects, all, patch, state, deep, deep ? 6 : 10);
    await submit(requests, model, patch, all, state, `${deep ? 'deep ' : ''}${subjects[0]?.alias ?? ''}${subjects.length > 1 ? ` to ${subjects[subjects.length - 1].alias}` : ''}`);
  } else if (command === 'retry') {
    const failed = (state.failed ?? []).filter((r) => r.opponents.length > 0 || r.own);
    const retryModel = option('model', null) ?? (failed[0]?.deep ? 'claude-opus-5-5' : 'claude-haiku-5-5');
    const requests = failed.map(({ why, ...r }) => r);
    if (!flag('dry')) state.failed = [];
    await submit(requests, retryModel, patch, all, state, 'retry');
    if (!flag('dry')) writeJson(STATE_FILE, state);
  } else if (command === 'collect') {
    await collect(state, all, patch);
  } else if (command === 'status') {
    const files = all.map((c) => readNotes(c.alias, patch));
    const own = files.filter((f) => f.writtenAt).length;
    const pairs = files.reduce((s, f) => s + Object.keys(f.against).length, 0);
    console.log(`Patch ${patch}: ${all.length} champions; ${own} with their own notes; ${pairs} of ${all.length * (all.length - 1)} "against" notes.`);
    for (const b of state.batches) console.log(`- ${b.id} ${b.label} ${b.model} ${b.collected ? `collected, $${b.cost}` : 'waiting'}`);
    console.log(`${(state.failed ?? []).length} items waiting for retry.`);
  } else if (command === 'try') {
    const subject = all.find((c) => c.alias.toLowerCase() === String(option('champion')).toLowerCase());
    const other = all.find((c) => c.alias.toLowerCase() === String(option('against')).toLowerCase());
    if (!subject || !other) throw new Error('Give --champion and --against as Data Dragon aliases.');
    const request = { subject: subject.alias, opponents: [other.alias], own: true, deep: flag('deep') };
    const client = new Anthropic({ apiKey: apiKey() });
    // A deep request's room for words needs streaming outside a batch (the SDK refuses a long plain call).
    const message = await client.messages.stream(await buildParams(request, patch, model, all)).finalMessage();
    const answer = JSON.parse(textOf(message));
    console.log(JSON.stringify(answer, null, 1));
    console.log('PROBLEMS:', checkAnswer(answer, request));
    console.log(`usage: ${JSON.stringify(message.usage)}; cost at full price about $${(costOf(model, message.usage) * 2).toFixed(4)}`);
  } else {
    console.log('Commands: submit (--champion X [--deep] | --next N) [--model M] [--dry], collect, retry [--dry], status, try --champion X --against Y.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`! ${error.message}`);
    process.exit(1);
  });
}
