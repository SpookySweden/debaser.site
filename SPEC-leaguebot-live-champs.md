# SPEC: LEAGUEBOT LIVE, pick any champion (2026-11-22)

Status: **OK'd by Luke 2026-11-23, building.** His answers to the two open choices: "Opus 5.5 for Evelyn, haiku for a to
z. Notes where you said": **1B** (Haiku 5.5 writes A to Z; Evelynn on Opus 5.5) and **2A** (the notes in a data folder
on SERVER). No database change.

**As built (2026-11-23), where it differs from the plan below:**
- THEIR BUILD shows the items the player *finished* in those games, by share (`16/20`), boots apart, keystone and
  spells. Their first and starting item aren't shown: match summaries hold only the final inventory, and the order would
  need each game's timeline (20 more requests a pick).
- THIS PLAYER shows damage a minute, not damage share: the summaries don't carry the team's total.
- Evelynn's batch: 172 of 172 matchups kept first time, $3.31 (Opus 5.5, 29 requests). A to Z on Haiku 5.5: 1,549
  requests ($4.83), then a retry of 1,328 smaller ones ($2.84) and a last 4 (under a cent). The retry was needed because
  answers ran out of room on ten opponents a request, and because Haiku wrote opponents back as `Teemo (Teemo)`;
  the checks now read that. Done 2026-11-23: all 29,756 matchup notes and 173 champions' CC and Arena notes, $10.97
  in all, from patch 16.23.1. About 36 MB on SERVER; 20 handoffs flag CC for a hand check.
- Haiku's notes are plainer and less exact than Opus's (seen: Thresh's lantern called a "dash", The Box's walls "to
  break early"). Each note is labelled with the model that wrote it. Offered a Sonnet 5.5 re-run of A to Z (about
  $100 to $150); Luke, 2026-11-23: "Keep Haiku for now".
- Both champions' kits are read as the batch runs, so a note is written from the patch of that night. A later patch's
  ability changes are not re-asked automatically yet: `submit` only fills pairs that are missing. Clearing a changed
  champion's file and running `submit --champion X` rewrites it.

## Luke's words
> "in leaguebot make it so that in the live tab, you can select any of the enemy or friendly champions to get advice on
> the match up, how to dodge their cc and the cd of their cc, and see all their abilities and the items the person
> playing them in the current game tends to buy, and some more specific data regarding the person and how they play the
> champ"

Interview answer (2026-11-22):
> "a but batch the claude advice creatively. starting with all possible evelynn match ups and put good effort to deep
> evelynn advice. then follow the same process for each champ, a to b. create handoffs for each one that keep notes for
> later planned arena support"

Read as follows (say if any is wrong):
- **Advice: A.** Facts come from data; Claude writes the advice. It is written **ahead of time in batches** and kept, so
  nothing is generated when you click. This replaces SPEC-leaguebot's 9A ("rules, no AI") for this panel only. The
  STATS, LIVE and REVIEW advice logs stay rules.
- **Evelynn first, deepest:** every Evelynn matchup (against each of the other ~171 champions, and alongside each as an
  ally), on the strongest model, with longer, deeper notes.
- **Then every other champion, A to Z** ("a to b" read as "A to Z"), the same way.
- **One handoff note per champion**, which also keeps notes for the Arena support planned later.
- The other three questions weren't answered. I took the recommended answers: **the last 20 games on that champion**,
  **stay keyless** (no Riot key), and **a panel under the teams**.

## What you see
In LIVE, once a game has loaded, every row in both team tables can be picked (a key with `aria-pressed`; Enter or a
click). Your own champion is picked first. A **CHAMPION** section opens under both teams with five parts:

1. **MATCHUP** (Claude, written ahead of time). For an enemy: how your champion plays against theirs, when you're
   stronger, what to avoid, and one thing to try. For an ally: how the two of you combine. For your lane opponent,
   OP.GG's matchup guide stays as it is now, and Claude's note sits under it. Marked `WRITTEN BY CLAUDE · PATCH 16.22`.
   For Evelynn the note is longer: her clear and gank angles against their champion, when she can and can't kill them,
   what reveals her, and her level 6 window.
2. **CC & HOW TO DODGE**. Each of their crowd-control abilities: icon, key (Q/W/E/R/passive), type (stun, root, knock-up,
   charm, ...), **cooldown at every rank** (`14 / 13 / 12 / 11 / 10 s`, from Riot's data for this patch), and a one-line
   dodge tip (Claude). Their rank in each ability can't be seen from outside the game, so every rank is shown. These
   are fixed numbers from the patch, not timers. SPEC-leaguebot's line "no enemy cooldown timers" still holds.
3. **ABILITIES**. Passive, Q, W, E, R: Riot's own icon, name, Riot's description, cooldown and cost at every rank, and
   range. All from Data Dragon for the current patch.
4. **THEIR BUILD**. What *this player* builds on this champion in their last 20 games on it: their usual first item,
   core items and boots (how many of those games each appeared in), starting item, keystone and runes, summoner spells.
   Beside it, the usual build for the champion from OP.GG, so a player who builds off-meta stands out.
5. **THIS PLAYER**. Their games and win rate on the champion this season (the table already has this), then from those
   last 20 games: win/loss with form (`W W L W L ...`), KDA, deaths a game, CS/min, kill participation, vision/min,
   damage share, wins in short games (under 25 minutes) against long ones, usual lane. Then three to five plain lines
   from rules, in the advice log's style (`!`, `+`, `>`), e.g. `! Dies 7.4 times a game on Yasuo: bait their all-in.`,
   `> Wins 70% of games over 30 minutes and 35% of shorter ones: end early.`
   Every number says its sample size ("last 14 games on Yasuo"). A player with no games on the champion says so.

The section loads the player's games only when you pick them, never all ten at once.

## Where the data comes from
| Part | Source | When |
|---|---|---|
| Abilities, cooldowns, icons | Data Dragon `champion/<Name>.json` for the current patch (Riot's own) | on pick, kept per patch in the tab |
| Which abilities are CC | Claude's per-champion pass (in the batch), checked against CC words in Riot's own ability text | ahead of time |
| Dodge tips, matchup and ally notes | Claude, ahead of time, through Anthropic's Message Batches API (half price) | ahead of time, kept |
| Player's last 20 games on the champion | U.GG's match list filtered to that champion (the site now asks from SERVER's home connection, which U.GG answers), with OP.GG from your browser as the fallback, as the STATS tab already does | on pick, 10-minute cache |
| Usual build for the champion | OP.GG's public app server (already used) | on pick, cached per patch |

Riot's icons load straight from Riot's servers, never copied into `assets/`. Riot's notice stays at the foot of the
window. No splash art.

## The batch ("creatively")
A script, `scripts/leaguebot-advice-batch.mjs`, run by hand, not by the site:
- **Grouped by champion.** One request carries one champion's kit once (cached), plus a group of about ten opponents'
  kits. It writes, for each pair, the "against" note from both sides and the "with" note once. So each pairing is read
  once instead of four times. Each champion's own CC dodge lines and Arena notes come in its first request.
- **Short kits.** Each kit is cut down from Riot's data: ability names, short descriptions, cooldowns, and CC words found
  in the text. About 800 tokens, not the full 14 KB file.
- **Structured output:** each answer comes back as JSON with a fixed shape. Answers that don't match it are asked again.
- **Checked automatically before it's kept:** every opponent present, no empty fields, lengths within bounds, and the
  numbers it mentions match Riot's data (a cooldown it states must be one of the real ranks).
- **Only changed champions on a new patch.** When a patch changes a champion's ability data (compared with the last
  patch's Data Dragon), only that champion's pairings are written again. A patch that changes no kits costs nothing.
- **Evelynn goes first, then stops.** Her run prices everything else with real numbers, and I read a sample of her notes
  for quality before A to Z starts. Then the champions go in alphabetical order, a few dozen per batch. Each batch
  finishes within a day, usually much sooner.

**The key:** the script needs `ANTHROPIC_API_KEY` in the env file of the machine that runs it. It isn't in this PC's
`.env.local` today, and I'll check SERVER's without printing it. If it's on neither, you paste it in yourself, never in
chat.

**Estimated cost** (Anthropic's list prices, the batch half-price discount, about 172 champions, both sides of every pair
plus ally notes; Evelynn's run replaces these guesses with real numbers):
| Run | Model | Estimate |
|---|---|---|
| Evelynn, deep (~171 opponents and allies) | Claude Opus 5.5 | about $5 to $10 |
| A to Z, everyone else (~29,000 "against" notes, ~14,500 ally notes) | Claude Sonnet 5.5 | about $150 to $200 |
| | Claude Haiku 5.5 | about $10 to $15 |
| | Claude Opus 5.5 | about $300 to $400 |
| Each later patch | same model | only the changed champions, usually a few percent of the above |

## The handoffs (one per champion)
`docs/leaguebot/champions/<name>.md`, written by the script and touched up by hand where needed:
- what was written (patch, model, date, how many pairings, which failed checks and were asked again);
- kit notes the rules got wrong (e.g. CC that Riot's text doesn't name plainly), fixed by hand in a small override file;
- spot-check notes (Evelynn's reviewed by me; other champions, three random notes each, checked by the script against the data);
- **ARENA (later):** the champion's Arena notes from the batch (strong duo partners and why, how its CC works in a small
  arena, the augment kinds that suit it). The note also says what the Arena support will need: the Arena modes in
  Community Dragon, 2v2v2v2 teams, and augment data. Nothing for Arena is built now (SPEC-leaguebot's 11A stands until
  you start it).
- Evelynn's handoff also says how her deep prompt differs, so it can be reused for any champion you want deep later.

## Out of scope
Anything during the match (their real ability ranks, items bought this game, live cooldowns); champ select; Arena, ARAM
and other modes (only notes kept for later); a score or rating of players; advice written at click time.

## Code (for the building step)
- `app/lib/leaguebot/champion-kit.ts`: reads Data Dragon's per-champion file into one shape (abilities, cooldowns, icons,
  CC found in the text). Pure, with a check fed a recorded Leona and Evelynn.
- `app/lib/leaguebot/player-champ.ts`: a player's last N games on one champion from U.GG, with OP.GG as the fallback,
  summarised (items by share, runes, spells, the stats above). `player-champ-advice.ts`: the rules for THIS PLAYER.
- `app/api/leaguebot/champion/route.ts`: one player and champion in, everything above out; the same cache and per-visitor
  limit as the other LEAGUEBOT routes.
- `app/api/leaguebot/advice/route.ts`: serves the kept Claude notes for one pair.
- `app/components/LeagueChampion.tsx`: the panel; `LeagueLive.tsx` gains the pickable rows.
- `scripts/leaguebot-advice-batch.mjs` and its prompt files under `scripts/leaguebot-advice/`.
- Third-party and Claude text rendered as plain text, never HTML.

## Proofs
- Local, mock data: recorded U.GG and OP.GG answers for one player on one champion, a recorded Data Dragon kit, and a
  handful of kept notes. Checks in `Temp/check-leaguebot-champion.cjs` (kit shaping, CC finding, player summary,
  advice rules, the batch's own checks), each watched failing first.
- The local dev server with the recorded live game: pick each of the ten, dark theme first, then a bright theme;
  capture plus audit once.
- The batch: Evelynn's run checked by the script, and a sample read by me before A to Z.
- Live: `deploy-status`, `npm run read` on `/leaguebot`, and one read of `/api/leaguebot/champion` for a player in a game.
- **Not provable without you in a match:** the panel against your own live game (League runs on the gaming PC). It's
  proved with a recorded game, and once live against any player who is in a game at that moment.

## Open choices (answer with letters)
1. **Which model writes A to Z** (Evelynn is on Opus 5.5 either way):
   **A. Sonnet 5.5, about $150 to $200 (recommended):** close to Opus quality for short notes at half the price.
   B. Haiku 5.5, about $10 to $15: cheapest, plainer and less specific. C. Opus 5.5, about $300 to $400: the best.
2. **Where the ~44,000 notes are kept** (about 50 MB, too big for git):
   **A. A data folder on SERVER, read by the advice route (recommended):** no database change, backed up with SERVER.
   B. A new database table: needs your typed OK and a migration, and uses about a tenth of the free database's space.
   C. In git: only Evelynn's notes, with the rest built when they're needed. Simplest, but grows with every patch.
