'use client';

/**
 * LEAGUEBOT LIVE's CHAMPION panel (SPEC-leaguebot-live-champs.md): any of the ten champions in the game, picked from the
 * team tables. Five parts: the matchup with your champion (Claude-written, ahead of time), their crowd control with Riot's
 * cooldowns at every rank and how to dodge each, all their abilities with Riot's icons, what this player builds on it in
 * their recent games, and how this player plays it. Their real ability ranks, items this game and live cooldowns can't be
 * seen from outside the match, so none are shown. Third-party and Claude text is plain text, never HTML.
 */

import { useEffect, useState } from 'react';
import type { AdviceLine } from '../lib/leaguebot/advice';
import { LANE_WORDS } from '../lib/leaguebot/advice';
import { modelWords, type CcNote, type PairAdvice } from '../lib/leaguebot/advice-notes';
import { loadChampionKit, perRank, type ChampionKit, type KitAbility } from '../lib/leaguebot/champion-kit';
import { lookUpAdvice, lookUpChampionGames, lookUpMatchup, LookupError } from '../lib/leaguebot/client';
import { laneOpponentOf } from '../lib/leaguebot/live-advice';
import type { LiveGame, LivePlayer, MatchupGuide } from '../lib/leaguebot/live-types';
import { FAULT } from '../lib/leaguebot/look';
import { CHAMPION_GAMES, playerChampAdvice, summarisePlayerChamp, type Share } from '../lib/leaguebot/player-champ';
import type { RegionId } from '../lib/leaguebot/regions';
import { championName, type StaticData } from '../lib/leaguebot/static-data';
import type { ChampionGamesAnswer } from '../lib/leaguebot/types';
import { TITLE_BAR } from '../lib/ui/controls';
import LeagueAdvice from './LeagueAdvice';
import LeagueIcon from './LeagueIcon';

function Part({ title, id, note, children }: { title: string; id: string; note?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="min-w-0">
      <h4 id={id} className={TITLE_BAR}>
        {title}
      </h4>
      {note ? <p className="px-2 pt-1 text-label text-ink">{note.toUpperCase()}</p> : null}
      {children}
    </section>
  );
}

const Waiting = ({ what }: { what: string }) => <p className="px-2 py-1 text-label text-ink">{what}</p>;
const Fault = ({ text }: { text: string }) => <p className={`${FAULT} mx-2 my-1`}>! {text}</p>;

/** Claude's lines in the advice log's look. */
const asAdvice = (lines: { mark: '!' | '+' | '>'; text: string }[]): AdviceLine[] => lines.map((line, i) => ({ key: `note-${i}`, mark: line.mark, text: line.text, weight: lines.length - i }));

/** The ability's numbers on one line: cooldown, cost and range at every rank. */
function abilityNumbers(a: KitAbility): string {
  const parts: string[] = [];
  if (a.cooldowns.length > 0) parts.push(`COOLDOWN ${perRank(a.cooldowns)} S`);
  if (a.costs.length > 0 && a.costWord) parts.push(`COST ${perRank(a.costs)} ${a.costWord}`);
  if (a.ranges.length > 0) parts.push(`RANGE ${perRank(a.ranges)}`);
  return parts.join(' · ');
}

/** One row of their crowd control: the ability, what it does, its cooldown at every rank, and how to dodge it. */
function CcRow({ ability, note }: { ability: KitAbility; note: CcNote | undefined }) {
  const kinds = note ? note.type : ability.cc.join(', ');
  return (
    <li className="rule-pixel flex gap-3 px-2 py-2">
      <LeagueIcon src={ability.icon} name={ability.name} size="md" decorative />
      <div className="min-w-0 space-y-0.5">
        <p className="text-label text-ink">
          {ability.key === 'P' ? 'PASSIVE' : ability.key} · {ability.name.toUpperCase()} · {kinds.toUpperCase()}
          {ability.cooldowns.length > 0 ? <span className="tabular-nums"> · COOLDOWN {perRank(ability.cooldowns)} S</span> : null}
        </p>
        {note ? (
          <p className="text-prose text-ink">
            <span aria-hidden="true" className="font-mono">
              &gt;{' '}
            </span>
            {note.dodge}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/** A labelled row of item icons with how many of the player's games each was in. */
function ShareRow({ label, shares, games, lookup }: { label: string; shares: Share[]; games: number; lookup: (id: number) => { name: string; icon: string } | undefined }) {
  if (shares.length === 0) return null;
  return (
    <div className="rule-pixel flex gap-3 px-2 py-1.5">
      <span className="w-16 shrink-0 pt-1.5 text-label text-ink">{label}</span>
      <ul className="flex min-w-0 flex-wrap gap-x-4 gap-y-1">
        {shares.map((s) => {
          const entry = lookup(s.id);
          return (
            <li key={s.id} className="flex items-center gap-2 text-label text-ink">
              <LeagueIcon src={entry?.icon} name={entry?.name ?? String(s.id)} size="md" decorative={entry !== undefined} />
              <span>
                {entry?.name ?? ''} <span className="tabular-nums">{s.games}/{games}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function LeagueChampion({ picked, me, game, region, data }: { picked: LivePlayer; me: LivePlayer | null; game: LiveGame; region: RegionId; data: StaticData | null }) {
  const champion = data?.champions.get(picked.championId);
  const champ = champion?.name ?? championName(data, picked.championId);
  const mine = me ? data?.champions.get(me.championId) : undefined;
  const side: PairAdvice['side'] = me === null || picked === me ? 'self' : picked.team === me.team ? 'with' : 'against';
  const playerSide = side === 'against' ? 'enemy' : side === 'with' ? 'ally' : 'self';
  const theirOpponent = laneOpponentOf(game, picked);

  const [kit, setKit] = useState<ChampionKit | null>(null);
  const [kitError, setKitError] = useState<string | null>(null);
  const [games, setGames] = useState<ChampionGamesAnswer | null>(null);
  const [gamesError, setGamesError] = useState<string | null>(null);
  const [advice, setAdvice] = useState<PairAdvice | null>(null);
  const [adviceError, setAdviceError] = useState<string | null>(null);
  const [usual, setUsual] = useState<MatchupGuide | null>(null);

  // LIVE gives each pick its own panel (a `key`), so a new pick starts empty and asks again; a late answer is dropped.
  useEffect(() => {
    let gone = false;
    if (data && champion) {
      loadChampionKit(data.patch, champion.alias).then(
        (next) => !gone && setKit(next),
        () => !gone && setKitError("Data Dragon didn't send this champion's abilities. Pick it again in a moment."),
      );
      const myAlias = mine?.alias ?? champion.alias;
      lookUpAdvice(myAlias, champion.alias, side).then(
        (next) => !gone && setAdvice(next),
        (failure: unknown) => !gone && setAdviceError(failure instanceof LookupError ? failure.message : "LEAGUEBOT's notes didn't load."),
      );
    }
    lookUpChampionGames({ name: picked.name, tag: picked.tag }, region, picked.championId).then(
      (next) => !gone && setGames(next),
      (failure: unknown) => !gone && setGamesError(failure instanceof LookupError ? failure.message : "This player's games didn't load."),
    );
    if (picked.lane && theirOpponent) {
      lookUpMatchup(picked.lane, picked.championId, theirOpponent.championId).then(
        (next) => !gone && setUsual(next),
        () => undefined,
      );
    }
    return () => {
      gone = true;
    };
    // Riot's data arriving (or a new patch) asks again; a new pick is a new panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.patch]);

  const summary = games?.matches ? summarisePlayerChamp(games.matches, picked.championId, (id) => data?.items.get(id)) : null;
  const lines = summary ? playerChampAdvice(summary, champ, playerSide) : [];
  const ccAbilities = kit ? kit.abilities.filter((a) => a.cc.length > 0 || advice?.cc?.some((c) => c.key === a.key)) : [];
  const who = side === 'self' ? 'YOUR CHAMPION' : side === 'with' ? 'ALLY' : 'ENEMY';
  const sample = summary ? `last ${summary.games} game${summary.games === 1 ? '' : 's'} on ${champ}` : '';

  return (
    <section aria-labelledby="lb-champ" className="min-w-0 space-y-4" data-leaguebot-champion={champion?.alias ?? picked.championId}>
      <h3 id="lb-champ" className={TITLE_BAR}>
        CHAMPION · {champ.toUpperCase()} · {who}
      </h3>
      <div className="flex flex-wrap items-center gap-4 px-2">
        <LeagueIcon src={champion?.icon} name={champ} size="lg" decorative />
        <div className="text-label text-ink">
          <p className="text-heading">{champ.toUpperCase()}</p>
          {kit?.title ? <p>{kit.title.toUpperCase()}</p> : null}
          <p>
            {picked.name}#{picked.tag}
            {picked.lane ? ` · ${LANE_WORDS[picked.lane].toUpperCase()}` : ''}
          </p>
        </div>
      </div>

      <div className="grid gap-x-5 gap-y-4 xl:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <Part
            title="MATCHUP"
            id="lb-champ-matchup"
            note={advice?.lines ? `written by ${modelWords(advice.model)} ahead of time${advice.patch ? `, patch ${advice.patch.split('.').slice(0, 2).join('.')}` : ''}` : undefined}
          >
            {side === 'self' ? (
              <Waiting what="YOUR OWN CHAMPION: PICK AN ALLY OR AN ENEMY IN THE TABLES ABOVE TO READ A MATCHUP." />
            ) : adviceError ? (
              <Fault text={adviceError} />
            ) : advice === null ? (
              <Waiting what="READING LEAGUEBOT'S NOTES..." />
            ) : advice.lines ? (
              <LeagueAdvice lines={asAdvice(advice.lines)} empty="" />
            ) : (
              <Waiting what={`NOT WRITTEN YET: THE NOTE FOR ${championName(data, me?.championId ?? 0).toUpperCase()} ${side === 'with' ? 'WITH' : 'AGAINST'} ${champ.toUpperCase()} ARRIVES AS LEAGUEBOT'S BATCHES REACH THEM.`} />
            )}
            {side === 'against' && theirOpponent === me && me !== null ? <p className="px-2 pt-1 text-label text-ink">OP.GG&apos;S GUIDE FOR YOUR LANE IS UNDER YOUR LANE, ABOVE.</p> : null}
          </Part>

          <Part title="CC & HOW TO DODGE" id="lb-champ-cc" note="cooldowns at every rank, from Riot's data: their ranks this game can't be seen">
            {kitError ? (
              <Fault text={kitError} />
            ) : kit === null ? (
              <Waiting what="READING THEIR ABILITIES..." />
            ) : ccAbilities.length === 0 ? (
              <Waiting what="NO CROWD CONTROL NAMED IN RIOT'S TEXT FOR THIS CHAMPION." />
            ) : (
              <ul>
                {ccAbilities.map((a) => (
                  <CcRow key={a.key} ability={a} note={advice?.cc?.find((c) => c.key === a.key)} />
                ))}
              </ul>
            )}
            {kit && advice && advice.cc === null && ccAbilities.length > 0 ? <p className="px-2 pt-1 text-label text-ink">DODGE LINES ARRIVE AS LEAGUEBOT&apos;S BATCHES REACH {champ.toUpperCase()}.</p> : null}
          </Part>
        </div>

        <div className="min-w-0 space-y-4">
          <Part title="THIS PLAYER" id="lb-champ-player" note={summary ? `${sample}, from ${games?.source}` : undefined}>
            {gamesError ? (
              <Fault text={gamesError} />
            ) : games === null ? (
              <Waiting what="READING THEIR RECENT GAMES..." />
            ) : summary === null ? (
              <>
                {games.notes.map((n) => (
                  <Fault key={n} text={n} />
                ))}
                <Waiting what={games.matches === null ? "THEIR GAMES COULDN'T BE READ RIGHT NOW." : `NO RECENT GAMES ON ${champ.toUpperCase()} FOUND FOR THIS PLAYER.`} />
              </>
            ) : (
              <>
                {games.notes.map((n) => (
                  <Fault key={n} text={n} />
                ))}
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-2 py-2 text-label text-ink">
                  <dt>FORM</dt>
                  <dd className="flex flex-wrap items-center gap-1">
                    <span className="sr-only">Newest first: </span>
                    {summary.form.map((w, i) => (
                      <span key={i} className={`w-6 text-center font-mono ${w ? 'bg-sun text-ink-plate' : 'bg-ena text-ink-bar'}`}>
                        <span aria-hidden="true">{w ? 'W' : 'L'}</span>
                        <span className="sr-only">{w ? 'Win' : 'Loss'}</span>
                      </span>
                    ))}
                    <span className="pl-2 tabular-nums">
                      {summary.wins}W {summary.games - summary.wins}L ({Math.round((summary.wins / summary.games) * 100)}%)
                    </span>
                  </dd>
                  <dt>KDA</dt>
                  <dd className="tabular-nums">
                    {summary.kills.toFixed(1)} / {summary.deaths.toFixed(1)} / {summary.assists.toFixed(1)}
                  </dd>
                  <dt>CS A MINUTE</dt>
                  <dd className="tabular-nums">{summary.csPerMin.toFixed(1)}</dd>
                  <dt>DAMAGE A MINUTE</dt>
                  <dd className="tabular-nums">{Math.round(summary.damagePerMin)}</dd>
                  <dt>KILL SHARE</dt>
                  <dd className="tabular-nums">{summary.killParticipation === null ? 'NOT GIVEN' : `${Math.round(summary.killParticipation)}%`}</dd>
                  <dt>VISION A MINUTE</dt>
                  <dd className="tabular-nums">{summary.visionPerMin === null ? 'NOT GIVEN' : summary.visionPerMin.toFixed(1)}</dd>
                  <dt>SHORT / LONG</dt>
                  <dd className="tabular-nums">
                    UNDER 25 MIN {summary.short.wins}W {summary.short.games - summary.short.wins}L · OVER {summary.long.wins}W {summary.long.games - summary.long.wins}L
                  </dd>
                  {summary.lane ? (
                    <>
                      <dt>USUAL LANE</dt>
                      <dd>{LANE_WORDS[summary.lane].toUpperCase()}</dd>
                    </>
                  ) : null}
                </dl>
                <LeagueAdvice lines={lines} empty="NOTHING STANDS OUT IN THESE GAMES." />
              </>
            )}
          </Part>

          <Part title="THEIR BUILD" id="lb-champ-build" note={summary ? `what this player finished in their ${sample}` : `their last ${CHAMPION_GAMES} games on it, once read`}>
            {summary ? (
              <>
                <ShareRow label="ITEMS" shares={summary.items.slice(0, 6)} games={summary.games} lookup={(i) => data?.items.get(i)} />
                <ShareRow label="BOOTS" shares={summary.boots.slice(0, 2)} games={summary.games} lookup={(i) => data?.items.get(i)} />
                <ShareRow label="KEYSTONE" shares={summary.keystones.slice(0, 2)} games={summary.games} lookup={(i) => data?.runes.get(i)} />
                {summary.spellPairs[0] ? (
                  <div className="rule-pixel flex gap-3 px-2 py-1.5">
                    <span className="w-16 shrink-0 pt-1.5 text-label text-ink">SPELLS</span>
                    <span className="flex flex-wrap items-center gap-2 text-label text-ink">
                      {summary.spellPairs[0].pair.map((s) => (
                        <span key={s} className="flex items-center gap-2">
                          <LeagueIcon src={data?.spells.get(s)?.icon} name={data?.spells.get(s)?.name ?? 'Summoner spell'} size="md" decorative={data?.spells.get(s) !== undefined} />
                          {data?.spells.get(s)?.name ?? ''}
                        </span>
                      ))}
                      <span className="tabular-nums">
                        {summary.spellPairs[0].games}/{summary.games}
                      </span>
                    </span>
                  </div>
                ) : null}
                {summary.items.length === 0 ? <Waiting what="NO FINISHED ITEMS IN THESE GAMES." /> : null}
              </>
            ) : games !== null || gamesError ? (
              <Waiting what="NO GAMES TO READ A BUILD FROM." />
            ) : (
              <Waiting what="READING THEIR RECENT GAMES..." />
            )}
            {usual && usual.core.length > 0 ? (
              <div className="rule-pixel flex gap-3 px-2 py-1.5">
                <span className="w-16 shrink-0 pt-1.5 text-label text-ink">USUAL</span>
                <span className="min-w-0 space-y-1">
                  <span className="block text-label text-ink">MOST PLAYED ON {champ.toUpperCase()} IN THIS LANE, FROM OP.GG</span>
                  <span className="flex flex-wrap gap-x-4 gap-y-1">
                    {[...usual.core, ...(usual.boots ? [usual.boots] : [])].map((id, i) => (
                      <span key={`${id}-${i}`} className="flex items-center gap-2 text-label text-ink">
                        <LeagueIcon src={data?.items.get(id)?.icon} name={data?.items.get(id)?.name ?? String(id)} size="md" decorative={data?.items.get(id) !== undefined} />
                        {data?.items.get(id)?.name ?? ''}
                      </span>
                    ))}
                  </span>
                </span>
              </div>
            ) : null}
          </Part>
        </div>
      </div>

      <Part title="ABILITIES" id="lb-champ-abilities" note={kit ? `from Riot's data, patch ${kit.patch.split('.').slice(0, 2).join('.')}` : undefined}>
        {kitError ? (
          <Fault text={kitError} />
        ) : kit === null ? (
          <Waiting what="READING THEIR ABILITIES..." />
        ) : (
          <ol>
            {kit.abilities.map((a) => (
              <li key={a.key} className="rule-pixel flex gap-3 px-2 py-2">
                <LeagueIcon src={a.icon} name={a.name} size="md" decorative />
                <div className="min-w-0 space-y-0.5">
                  <p className="text-label text-ink">
                    {a.key === 'P' ? 'PASSIVE' : a.key} · {a.name.toUpperCase()}
                    {a.cc.length > 0 ? ` · ${a.cc.join(', ').toUpperCase()}` : ''}
                  </p>
                  <p className="text-prose text-ink">{a.description}</p>
                  {abilityNumbers(a) ? <p className="text-label tabular-nums text-ink">{abilityNumbers(a)}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Part>
    </section>
  );
}
