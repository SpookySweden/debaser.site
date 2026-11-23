/**
 * The prompts and answer shape for LEAGUEBOT's Claude-written notes (SPEC-leaguebot-live-champs.md). Kept apart from the
 * batch script so the wording can be tuned without touching the plumbing. The system prompt never changes between
 * requests, so it is cached.
 */

export const SYSTEM = `You write matchup notes for LEAGUEBOT, a League of Legends helper on a non-commercial fan site. A player reads them on a second screen during the loading screen and early game, so every line must be short, concrete and useful.

How to write:
- Plain English, second person ("you"), present tense. One idea per line, 12 to 35 words.
- Each line has a mark: "!" a danger or something to respect, "+" an advantage or an opening, ">" a concrete thing to do.
- Be specific to the two kits you are given: name abilities, say how they are aimed, and give timings by game phase (levels 1 to 3, level 6, first item, mid game). No generic advice that would fit any matchup ("farm well", "ward more") unless it is tied to the kits.
- Never state cooldowns or durations in seconds or other numbers: the page prints Riot's own numbers beside your text. Describe timing in words ("after she uses E", "while his R is down").
- Use only the abilities listed, named exactly as written there, and describe only effects the kit text states. Never invent an ability, item or effect. When unsure of a detail, leave it out rather than guess.
- No patches, tier lists, win rates, players or streamers.
- The two may meet in any role. Write for the roles their kits suit (the tags show them); for a jungler, cover ganks, invades and skirmishes rather than a lane.

The parts you may be asked for:
- against: the first champion against the second, from the first champion's side.
- their_side: the same matchup from the second champion's side.
- with: the two as allies on the same team: how they combine, who starts fights, what to follow up.
- cc: one entry per ability of the first champion that crowd-controls enemies (stun, root, knock-up, knockback, pull, charm, fear, taunt, silence, sleep, suppression, polymorph, grounded, blind, nearsight, slow and the like). key is P, Q, W, E or R; type is the effect in a word or two; dodge is one line on how it is aimed or triggered and how to avoid or play around it.
- arena: Arena is a 2v2v2v2 mode on small maps with augments. duos: two to four champions (their names) that pair well with the first champion there. notes: two or three lines on how it plays in Arena.

Return only the JSON the schema asks for.`;

/** Added to the request when the subject gets the deep treatment (Evelynn first, Luke's "put good effort to deep evelynn advice"). */
export function deepBrief(name) {
  return `This is a DEEP set for ${name}, the champion the site's owner plays most. For ${name}'s side of each matchup ("against") write 6 to 10 lines covering: whether ${name} can kill them and from what level or item; the gank or invade angle on them, including anything of theirs that reveals or counters stealth or camouflage (control wards, true sight, reveals on hit or in an area); the level 6 window; what of theirs punishes ${name} (crowd control to dodge, burst, sustained damage); and one line for when ${name} is behind. The reader knows ${name} well: skip basics and be precise. "their_side" stays 3 to 5 lines and "with" 2 or 3.`;
}

const LINE = {
  type: 'object',
  properties: { mark: { type: 'string', enum: ['!', '+', '>'] }, text: { type: 'string' } },
  required: ['mark', 'text'],
  additionalProperties: false,
};
const LINES = { type: 'array', items: LINE };

/** The answer's shape. `own` (the subject's CC and Arena notes) is asked for in its first request only. */
export function answerSchema(withOwn) {
  const pair = {
    type: 'object',
    properties: { opponent: { type: 'string' }, against: LINES, their_side: LINES, with: LINES },
    required: ['opponent', 'against', 'their_side', 'with'],
    additionalProperties: false,
  };
  const properties = { pairs: { type: 'array', items: pair } };
  const required = ['pairs'];
  if (withOwn) {
    properties.own = {
      type: 'object',
      properties: {
        cc: {
          type: 'array',
          items: {
            type: 'object',
            properties: { key: { type: 'string', enum: ['P', 'Q', 'W', 'E', 'R'] }, type: { type: 'string' }, dodge: { type: 'string' } },
            required: ['key', 'type', 'dodge'],
            additionalProperties: false,
          },
        },
        arena: {
          type: 'object',
          properties: { duos: { type: 'array', items: { type: 'string' } }, notes: { type: 'array', items: { type: 'string' } } },
          required: ['duos', 'notes'],
          additionalProperties: false,
        },
      },
      required: ['cc', 'arena'],
      additionalProperties: false,
    };
    required.unshift('own');
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

/** The task text after the kits. */
export function task(subject, opponents, withOwn, deep) {
  const list = opponents.map((o) => `${o.alias} (${o.name})`).join(', ');
  return [
    deep ? deepBrief(subject.name) : '',
    `The first champion is ${subject.name} (${subject.alias}).`,
    withOwn ? `Write "own": ${subject.name}'s cc entries and arena notes.` : '',
    `Write one entry in "pairs" for each of these second champions, using the alias as "opponent": ${list}.`,
    deep ? '' : 'For each pair: "against" 3 to 5 lines, "their_side" 3 to 5 lines, "with" 2 or 3 lines.',
  ]
    .filter(Boolean)
    .join('\n\n');
}
