# SPEC: LEAGUEBOT (League of Legends stats, scouting and advice; 2026-11-17)

Status: **written, waiting for Luke's OK.** Nothing is built and the database has not been touched. The one database
change (a private table for your Riot ID, below) waits for your typed OK in chat at build time, after
`npm run db:backup` and the dry run (`npm run db:push:dry`).

## Luke's words
> "the ability to enter your league username and use all available apis you can find for this to arrange a new module
> called "leaguebot" which can give you useful pregame and matchup etc advice on your current live game and if possible
> even live advice, also tracking the users statistics and giving advice better than the porofessor app"

> "i need all this without my own riot key and without a separate app, whats the best we can possibly do"

Interview answers (2026-11-17): **2A 3B 4C 5A 6A 7A 8A 9A 10A+B 11A**, with 4: "c-loop until all are built and looking
good, i want this proffesional looking". Question 1 (your Riot ID and server) was not answered: you type it in on your
first visit and it is saved to your account (3B).

| # | Question | Answer |
|---|---|---|
| 2 | Who can use it | **A. Anyone**, signed in or not, with any Riot ID |
| 3 | Where your Riot ID is kept | **B. On your account, private.** Visitors' Riot IDs stay in their own browser |
| 4 | Build order | **C first (long-term stats), then the live game and matchup, then the post-game review, building on until all three are built and look professional** (how that reads is under "Phases") |
| 5 | Match clock | **A. Yes:** a clock in step with your match, with spawn times and your power spikes |
| 6 | How advice looks | **A. A LEAGUEBOT window:** short plain-English lines, most important first, like a log |
| 7 | Riot's pictures | **A. Allowed** as a named exception: champion, item, rune and spell icons loaded from Riot's servers |
| 8 | Sources | **A. OP.GG's public app server first, U.GG's and OP.GG's site APIs for the live game and timelines**, risk accepted |
| 9 | Who writes advice | **A. Rules we write from the numbers.** No AI model, no key, no cost |
| 10 | Where it lives | **A and B: a LEAGUEBOT key on the top bar (/leaguebot) and a key on the side panel's shelf** |
| 11 | Out of scope | **A.** Anything during the match beyond the clock; champ select; ARAM, Arena, TFT; any score or ladder of our own |

## What is and isn't possible without a Riot key or a helper program
- **Possible (tested from Luke's desktop on 2026-11-17, keyless):** a Riot ID's rank, LP over time, recent matches with all
  ten players, a match's full detail with gold/CS/XP against the lane opponent minute by minute, item and skill order;
  the **live game** once it has loaded (the ten players' champions, spells, runes, ranks, usual roles, record on their
  champion, who queued together); champion builds, runes, counters and lane matchup guides.
- **Not possible:** anything inside a running match (gold, items, levels, cooldowns). Only the game's own local API on
  the player's PC has it, and a web page can't read it. **Champ select** is also out: Riot hides the names there and its
  policies forbid uncovering them.
- **The live help we can give:** the scouting from the loading screen on, and a match clock in step with the game (the
  live-game data says how long the match has run), for a second screen or a phone beside the game.

## Sources (tested 2026-11-17; full notes in the shared notes folder, `leaguebot-research.md`)
| Source | Used for | Fallback |
|---|---|---|
| **Data Dragon / Community Dragon** (Riot's public files) | champion, item, rune, spell names and icons; ability cooldowns; the current patch | none needed; cached per patch |
| **OP.GG's public app server** `mcp-api.op.gg/mcp` (OP.GG publishes it for outside apps; we send `client_app: "DEBASER_OS LEAGUEBOT"`) | profile, rank, LP history, champion pool, recent matches, a match's detail, builds, runes, counters, **lane matchup guides** | U.GG for profile, matches and ranks |
| **U.GG's site API** `u.gg/api` (GraphQL) | **live game**, longer match history (paged), match timelines (gold/CS/XP frames, item and skill path), LP timeline, your matchup records, last-ten form, recent roles | OP.GG for everything but timelines |
| **OP.GG's site API** `lol-api-summoner.op.gg` | Riot ID lookup and the **live game** | U.GG; this one also answers a browser directly, so the reader's own browser can ask it if our server is blocked |

**The terms, said plainly.** OP.GG's terms forbid "scraping or data mining" and copying or republishing its content
without written permission; that covers its site API. Its public app server is OP.GG's own offer to outside apps but sits
under the same general terms. U.GG's terms page refuses scripts, so it was not read; assume the same. **The risk:** a site
blocks us or asks us to stop. Then that part goes dark and the fallback takes over until we switch. Luke's game account
is not at risk: nothing touches the League client. Not yet tested: whether these sites refuse Vercel's address (the
first build step proves it, and the browser fallback covers OP.GG's live game). After the move to the home server, the
requests come from his home connection.

**Being a good guest:** answers are kept in the server's memory for a short while (a live-game check 60 seconds, a
profile 10 minutes, a finished match a day, Riot's files a patch), so ten people looking at one Riot ID make one request.
A source's own "update this profile" is asked only from a [ REFRESH ] key, at most once every two minutes per Riot ID.
Each visitor may make at most 20 lookups a minute. Nothing from these sources is saved to the database.

## Riot's rules (the line we stay inside)
- No champ select scouting (names are hidden there; Riot's policies forbid uncovering them).
- No score, rating or ladder of our own that ranks players (Riot forbids alternative ladders). U.GG's `threatLevel` and
  OP.GG's `op_score` are never shown.
- No enemy cooldown or summoner-spell timers, and nothing during the match beyond fixed public spawn times and the
  player's own plan.
- Riot's standard "not endorsed by Riot Games" notice sits at the foot of the window, copied word for word from
  riotgames.com/en/legal at build time. Non-commercial, as the fan-content terms require.
- Other players: only what the sources show anyone publicly; nothing about them is stored, and nobody can see who looked
  up whom.

## The art rule (7A)
Champion, item, rune and summoner-spell icons, and rank emblems, from Riot's Data Dragon / Community Dragon, loaded
straight from Riot's servers (never copied into `assets/`). The building session adds this to core.md's Asset Rules as a
fourth named exception, quoting Luke's 7A. Nothing else: no splash art, no drawn stand-ins.

**Charts:** LP over time and the gold/CS/XP lines are data charts drawn by code in token colours, not illustrations.
Saying OK to this SPEC says OK to that. (If you'd rather not, they fall back to text-character bars like `▁▃▅▇`.)

## Data stored (the one database change)
- **New table `user_league`**, one row per account: Riot name, tag, server, when it was saved. Row Level Security:
  only you can read, add, change or delete your row; nobody else sees it, not even on your profile. Written as a
  re-runnable migration. Needs Luke's typed OK at build time.
- Visitors (signed out): the Riot ID stays in their own browser (localStorage).
- Mock and Supabase versions as the house does (`mock-riot-id.ts`, `supabase-riot-id.ts`,
  `NEXT_PUBLIC_LEAGUEBOT_DATA_SOURCE`); the mock also serves recorded source answers so everything can be proved offline.
- You can look up any Riot ID without saving it. A [ FORGET ] key deletes your saved one.

## Where it lives and how it looks (6A, 10A+B)
- A **LEAGUEBOT** key on the top bar (`leaguebot` in `app/lib/ui/modules.ts`, `/leaguebot`), off until ticked in
  MODULOS and tagged WIP until all three phases are built; and a **LEAGUEBOT** key on the side panel's shelf beside READ.
- One LEAGUEBOT window in the house look (docs/design.md: Gnorp windows, flat sections, tokens only, nothing under
  13px, instant feedback, no easing). At the top: the Riot ID field, the server picker (EUW, EUNE, NA, KR, BR, LAN, LAS,
  OCE, TR, RU, JP, PH, SG, TH, TW, VN, ME), [ LOOK UP ]. Under it three tabs: **STATS**, **LIVE**, **REVIEW**.
- **Advice** is a log: short plain-English lines, most important first, each with a text-character mark
  (`!` a problem, `+` a strength, `>` a thing to try) and the number behind it (e.g. `> CS 5.8/min on Ahri; Emerald Ahri
  players average 7.1. Last-hitting under tower is the gap.`).
- **Professional** means: aligned columns with tabular numbers, every number labelled with its unit and sample size
  ("last 60 ranked games"), win/loss in the theme's success/danger tokens, champion icons at one size, empty and error
  states written out ("U.GG isn't answering; showing OP.GG's data"), and no clutter. Checked in every theme, dark first.

## Phases (4: C first, then building on until all three are built and look good)
Each phase ships through the house loop on its own (verify, checks, commit, push, deploy-status, read). Then the next
phase starts at once, without asking you again, and the last step is a polish pass across all three. **One reading to
confirm:** "c-loop until all are built" is read as **C first, then A, then B, then polish, all in one run**.

### Phase 1: STATS (long-term, the first useful version)
- Enter or recall your Riot ID; the header shows rank, LP, wins and losses this season, and hot or cold streak.
- **LP over time** (chart), this season and last.
- From your last ~100 ranked games (paged from U.GG, OP.GG as fallback), per champion and per role: games, win rate,
  KDA, CS/min, gold/min, vision/min, kill participation, average game length. Last 20 games against the 80 before (getting
  better or worse).
- **Your best and worst champions**, and the **lane opponents you lose to most** (your own records).
- **Advice log** from rules: the three to five most useful lines (e.g. one-trick or spread too thin, an off-role that
  costs you, a stat well under the average for your rank on that champion where the source gives one, tilt runs: losses
  after two losses in a row).

### Phase 2: LIVE + MATCHUP (+ the match clock)
- **[ SCOUT ]**: asks whether you're in a game; while the LIVE tab is open and visible it asks again every 60 seconds
  until a game is found (it stops when the tab is hidden).
- **The ten players** in two teams: champion, spells and runes (icons), rank, main role and whether they're on it, games
  and win rate on this champion, last-ten form, who queued together.
- **Your lane:** OP.GG's matchup guide (tips, runes, item timings) and the build and runes most played for your champion
  and lane, beside what you usually build.
- **Notes on the enemy team** from rules (e.g. a one-trick, an off-role jungler, a duo bot lane, a player on a losing run).
- **Match clock** (5A): counts from the game's start; dragon, void grubs, herald and baron spawn times (kept in one data
  file, checked against the patch notes at build time); your item timings from the guide. Once the game ends, a line
  offers its review.

### Phase 3: REVIEW (post-game)
- Recent games as a list; one opens to: result, KDA, CS, gold, vision; **gold, CS and XP against your lane opponent at
  10, 15 and 20 minutes** (chart); your item and skill order against the common build; how this game compares with your
  own averages.
- **Advice log:** three to five lines on what to change, from rules (e.g. behind 15 CS at 10, a late first back, a
  skill order that differs from the usual one for this matchup, low vision).

### Then: the polish pass
All three tabs side by side for consistency, the accessibility audit, a `code-reviewer` pass on the whole module, and
LEAGUEBOT loses its WIP tag.

## Out of scope (11A)
Anything during the match beyond the clock; champ select; ARAM, Arena, TFT and other games; any score or ranking of
our own; the companion speaking advice; an AI model; storing match data or other players' data.

## Code (for the building session)
- `app/lib/leaguebot/`: `regions.ts`, `sources/ddragon.ts`, `sources/opgg-mcp.ts`, `sources/ugg.ts`,
  `sources/opgg-site.ts` (each turns its answer into one shared shape in `types.ts`), `pick-source.ts` (order and
  fallback), `advice/*.ts` (pure rules, fed recorded answers by checks), `cache.ts`, `mock-riot-id.ts`,
  `supabase-riot-id.ts`.
- Server fetching through `app/lib/web/safe-fetch.ts` with these hosts allow-listed; the routes are `/api/leaguebot/*`;
  browser code never imports the fetching code.
- Third-party text (names, tips) is rendered as plain text, never HTML.

## Proofs
- Local, mock data: checks in `Temp/check-leaguebot-*.cjs` for each source's shaping (from recorded answers), the
  fallback order, every advice rule, the cache and rate limit, the Riot ID store (mock), and the window's render. Each
  check is watched failing before it is trusted.
- Local dev server with mock data at desktop width, every theme, dark first; capture plus audit.
- Live: `npm run deploy-status`, `npm run read` on `/leaguebot`, and once per phase a read of the deployed
  `/api/leaguebot/...` for a known Riot ID, which proves the sources answer Vercel's address. The table's Row Level
  Security gets one short live check after the migration.
- Not provable without a real match: the LIVE tab against a game you're in. It is proved with a recorded live game
  locally, and once live against any player who is in a game at that moment.
