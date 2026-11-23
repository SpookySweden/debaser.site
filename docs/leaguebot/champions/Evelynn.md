# Evelynn: LEAGUEBOT notes handoff

Written by `scripts/leaguebot-advice-batch.mjs` (SPEC-leaguebot-live-champs.md). The notes live on SERVER in
`I:\DEBASER\leaguebot-advice\Evelynn.json`; this file is the record and the place for hand notes. Re-running the script rewrites the
sections above HAND NOTES only.

## What was written
- Patch 16.23.1; own parts (CC, Arena) by claude-opus-5-5 on 2026-11-23, DEEP prompt.
- Matchups: 172 of 172 opponents from Evelynn's side; 172 ally notes.
- No answers about it waiting or refused now; every pair above passed the checks.

## Crowd control
- W (charm, slow): A point-and-click curse; the charm only triggers on her next attack or spell after a delay. Get out of range or behind minions before she lands that hit.

## ARENA (later)
Kept for the Arena support planned later (nothing for Arena is built yet; SPEC-leaguebot.md 11A stands until it starts).
- Duo partners: Leona, Nautilus, Lulu
- Your W charm only fires after its delay, so curse early in a round and let your partner's crowd control hold the target until it lands.
- R warps you backwards a long distance; on small Arena maps check what is behind you before casting so you don't warp into danger.
- Demon Shade's out-of-combat healing rarely triggers mid-round, so pick fights you can finish in one combo rather than trading.
- What Arena support will need: Arena queue ids in the live-game check, 2v2v2v2 teams in the LIVE tables (not two
  teams of five), augment data from Community Dragon (the cherry-augments file), and these duo notes per pair.

## The deep prompt
Evelynn got the DEEP brief (scripts/leaguebot-advice/prompt.mjs, deepBrief): 6 to 10 lines from Evelynn's side
covering kill threshold, gank or invade angle and what reveals stealth, the level 6 window, what punishes Evelynn, and when
behind; Opus 5.5 at high effort, six opponents a request. Reuse it for any champion with --champion X --deep.

## HAND NOTES

(none yet)
