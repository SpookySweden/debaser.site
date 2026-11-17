/**
 * The REVIEW tab's advice (SPEC-leaguebot.md, phase 3): what to change, from one game's numbers against the lane opponent
 * and against your own usual games on that champion. Rules, no AI (Luke's 9A). Each line says its number. Pure.
 */

import type { AdviceLine } from './advice';
import { clockText } from './live-advice';
import type { MatchReview, ReviewFrame } from './review-types';
import type { Line } from './stats';

const frameAt = (frames: ReviewFrame[], minute: number) => frames.find((f) => f.minute === minute) ?? null;
const n = (value: number) => value.toLocaleString('en-GB');

export function reviewAdvice(review: MatchReview, name: (championId: number) => string, usual: Line | null): AdviceLine[] {
  const lines: AdviceLine[] = [];
  const { me, opponent, frames } = review;
  const minutes = review.durationSec / 60;
  const them = opponent ? name(opponent.championId) : 'your lane opponent';
  const laner = me.lane === 'TOP' || me.lane === 'MID' || me.lane === 'BOTTOM';

  const at10 = frameAt(frames, 10);
  if (at10 && opponent && laner) {
    const diff = at10.cs[0] - at10.cs[1];
    if (diff <= -15) lines.push({ key: 'cs10', mark: '!', text: `${-diff} CS behind ${them} at 10 minutes (${at10.cs[0]} to ${at10.cs[1]}). Last hits first; trade only when their wave is pushing.`, weight: 80 + Math.min(20, -diff) });
    else if (diff >= 15) lines.push({ key: 'cs10', mark: '+', text: `${diff} CS ahead of ${them} at 10 minutes (${at10.cs[0]} to ${at10.cs[1]}).`, weight: 45 });
    const xp = at10.xp[0] - at10.xp[1];
    if (xp <= -600) lines.push({ key: 'xp10', mark: '!', text: `${n(-xp)} XP behind ${them} at 10 minutes: about a level down. Deaths and missed waves cost XP.`, weight: 60 });
  }

  const at15 = frameAt(frames, 15);
  if (at15 && opponent) {
    const diff = at15.gold[0] - at15.gold[1];
    if (diff <= -1000) lines.push({ key: 'gold15', mark: '!', text: `${n(-diff)} gold behind ${them} at 15 minutes.`, weight: 70 + Math.min(20, Math.round(-diff / 200)) });
    else if (diff >= 1000) lines.push({ key: 'gold15', mark: '+', text: `${n(diff)} gold ahead of ${them} at 15 minutes: you won the lane.`, weight: 50 });
  }

  const deaths = review.events.filter((e) => e.kind === 'death');
  const early = deaths.filter((e) => e.atSec < 600);
  if (early.length >= 2) {
    const by = early.map((e) => (e.championId ? `${clockText(e.atSec)} to ${name(e.championId)}` : clockText(e.atSec))).join(', ');
    lines.push({ key: 'early', mark: '!', text: `${early.length} deaths before 10:00 (${by}). Early deaths hand over the lane: respect their level 2 and 6.`, weight: 85 + early.length });
  }
  if (me.deaths >= 8) lines.push({ key: 'deaths', mark: '!', text: `${me.deaths} deaths. Look at when each one happened below: most come from walking where you couldn't see.`, weight: 65 + me.deaths });

  // The first trip home: the first bought item after the start.
  const firstBack = review.buys.find((b) => b.atSec > 90);
  if (firstBack && laner && firstBack.atSec > 9 * 60) {
    lines.push({ key: 'back', mark: '>', text: `First back at ${clockText(firstBack.atSec)}. An earlier back on a crashed wave, with gold for a component, keeps you level.`, weight: 40 });
  }

  if (minutes > 10) {
    const vision = me.vision / minutes;
    const floor = me.lane === 'SUPPORT' ? 1.8 : me.lane === 'JUNGLE' ? 1.0 : 0.7;
    if (vision < floor) lines.push({ key: 'vision', mark: '>', text: `Vision ${vision.toFixed(2)} a minute, ${review.wardsPlaced} wards placed. Buy a control ward every back.`, weight: 38 });
    const cs = me.cs / minutes;
    if (usual && usual.games >= 5 && laner && cs < usual.csPerMin - 1) {
      lines.push({ key: 'usual-cs', mark: '!', text: `CS ${cs.toFixed(1)} a minute, against your usual ${usual.csPerMin} on ${name(me.championId)} (${usual.games} games).`, weight: 55 });
    }
  }

  return lines.sort((a, b) => b.weight - a.weight).slice(0, 5);
}
