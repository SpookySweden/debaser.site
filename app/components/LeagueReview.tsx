'use client';

/**
 * LEAGUEBOT's REVIEW tab (SPEC-leaguebot.md, phase 3): the recent games as a list; one opens to the game against your lane
 * opponent minute by minute (gold, CS and XP at 10, 15 and 20, and a chart), what to change, your build and skill order,
 * the deaths and objectives in order, and all ten scoreboards. The detail is U.GG's alone.
 */

import { useEffect, useMemo, useState } from 'react';
import { LANE_WORDS } from '../lib/leaguebot/advice';
import { lookUpReview, LookupError } from '../lib/leaguebot/client';
import { clockText } from '../lib/leaguebot/live-advice';
import type { RegionId } from '../lib/leaguebot/regions';
import type { MatchReview, ReviewPlayer } from '../lib/leaguebot/review-types';
import { reviewAdvice } from '../lib/leaguebot/review-advice';
import { sameRiotId, type RiotId } from '../lib/leaguebot/riot-id';
import { championName, type StaticData } from '../lib/leaguebot/static-data';
import { line } from '../lib/leaguebot/stats';
import type { MatchSummary, SourceName } from '../lib/leaguebot/types';
import { PLATE, TITLE_BAR } from '../lib/ui/controls';
import LeagueAdvice from './LeagueAdvice';
import LeagueChart from './LeagueChart';
import LeagueIcon from './LeagueIcon';

const ago = (ms: number, now: number) => {
  const hours = Math.max(0, Math.round((now - ms) / 3_600_000));
  if (hours < 1) return 'JUST NOW';
  if (hours < 24) return `${hours} H AGO`;
  return `${Math.round(hours / 24)} D AGO`;
};

const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toLocaleString('en-GB')}`;

const EVENT_WORDS: Record<string, string> = { death: 'YOU DIED', kill: 'YOU KILLED', dragon: 'DRAGON', grubs: 'VOID GRUBS', herald: 'RIFT HERALD', baron: 'BARON', tower: 'TOWER' };

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

function Scoreboard({ title, id, players, me, data }: { title: string; id: string; players: ReviewPlayer[]; me: ReviewPlayer; data: StaticData | null }) {
  return (
    <Section title={title} id={id}>
      <table className="w-full text-label text-ink">
        <thead>
          <tr className="text-left">
            <th scope="col" className="px-2 py-1 font-normal">PLAYER</th>
            <th scope="col" className="px-2 py-1 text-right font-normal">K/D/A</th>
            <th scope="col" className="px-2 py-1 text-right font-normal">CS</th>
            <th scope="col" className="px-2 py-1 text-right font-normal">DAMAGE</th>
            <th scope="col" className="hidden px-2 py-1 font-normal 2xl:table-cell">ITEMS</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={`${p.team}-${p.championId}`} className={`rule-pixel ${sameRiotId(p, me) ? 'bg-sun-pale' : ''}`}>
              <th scope="row" className="px-2 py-1 text-left font-normal">
                <span className="flex items-center gap-2">
                  <LeagueIcon src={data?.champions.get(p.championId)?.icon} name={championName(data, p.championId)} size="sm" />
                  <span className="min-w-0 truncate">
                    {championName(data, p.championId)}
                    {sameRiotId(p, me) ? ' (YOU)' : ''}
                  </span>
                </span>
              </th>
              <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                {p.kills}/{p.deaths}/{p.assists}
              </td>
              <td className="px-2 py-1 text-right tabular-nums">{p.cs}</td>
              <td className="px-2 py-1 text-right tabular-nums">{p.damage.toLocaleString('en-GB')}</td>
              <td className="hidden px-2 py-1 2xl:table-cell">
                <span className="flex gap-0.5">
                  {p.items.filter((i) => i > 0).map((i, n) => (
                    <LeagueIcon key={`${i}-${n}`} src={data?.items.get(i)?.icon} name={data?.items.get(i)?.name ?? String(i)} size="sm" />
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function Detail({ review, data, usualOf }: { review: MatchReview; data: StaticData | null; usualOf: (championId: number) => ReturnType<typeof line> | null }) {
  const name = (id: number) => championName(data, id);
  const { me, opponent } = review;
  const advice = reviewAdvice(review, name, usualOf(me.championId));
  const marks = [10, 15, 20].map((minute) => review.frames.find((f) => f.minute === minute)).filter((f) => f !== undefined);
  const goldLine = review.frames.map((f) => ({ x: f.minute, y: f.gold[0] - f.gold[1] }));
  const firstBack = review.buys.findIndex((b) => b.atSec > 90);
  const start = firstBack < 0 ? review.buys : review.buys.slice(0, firstBack);
  const later = firstBack < 0 ? [] : review.buys.slice(firstBack);
  const allies = review.players.filter((p) => p.team === me.team);
  const enemies = review.players.filter((p) => p.team !== me.team);
  const mine = review.teams.find((t) => t.team === me.team);
  const theirs = review.teams.find((t) => t.team !== me.team);

  return (
    <div className="space-y-3" data-leaguebot-review-detail>
      <div className="flex flex-wrap items-center gap-3 px-2">
        <LeagueIcon src={data?.champions.get(me.championId)?.icon} name={name(me.championId)} size="lg" />
        <div>
          <p className="text-title text-ink">
            {review.win ? 'WIN' : 'LOSS'} · {name(me.championId).toUpperCase()} · {me.kills}/{me.deaths}/{me.assists}
          </p>
          <p className="text-label text-ink">
            {clockText(review.durationSec)} · {me.cs} CS · {me.gold.toLocaleString('en-GB')} GOLD · VISION {me.vision}
            {me.lane ? ` · ${LANE_WORDS[me.lane].toUpperCase()}` : ''}
            {opponent ? ` AGAINST ${name(opponent.championId).toUpperCase()}` : ''}
          </p>
          {mine && theirs ? (
            <p className="text-label text-ink">
              TEAMS: KILLS {mine.kills}-{theirs.kills} · TOWERS {mine.towers}-{theirs.towers} · DRAGONS {mine.dragons}-{theirs.dragons} · BARONS {mine.barons}-{theirs.barons}
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-x-4 gap-y-3 xl:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <Section title="WHAT TO CHANGE" id="lb-review-advice" note="from this game's numbers">
            <LeagueAdvice lines={advice} empty="A CLEAN GAME: NOTHING STANDS OUT." />
          </Section>

          {opponent && marks.length > 0 ? (
            <Section title="AGAINST YOUR LANE OPPONENT" id="lb-review-lane" note={`you against ${name(opponent.championId)}`}>
              <table className="w-full text-label text-ink">
                <thead>
                  <tr className="text-left">
                    <th scope="col" className="px-2 py-1 font-normal">AT</th>
                    <th scope="col" className="px-2 py-1 text-right font-normal">GOLD</th>
                    <th scope="col" className="px-2 py-1 text-right font-normal">CS</th>
                    <th scope="col" className="px-2 py-1 text-right font-normal">XP</th>
                  </tr>
                </thead>
                <tbody>
                  {marks.map((f) => (
                    <tr key={f.minute} className="rule-pixel">
                      <th scope="row" className="px-2 py-1 text-left font-normal">{f.minute}:00</th>
                      <td className="px-2 py-1 text-right tabular-nums">{signed(f.gold[0] - f.gold[1])}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{signed(f.cs[0] - f.cs[1])}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{signed(f.xp[0] - f.xp[1])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-2 pt-2 text-label text-ink">GOLD AHEAD (ABOVE THE LINE) OR BEHIND, EACH MINUTE</p>
              <LeagueChart series={[{ label: 'Gold difference', points: goldLine, tone: 'ink' }]} label="Gold ahead of or behind your lane opponent, each minute" yText={(y) => signed(Math.round(y))} xText={(x) => `${x}:00`} zero />
            </Section>
          ) : null}

          <Section title="YOUR BUILD" id="lb-review-build" note="in the order you bought it">
            <div className="flex flex-wrap items-center gap-1 px-2 py-1.5">
              <span className="w-16 shrink-0 text-label text-ink">START</span>
              {start.map((b, i) => (
                <LeagueIcon key={`s${i}`} src={data?.items.get(b.itemId)?.icon} name={data?.items.get(b.itemId)?.name ?? String(b.itemId)} size="md" />
              ))}
            </div>
            <ol className="flex flex-wrap gap-2 px-2 py-1.5" aria-label="Items bought after the start">
              {later.map((b, i) => (
                <li key={`b${i}`} className="flex flex-col items-center text-label text-ink">
                  <LeagueIcon src={data?.items.get(b.itemId)?.icon} name={data?.items.get(b.itemId)?.name ?? String(b.itemId)} size="md" />
                  <span className="tabular-nums">{clockText(b.atSec)}</span>
                </li>
              ))}
            </ol>
            {review.skills.length > 0 ? (
              <p className="px-2 py-1 font-mono text-label text-ink" aria-label={`Skill order: ${review.skills.join(' ')}`}>
                <span className="inline-block w-16 font-body">SKILLS</span>
                {review.skills.join(' ')}
              </p>
            ) : null}
          </Section>

          <Section title="TIMELINE" id="lb-review-timeline" note="your kills and deaths, and the objectives">
            <ol className="px-2">
              {review.events.map((e, i) => (
                <li key={i} className="rule-pixel flex gap-3 py-1 text-label text-ink">
                  <span className="w-12 shrink-0 tabular-nums">{clockText(e.atSec)}</span>
                  <span>
                    {e.kind === 'death' || e.kind === 'kill' ? (
                      <>
                        {EVENT_WORDS[e.kind]} {e.championId ? (e.kind === 'death' ? `(by ${name(e.championId)})` : name(e.championId)) : ''}
                      </>
                    ) : (
                      <>
                        {EVENT_WORDS[e.kind]} TAKEN{e.team === null ? '' : e.team === me.team ? ' BY YOUR TEAM' : ' BY THEIR TEAM'}
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <div className="min-w-0 space-y-3">
          <Scoreboard title="YOUR TEAM" id="lb-review-allies" players={allies} me={me} data={data} />
          <Scoreboard title="ENEMY TEAM" id="lb-review-enemies" players={enemies} me={me} data={data} />
        </div>
      </div>
    </div>
  );
}

export default function LeagueReview({
  id,
  region,
  matches,
  matchesSource,
  data,
}: {
  id: RiotId;
  region: RegionId;
  matches: MatchSummary[];
  matchesSource: SourceName | null;
  data: StaticData | null;
}) {
  const recent = useMemo(() => [...matches].sort((a, b) => b.at - a.at).slice(0, 20), [matches]);
  const [open, setOpen] = useState<MatchSummary | null>(null);
  const [review, setReview] = useState<MatchReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (open === null) return;
    let gone = false;
    lookUpReview(id, region, open.id, open.version).then(
      (next) => {
        if (!gone) setReview(next);
      },
      (failure: unknown) => {
        if (!gone) setError(failure instanceof LookupError ? failure.message : "Couldn't open this game. Try again in a minute.");
      },
    );
    return () => {
      gone = true;
    };
  }, [open, id, region]);

  const usualOf = (championId: number) => {
    const games = matches.filter((m) => m.championId === championId);
    return games.length > 0 ? line(games) : null;
  };

  if (matchesSource === 'OP.GG') {
    return <p className="p-2 text-label text-ink">THE GAME LIST CAME FROM OP.GG, WHICH HAS NO MINUTE-BY-MINUTE DETAIL. REVIEW OPENS ONCE U.GG ANSWERS AGAIN: PRESS [ REFRESH ].</p>;
  }

  if (open) {
    return (
      <div className="space-y-2" data-leaguebot-review="open">
        <div className="px-2">
          <button
            type="button"
            className={PLATE}
            onClick={() => {
              setOpen(null);
              setReview(null);
              setError(null);
            }}
          >
            [ ◄ ALL GAMES ]
          </button>
        </div>
        {review ? <Detail review={review} data={data} usualOf={usualOf} /> : <p className="p-2 text-label text-ink">{error ?? 'Reading the game from U.GG...'}</p>}
      </div>
    );
  }

  return (
    <section aria-labelledby="lb-review-list" data-leaguebot-review="list">
      <h3 id="lb-review-list" className={TITLE_BAR}>
        RECENT GAMES
      </h3>
      <p className="px-2 pt-1 text-label text-ink">RANKED SOLO, NEWEST FIRST. OPEN ONE FOR ITS REVIEW.</p>
      <ol className="px-2">
        {recent.map((game) => (
          <li key={game.id} className="rule-pixel">
            <button
              type="button"
              onClick={() => {
                setReview(null);
                setError(null);
                setOpen(game);
              }}
              className="flex w-full cursor-pointer items-center gap-3 py-1.5 text-left text-label text-ink hover:bg-sun-pale focus-visible:outline-2 focus-visible:outline-bubble"
            >
              <span className={`w-8 shrink-0 text-center font-mono ${game.win ? 'bg-sun text-ink-plate' : 'bg-ena text-ink-bar'}`}>{game.win ? 'W' : 'L'}</span>
              <LeagueIcon src={data?.champions.get(game.championId)?.icon} name={championName(data, game.championId)} size="md" />
              <span className="w-28 truncate">{championName(data, game.championId)}</span>
              <span className="w-20 tabular-nums">
                {game.kills}/{game.deaths}/{game.assists}
              </span>
              <span className="w-16 tabular-nums">{game.cs} CS</span>
              <span className="hidden w-16 tabular-nums sm:inline">{clockText(game.durationSec)}</span>
              <span className="hidden w-24 sm:inline">{game.lane ? LANE_WORDS[game.lane].toUpperCase() : ''}</span>
              <span className="ml-auto">{ago(game.at, now)}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
