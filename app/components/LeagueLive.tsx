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
import { isRiftQueue, QUEUE_NAMES, type LiveAnswer, type LivePlayer, type MatchupGuide } from '../lib/leaguebot/live-types';
import type { RegionId } from '../lib/leaguebot/regions';
import type { RiotId } from '../lib/leaguebot/riot-id';
import { championName, type StaticData } from '../lib/leaguebot/static-data';
import { rankText } from '../lib/leaguebot/types';
import { PLATE, TITLE_BAR } from '../lib/ui/controls';
import LeagueAdvice from './LeagueAdvice';
import LeagueIcon from './LeagueIcon';

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

function IconRow({ ids, lookup, label }: { ids: number[]; lookup: (id: number) => { name: string; icon: string } | undefined; label: string }) {
  if (ids.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 px-2 py-1">
      <span className="w-20 shrink-0 text-label text-ink">{label}</span>
      {ids.map((id, i) => {
        const entry = lookup(id);
        return (
          <span key={`${id}-${i}`} className="flex items-center gap-1 text-label text-ink">
            <LeagueIcon src={entry?.icon} name={entry?.name ?? String(id)} size="md" />
            <span className="hidden lg:inline">{entry?.name ?? ''}</span>
          </span>
        );
      })}
    </div>
  );
}

function Team({ title, id, players, me, data }: { title: string; id: string; players: LivePlayer[]; me: LivePlayer | null; data: StaticData | null }) {
  const parties = new Map<number, number>();
  for (const p of players) if (p.party !== null && p.party > 0) parties.set(p.party, (parties.get(p.party) ?? 0) + 1);
  return (
    <Section title={title} id={id}>
      <table className="w-full text-label text-ink">
        <thead>
          <tr className="text-left">
            <th scope="col" className="px-2 py-1 font-normal">PLAYER</th>
            <th scope="col" className="px-2 py-1 font-normal">RANK</th>
            <th scope="col" className="px-2 py-1 text-right font-normal" title="Games on this champion this season, and how many were won">
              CHAMP
            </th>
            <th scope="col" className="px-2 py-1 font-normal">MAIN</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => {
            const champion = data?.champions.get(p.championId);
            const duo = p.party !== null && (parties.get(p.party) ?? 0) >= 2;
            return (
              <tr key={`${p.team}-${p.championId}`} className={`rule-pixel ${p === me ? 'bg-sun-pale' : ''}`}>
                <th scope="row" className="px-2 py-1 text-left font-normal">
                  <span className="flex items-center gap-2">
                    <LeagueIcon src={champion?.icon} name={champion?.name ?? championName(data, p.championId)} size="md" />
                    <span className="flex flex-col gap-0.5">
                      {p.spells.map((s) => (
                        <LeagueIcon key={s} src={data?.spells.get(s)?.icon} name={data?.spells.get(s)?.name ?? 'Spell'} size="sm" />
                      )).slice(0, 2)}
                    </span>
                    {p.keystone ? <LeagueIcon src={data?.runes.get(p.keystone)?.icon} name={data?.runes.get(p.keystone)?.name ?? 'Keystone'} size="sm" /> : null}
                    <span className="min-w-0">
                      <span className="block truncate">{champion?.name ?? championName(data, p.championId)}</span>
                      <span className="block truncate">
                        {p.name}#{p.tag}
                        {p === me ? ' (YOU)' : ''}
                        {duo ? ' · DUO' : ''}
                      </span>
                    </span>
                  </span>
                </th>
                <td className="px-2 py-1">{p.rank ? rankText(p.rank.tier, p.rank.division, p.rank.lp) : 'UNRANKED'}</td>
                <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                  {p.championGames === null ? '—' : p.championGames === 0 ? 'FIRST' : (
                    <>
                      {p.championGames}G
                      <br />
                      {Math.round(((p.championWins ?? 0) / p.championGames) * 100)}%
                    </>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-1">
                  {p.lanes[0] ? LANE_WORDS[p.lanes[0].lane].toUpperCase() : '—'}
                  {p.onRole === false ? (
                    <>
                      <br />
                      OFF ROLE
                    </>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
      <div className="space-y-2 p-2" data-leaguebot-live="waiting">
        <p className="text-heading text-ink">{ended ? 'THE GAME HAS ENDED.' : 'NOT IN A GAME RIGHT NOW.'}</p>
        <p className="text-label text-ink">
          {ended
            ? 'Its review appears on REVIEW once U.GG has read it from Riot, usually within a few minutes. Press [ REFRESH ] above to fetch it.'
            : 'LEAGUEBOT finds the game once it has loaded (the loading screen), not during champ select: Riot hides the names there. This tab checks once a minute while it is open.'}
        </p>
        {error ? <p className="text-label text-ink">! {error}</p> : null}
        {answer?.notes.map((note) => (
          <p key={note} className="text-label text-ink">
            ! {note}
          </p>
        ))}
        <button type="button" className={PLATE} onClick={() => void check()} disabled={checking}>
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
  const rift = isRiftQueue(game.queueId);

  return (
    <div className="space-y-3" data-leaguebot-live="playing">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-2">
        <p className="text-display tabular-nums text-ink" aria-label={`Game time ${clockText(seconds)}`} data-leaguebot-clock>
          {clockText(seconds)}
        </p>
        <p className="text-label text-ink">
          IN A GAME · {QUEUE_NAMES[game.queueId] ?? `QUEUE ${game.queueId}`} · FROM {answer?.source}
          {me ? ` · YOU: ${name(me.championId).toUpperCase()}${me.lane ? `, ${LANE_WORDS[me.lane].toUpperCase()}` : ''}` : ''}
        </p>
        <button type="button" className={PLATE} onClick={() => void check()} disabled={checking}>
          {checking ? '[ CHECKING... ]' : '[ CHECK NOW ]'}
        </button>
      </div>
      {answer?.notes.map((note) => (
        <p key={note} className="px-2 text-label text-ink">
          ! {note}
        </p>
      ))}

      <div className="grid gap-x-4 gap-y-3 xl:grid-cols-2">
        <div className="min-w-0 space-y-3">
          {me && opponent ? (
            <Section title="YOUR LANE" id="lb-lane" note={`${name(me.championId)} against ${name(opponent.championId)}, from OP.GG's matchup guide`}>
              <div className="flex items-center gap-3 px-2 py-1.5">
                <LeagueIcon src={data?.champions.get(me.championId)?.icon} name={name(me.championId)} size="lg" />
                <span className="text-heading text-ink">VS</span>
                <LeagueIcon src={data?.champions.get(opponent.championId)?.icon} name={name(opponent.championId)} size="lg" />
                {guide ? (
                  <dl className="grid grid-cols-2 gap-x-4 text-label text-ink">
                    <dt>LANE FAVOURS</dt>
                    <dd>{guide.laneAdvantage === 'EVEN' ? 'NEITHER' : (guide.laneAdvantage ?? '—').toUpperCase()}</dd>
                    <dt>SOLO KILLS FAVOUR</dt>
                    <dd>{(guide.soloKillAdvantage ?? '—').toUpperCase()}</dd>
                    <dt>PLAY IT</dt>
                    <dd>{(guide.playStyle ?? '—').toUpperCase()}</dd>
                  </dl>
                ) : null}
              </div>
              {guide?.tip ? <p className="px-2 py-1 text-label text-ink">&gt; {guide.tip}</p> : null}
              {guide ? (
                <>
                  <IconRow ids={guide.spells} lookup={(i) => data?.spells.get(i)} label="SPELLS" />
                  <IconRow ids={guide.starter} lookup={(i) => data?.items.get(i)} label="START" />
                  <IconRow ids={[...guide.core, ...(guide.boots ? [guide.boots] : [])]} lookup={(i) => data?.items.get(i)} label="CORE" />
                  {guide.runes ? <IconRow ids={[...guide.runes.primary, ...guide.runes.secondary]} lookup={(i) => data?.runes.get(i)} label="RUNES" /> : null}
                  {guide.skills.length > 0 ? (
                    <p className="px-2 py-1 text-label text-ink">
                      <span className="inline-block w-20">SKILLS</span>
                      START {guide.skills.slice(0, 3).join(' ')} · MAX {maxOrder(guide.skills).join(' > ')}
                      {guide.skills.includes('R') ? ` · R AT ${guide.skills.flatMap((s, i) => (s === 'R' ? [i + 1] : [])).join(', ')}` : ''}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="px-2 py-1 text-label text-ink">{guideError ?? 'Reading the matchup guide...'}</p>
              )}
            </Section>
          ) : (
            <Section title="YOUR LANE" id="lb-lane">
              <p className="px-2 py-1 text-label text-ink">{me ? "The source didn't say who you face in lane." : "This player isn't on either team's list yet. Press [ CHECK NOW ] in a moment."}</p>
            </Section>
          )}

          <Section title="ADVICE" id="lb-live-advice" note="from the ten players' public records">
            <LeagueAdvice lines={advice} empty="NOTHING STANDS OUT ABOUT THE ENEMY TEAM." />
          </Section>

          {rift ? (
            <Section title="MATCH CLOCK" id="lb-clock" note="Summoner's Rift spawn times, patch 26.1 on">
              <ol className="px-2">
                {RIFT_SPAWNS.map((spawn) => {
                  const left = spawn.at - seconds;
                  return (
                    <li key={spawn.label} className="rule-pixel flex justify-between gap-2 py-1 text-label text-ink">
                      <span>
                        <span className="inline-block w-14 tabular-nums">{clockText(spawn.at)}</span>
                        {spawn.label}
                      </span>
                      <span className="tabular-nums">{left > 0 ? `IN ${clockText(left)}` : 'UP'}</span>
                    </li>
                  );
                })}
              </ol>
              <p className="px-2 pt-1 text-label text-ink">After a kill: dragon back in 5:00, Baron in 6:00. LEAGUEBOT can&apos;t see kills; only the start times are certain.</p>
            </Section>
          ) : null}
        </div>

        <div className="min-w-0 space-y-3">
          <Team title="YOUR TEAM" id="lb-allies" players={allies} me={me} data={data} />
          <Team title="ENEMY TEAM" id="lb-enemies" players={enemies} me={null} data={data} />
          {game.bans.length > 0 ? (
            <Section title="BANS" id="lb-bans">
              <div className="flex flex-wrap gap-1 px-2 py-1.5">
                {game.bans.map((ban, i) => (
                  <LeagueIcon key={`${ban}-${i}`} src={data?.champions.get(ban)?.icon} name={`${name(ban)} (banned)`} size="md" />
                ))}
              </div>
            </Section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
