'use client';

/**
 * LEAGUEBOT's LIVE tab (SPEC-leaguebot.md, phase 2): once the player's game has loaded, the ten players as the loading
 * screen shows them, the lane matchup from OP.GG's guide, notes on the enemy team, and a match clock counting with the game
 * for a second screen. While the tab is open and visible it asks once a minute until a game is found, then every two minutes
 * to notice the game ending. Nothing from inside the match is known here: no gold, items or cooldowns.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { LANE_WORDS } from '../lib/leaguebot/advice';
import { lookUpLive, lookUpMatchup, LookupError } from '../lib/leaguebot/client';
import { clockText, findMe, gameSeconds, laneOpponentOf, liveAdvice, RIFT_SPAWNS } from '../lib/leaguebot/live-advice';
import { isRiftGame, queueName, type LiveAnswer, type LivePlayer, type MatchupGuide } from '../lib/leaguebot/live-types';
import type { RegionId } from '../lib/leaguebot/regions';
import type { RiotId } from '../lib/leaguebot/riot-id';
import { championName, type StaticData } from '../lib/leaguebot/static-data';
import { FAULT } from '../lib/leaguebot/look';
import { rankText } from '../lib/leaguebot/types';
import { PLATE, PLATE_PRESSED, TITLE_BAR } from '../lib/ui/controls';
import LeagueChampion from './LeagueChampion';
import LeagueAdvice from './LeagueAdvice';
import LeagueIcon from './LeagueIcon';
import { explain } from '../lib/ui/explain';

const WAITING_EVERY_MS = 60_000;
const PLAYING_EVERY_MS = 120_000;

/** The order the basic abilities reach five points (`Q > E > W`), from a level-by-level skill order. */
export function maxOrder(skills: string[]): string[] {
  const points: Record<string, number> = { Q: 0, W: 0, E: 0 };
  const done: string[] = [];
  for (const skill of skills) {
    if (!(skill in points)) continue;
    points[skill] += 1;
    if (points[skill] === 5) done.push(skill);
  }
  for (const skill of ['Q', 'W', 'E']) if (!done.includes(skill)) done.push(skill);
  return done;
}

function useVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

function Section({ title, id, note, children }: { title: string; id: string; note?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="min-w-0">
      <h3 id={id} className={TITLE_BAR}>
        {title}
      </h3>
      {note ? <p className="px-2 pt-1 text-label text-ink">{note.toUpperCase()}</p> : null}
      {children}
    </section>
  );
}

/** A labelled row of Riot's icons, each with its name printed beside it (never a hover-only name). */
function IconRow({ ids, lookup, label }: { ids: number[]; lookup: (id: number) => { name: string; icon: string } | undefined; label: string }) {
  if (ids.length === 0) return null;
  return (
    <div className="rule-pixel flex gap-3 px-2 py-1.5">
      <span className="w-16 shrink-0 pt-1.5 text-label text-ink">{label}</span>
      <ul className="flex min-w-0 flex-wrap gap-x-4 gap-y-1">
        {ids.map((id, i) => {
          const entry = lookup(id);
          return (
            <li key={`${id}-${i}`} className="flex items-center gap-2 text-label text-ink">
              <LeagueIcon src={entry?.icon} name={entry?.name ?? String(id)} size="md" decorative={entry !== undefined} />
              <span>{entry?.name ?? ''}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One team as a full-width table: a player a line, the champion first, plain column names. */
/** Which player a pick means, kept across the minute's re-checks of the same game. */
const pickOf = (p: LivePlayer) => `${p.team}:${p.championId}:${p.name}#${p.tag}`;

function Team({ title, id, players, me, data, picked, onPick }: { title: string; id: string; players: LivePlayer[]; me: LivePlayer | null; data: StaticData | null; picked: string | null; onPick: (p: LivePlayer) => void }) {
  const parties = new Map<number, number>();
  for (const p of players) if (p.party !== null && p.party > 0) parties.set(p.party, (parties.get(p.party) ?? 0) + 1);
  return (
    <Section title={title} id={id} note="pick a champion to read it below">
      {/* A narrow screen scrolls the table inside its strip, never the page. */}
      <div className="overflow-x-auto">
        <table className="w-full text-label text-ink">
          <thead>
            <tr className="text-left">
              <th scope="col" className="px-2 py-1 font-normal">CHAMPION</th>
              <th scope="col" className="px-2 py-1 font-normal">PLAYER</th>
              <th scope="col" className="px-2 py-1 font-normal">RANK</th>
              <th scope="col" className="px-2 py-1 text-right font-normal">ON THIS CHAMPION</th>
              <th scope="col" className="px-2 py-1 font-normal">USUAL ROLE</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => {
              const champion = data?.champions.get(p.championId);
              const champ = champion?.name ?? championName(data, p.championId);
              const duo = p.party !== null && (parties.get(p.party) ?? 0) >= 2;
              const isMe = p === me;
              return (
                <tr key={`${p.team}-${p.championId}`} className={`rule-pixel ${isMe ? 'bg-pointed' : ''}`}>
                  <th scope="row" className="px-2 py-1.5 text-left font-normal">
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-pressed={picked === pickOf(p)}
                        aria-controls="lb-champ"
                        onClick={() => onPick(p)}
                        className={`flex items-center gap-2 ${picked === pickOf(p) ? `${PLATE_PRESSED} cursor-pointer` : PLATE}`}
                        {...explain('Reads this champion out below the two teams.', 'Their matchup, crowd control, the player on it, their build and abilities.')}
                      >
                        <LeagueIcon src={champion?.icon} name={champ} size="md" decorative />
                        <span className="whitespace-nowrap">{champ}</span>
                      </button>
                      <span className="flex gap-0.5 max-sm:hidden">
                        {p.spells.slice(0, 2).map((s) => (
                          <LeagueIcon key={s} src={data?.spells.get(s)?.icon} name={data?.spells.get(s)?.name ?? 'Summoner spell'} size="sm" />
                        ))}
                        {p.keystone ? <LeagueIcon src={data?.runes.get(p.keystone)?.icon} name={data?.runes.get(p.keystone)?.name ?? 'Keystone'} size="sm" /> : null}
                      </span>
                    </span>
                  </th>
                  <td className="px-2 py-1.5">
                    <span className="block max-w-48 truncate" title={`${p.name}#${p.tag}`}>
                      {p.name}
                      <span className="text-ink">#{p.tag}</span>
                    </span>
                    {isMe || duo ? (
                      <span className="block">
                        {isMe ? 'YOU' : ''}
                        {isMe && duo ? ' · ' : ''}
                        {duo ? 'DUO' : ''}
                      </span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">{p.rank ? rankText(p.rank.tier, p.rank.division, p.rank.lp) : 'UNRANKED'}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                    {p.championGames === null ? '—' : p.championGames === 0 ? 'FIRST GAME' : `${Math.round(((p.championWins ?? 0) / p.championGames) * 100)}% · ${p.championGames} GAMES`}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {p.lanes[0] ? LANE_WORDS[p.lanes[0].lane].toUpperCase() : '—'}
                    {p.onRole === false && p.lanes[0] ? ' · OFF ROLE' : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export default function LeagueLive({ id, region, data }: { id: RiotId; region: RegionId; data: StaticData | null }) {
  const visible = useVisible();
  const [answer, setAnswer] = useState<LiveAnswer | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [guide, setGuide] = useState<MatchupGuide | null>(null);
  const [guideError, setGuideError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [picked, setPicked] = useState<string | null>(null);
  const hadGame = useRef(false);
  const asked = useRef(0);
  const playing = useRef(false);

  const check = useCallback(async () => {
    const ticket = (asked.current += 1);
    setChecking(true);
    try {
      const next = await lookUpLive(id, region);
      // A slow answer never overwrites a newer one.
      if (ticket !== asked.current) return;
      playing.current = next.game !== null;
      setError(null);
      setAnswer(next);
      if (next.game) hadGame.current = true;
      else if (hadGame.current) {
        hadGame.current = false;
        setEnded(true);
      }
      setNow(Date.now());
    } catch (failure) {
      if (ticket !== asked.current) return;
      setError(failure instanceof LookupError ? failure.message : "Couldn't check. Trying again in a minute.");
    } finally {
      if (ticket === asked.current) setChecking(false);
    }
  }, [id, region]);

  // Ask at once, then once a minute while waiting and every two minutes while a game runs, only while the tab is visible.
  const inGame = answer?.game != null;
  useEffect(() => {
    if (!visible) return;
    let last = 0;
    // The first ask goes out a moment after the effect, as React prefers; then a one-second tick decides when to ask again.
    const first = window.setTimeout(() => {
      last = Date.now();
      void check();
    }, 0);
    const timer = window.setInterval(() => {
      const every = playing.current ? PLAYING_EVERY_MS : WAITING_EVERY_MS;
      if (Date.now() - last >= every) {
        last = Date.now();
        void check();
      }
    }, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [check, visible]);

  // The clock ticks once a second while there is a game.
  useEffect(() => {
    if (!inGame) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [inGame]);

  const game = answer?.game ?? null;
  const me = game ? findMe(game, id) : null;
  const opponent = game && me ? laneOpponentOf(game, me) : null;
  const guideKey = me && opponent && me.lane ? `${me.lane}:${me.championId}:${opponent.championId}` : null;

  useEffect(() => {
    if (guideKey === null || !me?.lane || !opponent) return;
    let gone = false;
    lookUpMatchup(me.lane, me.championId, opponent.championId).then(
      (next) => {
        if (!gone) {
          setGuide(next);
          setGuideError(null);
        }
      },
      (failure: unknown) => {
        if (!gone) setGuideError(failure instanceof LookupError ? failure.message : 'No guide for this matchup right now.');
      },
    );
    return () => {
      gone = true;
    };
    // Only a new matchup asks again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guideKey]);

  const name = (championId: number) => championName(data, championId);

  if (!game) {
    return (
      <div className="space-y-3 p-2" data-leaguebot-live="waiting">
        <div role="status" aria-live="polite" className="space-y-2">
          <p className="text-heading text-ink">{ended ? 'THE GAME HAS ENDED.' : 'NOT IN A GAME RIGHT NOW.'}</p>
          <p className="text-prose text-ink">
            {ended ? 'Its review is on REVIEW once U.GG has it, usually a few minutes: press [ REFRESH ] above.' : 'Found once the game loads, not in champ select (Riot hides the names there). Checked once a minute while this tab is open.'}
          </p>
          {error ? <p className={FAULT}>! {error}</p> : null}
          {answer?.notes.map((note) => (
            <p key={note} className={FAULT}>
              ! {note}
            </p>
          ))}
        </div>
        <button type="button" className={PLATE} onClick={() => void check()} disabled={checking} {...explain('Asks right now whether the game has started.', 'Instead of waiting: it already asks once a minute while this tab is on screen.')}>
          {checking ? '[ CHECKING... ]' : '[ CHECK NOW ]'}
        </button>
      </div>
    );
  }

  const seconds = gameSeconds(game, now);
  const advice = liveAdvice(game, me, name);
  const myTeam = me?.team ?? 100;
  const allies = game.players.filter((p) => p.team === myTeam);
  const enemies = game.players.filter((p) => p.team !== myTeam);
  const rift = isRiftGame(game);
  // Your own champion is picked first; a pick whose player has left the answer falls back to it.
  const pickedPlayer = game.players.find((p) => pickOf(p) === picked) ?? me ?? game.players[0] ?? null;

  return (
    <div className="space-y-4" data-leaguebot-live="playing">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-2">
        <p className="text-display tabular-nums text-ink" data-leaguebot-clock>
          <span className="sr-only">Game time </span>
          {clockText(seconds)}
        </p>
        <div role="status" aria-live="polite" className="text-label text-ink">
          <p>
            IN A GAME · {queueName(game.queueId)}
          </p>
          {me ? (
            <p>
              YOU: {name(me.championId).toUpperCase()}
              {me.lane ? `, ${LANE_WORDS[me.lane].toUpperCase()}` : ''} · FROM {answer?.source}
            </p>
          ) : null}
        </div>
        <button type="button" className={PLATE} onClick={() => void check()} disabled={checking} {...explain('Asks again right now about the game in progress.', 'Instead of waiting: it already asks every two minutes while this tab is on screen.')}>
          {checking ? '[ CHECKING... ]' : '[ CHECK NOW ]'}
        </button>
      </div>
      {answer?.notes.map((note) => (
        <p key={note} className={`${FAULT} mx-2`}>
          ! {note}
        </p>
      ))}

      <div className="grid gap-x-5 gap-y-4 xl:grid-cols-2">
        {me && opponent ? (
          <Section title="YOUR LANE" id="lb-lane" note={`${name(me.championId)} against ${name(opponent.championId)}, from OP.GG`}>
            <div className="flex flex-wrap items-center gap-4 px-2 py-2">
              <span className="flex items-center gap-2">
                <LeagueIcon src={data?.champions.get(me.championId)?.icon} name={name(me.championId)} size="lg" />
                <span className="text-heading text-ink">VS</span>
                <LeagueIcon src={data?.champions.get(opponent.championId)?.icon} name={name(opponent.championId)} size="lg" />
              </span>
              {guide ? (
                <dl className="text-label text-ink">
                  {[
                    ['LANE FAVOURS', guide.laneAdvantage === 'EVEN' ? 'NEITHER' : (guide.laneAdvantage ?? '—').toUpperCase()],
                    ['SOLO KILLS FAVOUR', (guide.soloKillAdvantage ?? '—').toUpperCase()],
                    ['PLAY IT', (guide.playStyle ?? '—').toUpperCase()],
                  ].map(([label, value]) => (
                    <div key={label} className="flex gap-3">
                      <dt className="w-36 shrink-0">{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
            {guide?.tip ? (
              <p className="flex gap-3 px-2 py-2 text-prose text-ink">
                <span aria-hidden="true" className="font-mono">
                  &gt;
                </span>
                <span>{guide.tip}</span>
              </p>
            ) : null}
            {guide ? (
              <>
                <IconRow ids={guide.spells} lookup={(i) => data?.spells.get(i)} label="SPELLS" />
                <IconRow ids={guide.starter} lookup={(i) => data?.items.get(i)} label="START" />
                <IconRow ids={[...guide.core, ...(guide.boots ? [guide.boots] : [])]} lookup={(i) => data?.items.get(i)} label="CORE" />
                {guide.runes ? <IconRow ids={[...guide.runes.primary, ...guide.runes.secondary]} lookup={(i) => data?.runes.get(i)} label="RUNES" /> : null}
                {guide.skills.length > 0 ? (
                  <p className="rule-pixel flex gap-3 px-2 py-2 text-label text-ink">
                    <span className="w-16 shrink-0">SKILLS</span>
                    <span>
                      START {guide.skills.slice(0, 3).join(' ')} · MAX {maxOrder(guide.skills).join(' > ')}
                      {guide.skills.includes('R') ? ` · R AT ${guide.skills.flatMap((s, i) => (s === 'R' ? [i + 1] : [])).join(', ')}` : ''}
                    </span>
                  </p>
                ) : null}
              </>
            ) : (
              <p className={guideError ? `${FAULT} mx-2` : 'px-2 py-1 text-label text-ink'}>{guideError ? `! ${guideError}` : 'READING THE MATCHUP GUIDE...'}</p>
            )}
          </Section>
        ) : (
          <Section title="YOUR LANE" id="lb-lane">
            <p className="px-2 py-1 text-label text-ink">{me ? "The source didn't say who you face in lane." : "This player isn't on either team yet. Press [ CHECK NOW ] in a moment."}</p>
          </Section>
        )}

        <div className="min-w-0 space-y-4">
          <Section title="ADVICE" id="lb-live-advice" note="from the ten players' public records">
            <LeagueAdvice lines={advice} empty="NOTHING STANDS OUT ABOUT THE ENEMY TEAM." />
          </Section>

          {rift ? (
            <Section title="MATCH CLOCK" id="lb-clock" note="spawn times, patch 26.1 on">
              <ol className="px-2">
                {RIFT_SPAWNS.map((spawn) => {
                  const left = spawn.at - seconds;
                  return (
                    <li key={spawn.label} className="rule-pixel flex justify-between gap-3 py-1.5 text-prose text-ink">
                      <span>
                        <span className="inline-block w-16 tabular-nums">{clockText(spawn.at)}</span>
                        {spawn.label}
                      </span>
                      <span className="tabular-nums">{left > 0 ? `IN ${clockText(left)}` : 'UP'}</span>
                    </li>
                  );
                })}
              </ol>
              <p className="px-2 pt-1 text-label text-ink">After a kill: dragon back in 5:00, Baron in 6:00. Kills can&apos;t be seen here.</p>
            </Section>
          ) : null}
        </div>
      </div>

      <Team title="YOUR TEAM" id="lb-allies" players={allies} me={me} data={data} picked={pickedPlayer ? pickOf(pickedPlayer) : null} onPick={(p) => setPicked(pickOf(p))} />
      <Team title="ENEMY TEAM" id="lb-enemies" players={enemies} me={null} data={data} picked={pickedPlayer ? pickOf(pickedPlayer) : null} onPick={(p) => setPicked(pickOf(p))} />
      {pickedPlayer ? <LeagueChampion key={pickOf(pickedPlayer)} picked={pickedPlayer} me={me} game={game} region={region} data={data} /> : null}
      {game.bans.length > 0 ? (
        <Section title="BANS" id="lb-bans">
          <ul className="flex flex-wrap gap-2 px-2 py-2">
            {game.bans.map((ban, i) => (
              <li key={`${ban}-${i}`}>
                <LeagueIcon src={data?.champions.get(ban)?.icon} name={`${name(ban)} (banned)`} size="md" />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
