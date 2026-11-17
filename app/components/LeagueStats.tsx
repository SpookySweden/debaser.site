'use client';

/**
 * LEAGUEBOT's STATS tab (SPEC-leaguebot.md, phase 1): the long view of a player's ranked games. Advice first, then the
 * numbers it rests on: totals, recent form, the last 20 against the games before, LP over time, champions, lanes and the
 * lane opponents they lose to. Every number says what it is and how many games it comes from.
 */

import { useMemo } from 'react';
import { LANE_WORDS, statsAdvice } from '../lib/leaguebot/advice';
import { ladderText, ladderValue } from '../lib/leaguebot/ladder';
import { championName, type StaticData } from '../lib/leaguebot/static-data';
import { computeStats, type Line } from '../lib/leaguebot/stats';
import { rankText, type MatchSummary, type Profile, type SourceName } from '../lib/leaguebot/types';
import { TITLE_BAR } from '../lib/ui/controls';
import LeagueAdvice from './LeagueAdvice';
import LeagueChart from './LeagueChart';
import LeagueIcon from './LeagueIcon';

const pct = (rate: number) => `${Math.round(rate * 100)}%`;
const dash = (value: number | null, unit = '') => (value === null ? '—' : `${value}${unit}`);
const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function Section({ title, id, children, note }: { title: string; id: string; children: React.ReactNode; note?: string }) {
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

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 px-2 py-1.5">
      <dt className="text-label text-ink">{label}</dt>
      <dd className="text-heading tabular-nums text-ink">{value}</dd>
      {sub ? <dd className="text-label text-ink">{sub}</dd> : null}
    </div>
  );
}

const TREND_ROWS: { label: string; pick: (l: Line) => number | null; show: (v: number) => string; higherIsBetter: boolean }[] = [
  { label: 'Win rate', pick: (l) => l.winRate, show: pct, higherIsBetter: true },
  { label: 'KDA', pick: (l) => l.kda, show: (v) => v.toFixed(2), higherIsBetter: true },
  { label: 'Deaths a game', pick: (l) => l.deaths, show: (v) => v.toFixed(1), higherIsBetter: false },
  { label: 'CS a minute', pick: (l) => l.csPerMin, show: (v) => v.toFixed(1), higherIsBetter: true },
  { label: 'Gold a minute', pick: (l) => l.goldPerMin, show: (v) => String(v), higherIsBetter: true },
  { label: 'Vision a minute', pick: (l) => l.visionPerMin, show: (v) => v.toFixed(2), higherIsBetter: true },
  { label: 'Kill participation', pick: (l) => l.killParticipation, show: (v) => `${v}%`, higherIsBetter: true },
];

export default function LeagueStats({
  profile,
  matches,
  matchesSource,
  data,
}: {
  profile: Profile | null;
  matches: MatchSummary[];
  matchesSource: SourceName | null;
  data: StaticData | null;
}) {
  const stats = useMemo(() => computeStats(matches), [matches]);
  const name = (id: number) => championName(data, id);
  const advice = useMemo(() => statsAdvice(stats, (id) => championName(data, id)), [stats, data]);
  const icon = (id: number) => data?.champions.get(id)?.icon ?? null;
  const { all } = stats;
  const sample = `last ${all.games} ranked solo games${matchesSource ? `, from ${matchesSource}` : ''}`;

  const lpPoints = (profile?.lpHistory ?? []).map((p) => ({ x: Date.parse(p.at), y: ladderValue(p.tier, p.division, p.lp) }));
  const solo = profile?.ranks.find((r) => r.queue === 'SOLO');
  // Today's rank closes the line, dated at the newest game (the last time the LP moved).
  const newest = matches.reduce((latest, m) => Math.max(latest, m.at + m.durationSec * 1000), 0);
  const lastPoint = lpPoints[lpPoints.length - 1];
  if (solo?.tier && solo.lp !== null && lastPoint && newest > lastPoint.x) lpPoints.push({ x: newest, y: ladderValue(solo.tier, solo.division, solo.lp) });

  if (all.games === 0) {
    return <p className="p-2 text-label text-ink">NO RANKED SOLO GAMES FOUND FOR THIS PLAYER YET.</p>;
  }

  return (
    <div className="grid gap-x-4 gap-y-3 xl:grid-cols-2" data-leaguebot-stats>
      <div className="min-w-0 space-y-3">
        <Section title="ADVICE" id="lb-advice" note={`from your ${sample}`}>
          <LeagueAdvice lines={advice} empty="NOTHING STANDS OUT: KEEP DOING WHAT YOU'RE DOING." />
        </Section>

        <Section title="OVERVIEW" id="lb-overview" note={sample}>
          <dl className="grid grid-cols-2 sm:grid-cols-4">
            <Figure label="WIN RATE" value={pct(all.winRate)} sub={`${all.wins}W ${all.games - all.wins}L`} />
            <Figure label="KDA" value={all.kda.toFixed(2)} sub={`${all.kills}/${all.deaths}/${all.assists}`} />
            <Figure label="CS/MIN" value={all.csPerMin.toFixed(1)} />
            <Figure label="GOLD/MIN" value={String(all.goldPerMin)} />
            <Figure label="VISION/MIN" value={dash(all.visionPerMin)} />
            <Figure label="KILL PART." value={dash(all.killParticipation, '%')} />
            <Figure label="MIN A GAME" value={`${all.avgMinutes}`} />
            <Figure label="CHAMPIONS" value={String(stats.champions.length)} sub={`${stats.recentPool} IN THE LAST 20`} />
          </dl>
        </Section>

        <Section title="FORM" id="lb-form" note="newest on the left">
          <ol className="flex flex-wrap gap-1 px-2 py-1.5" aria-label={`Last ${stats.form.length} games: ${stats.form.filter(Boolean).length} won`}>
            {[...matches]
              .sort((a, b) => b.at - a.at)
              .slice(0, 20)
              .map((game) => (
                <li key={game.id} className="flex flex-col items-center gap-0.5" title={`${name(game.championId)}: ${game.win ? 'win' : 'loss'}, ${game.kills}/${game.deaths}/${game.assists}, ${day(game.at)}`}>
                  <LeagueIcon src={icon(game.championId)} name={name(game.championId)} size="md" />
                  <span className={`w-8 text-center font-mono text-label ${game.win ? 'bg-sun text-ink-plate' : 'bg-ena text-ink-bar'}`}>{game.win ? 'W' : 'L'}</span>
                </li>
              ))}
          </ol>
        </Section>

        {stats.before ? (
          <Section title="LATELY" id="lb-trend" note={`last ${stats.recent.games} games against the ${stats.before.games} before`}>
            <table className="w-full text-label text-ink">
              <thead>
                <tr className="text-left">
                  <th scope="col" className="px-2 py-1 font-normal">MEASURE</th>
                  <th scope="col" className="px-2 py-1 text-right font-normal">LAST {stats.recent.games}</th>
                  <th scope="col" className="px-2 py-1 text-right font-normal">BEFORE</th>
                  <th scope="col" className="px-2 py-1 text-right font-normal">CHANGE</th>
                </tr>
              </thead>
              <tbody>
                {TREND_ROWS.map((row) => {
                  const now = row.pick(stats.recent);
                  const then = stats.before ? row.pick(stats.before) : null;
                  if (now === null || then === null) return null;
                  const better = row.higherIsBetter ? now > then : now < then;
                  const same = Math.abs(now - then) < (row.label === 'Win rate' ? 0.01 : 0.05);
                  return (
                    <tr key={row.label} className="rule-pixel">
                      <th scope="row" className="px-2 py-1 text-left font-normal">{row.label}</th>
                      <td className="px-2 py-1 text-right tabular-nums">{row.show(now)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{row.show(then)}</td>
                      <td className="px-2 py-1 text-right">{same ? 'SAME' : better ? '▲ BETTER' : '▼ WORSE'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>
        ) : null}
      </div>

      <div className="min-w-0 space-y-3">
        {lpPoints.length >= 2 ? (
          <Section title="LP OVER TIME" id="lb-lp" note="ranked solo, this season, from OP.GG">
            <LeagueChart series={[{ label: 'LP', points: lpPoints, tone: 'ink' }]} label="Ranked solo LP over time" yText={ladderText} xText={day} />
          </Section>
        ) : null}

        {profile && profile.pastSeasons.length > 0 ? (
          <Section title="PAST SEASONS" id="lb-seasons" note="ranked solo, newest first">
            <ul className="flex flex-wrap gap-x-4 gap-y-1 px-2 py-1.5 text-label text-ink">
              {profile.pastSeasons.slice(0, 6).map((season) => (
                <li key={season.season}>{rankText(season.tier, season.division, season.lp)}</li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section title="CHAMPIONS" id="lb-champions" note={sample}>
          <table className="w-full text-label text-ink">
            <thead>
              <tr className="text-left">
                <th scope="col" className="px-2 py-1 font-normal">CHAMPION</th>
                <th scope="col" className="px-2 py-1 text-right font-normal">GAMES</th>
                <th scope="col" className="px-2 py-1 text-right font-normal">WIN</th>
                <th scope="col" className="px-2 py-1 text-right font-normal">KDA</th>
                <th scope="col" className="px-2 py-1 text-right font-normal">CS/MIN</th>
                <th scope="col" className="hidden px-2 py-1 text-right font-normal sm:table-cell">K.P.</th>
              </tr>
            </thead>
            <tbody>
              {stats.champions.slice(0, 10).map((c) => (
                <tr key={c.championId} className="rule-pixel">
                  <th scope="row" className="px-2 py-1 text-left font-normal">
                    <span className="flex items-center gap-2">
                      <LeagueIcon src={icon(c.championId)} name={name(c.championId)} size="sm" />
                      <span className="truncate">{name(c.championId)}</span>
                    </span>
                  </th>
                  <td className="px-2 py-1 text-right tabular-nums">{c.games}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{pct(c.winRate)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{c.kda.toFixed(2)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{c.csPerMin.toFixed(1)}</td>
                  <td className="hidden px-2 py-1 text-right tabular-nums sm:table-cell">{dash(c.killParticipation, '%')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="LANES" id="lb-lanes" note={sample}>
          <table className="w-full text-label text-ink">
            <thead>
              <tr className="text-left">
                <th scope="col" className="px-2 py-1 font-normal">LANE</th>
                <th scope="col" className="px-2 py-1 text-right font-normal">GAMES</th>
                <th scope="col" className="px-2 py-1 text-right font-normal">WIN</th>
                <th scope="col" className="px-2 py-1 text-right font-normal">KDA</th>
                <th scope="col" className="px-2 py-1 text-right font-normal">CS/MIN</th>
              </tr>
            </thead>
            <tbody>
              {stats.lanes.map((l) => (
                <tr key={l.lane} className="rule-pixel">
                  <th scope="row" className="px-2 py-1 text-left font-normal uppercase">{LANE_WORDS[l.lane]}</th>
                  <td className="px-2 py-1 text-right tabular-nums">{l.games}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{pct(l.winRate)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{l.kda.toFixed(2)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{l.csPerMin.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {stats.opponents.length > 0 ? (
          <Section title="HARDEST LANE OPPONENTS" id="lb-opponents" note="met at least twice">
            <table className="w-full text-label text-ink">
              <thead>
                <tr className="text-left">
                  <th scope="col" className="px-2 py-1 font-normal">AGAINST</th>
                  <th scope="col" className="px-2 py-1 font-normal">LANE</th>
                  <th scope="col" className="px-2 py-1 text-right font-normal">WON</th>
                </tr>
              </thead>
              <tbody>
                {stats.opponents.slice(0, 6).map((o) => (
                  <tr key={`${o.championId}:${o.lane}`} className="rule-pixel">
                    <th scope="row" className="px-2 py-1 text-left font-normal">
                      <span className="flex items-center gap-2">
                        <LeagueIcon src={icon(o.championId)} name={name(o.championId)} size="sm" />
                        <span className="truncate">{name(o.championId)}</span>
                      </span>
                    </th>
                    <td className="px-2 py-1 uppercase">{LANE_WORDS[o.lane]}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {o.wins} OF {o.games}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        ) : null}
      </div>
    </div>
  );
}
