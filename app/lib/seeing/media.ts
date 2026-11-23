/**
 * Found media to the Room (SPEC-seeing-machine.md, the ladder): what the Room would make of each thing a page has. Pure: the Room's own
 * reading of a link (`recognizeLink`, `queueRefusal`) decides, and nothing here needs a new player or queue.
 */
import { linkTitle, queueRefusal, recognizeLink } from '../watch/links';
import type { WatchLink } from '../watch/types';
import type { FoundMedia } from './engine';

/** 1: the platform's own player. 2: a file or a stream, proved in this browser before it goes. 5: plays on its own page only, and why. */
export type TrayItem = { key: string; title: string; site: string; kind: string; seconds: number | null } & ({ rung: 1 | 2; link: WatchLink } | { rung: 5; reason: string });

const KINDS: Record<string, string> = { file: 'VIDEO', hls: 'STREAM', dash: 'STREAM', youtube: 'YOUTUBE', vimeo: 'VIMEO', dailymotion: 'DAILYMOTION', twitch: 'TWITCH', embed: 'PLAYER', audio: 'SOUND', picture: 'PICTURE' };
const TRAY_MOST = 40;

/** `1:02:03`. */
export function lengthText(seconds: number): string {
  const whole = Math.round(seconds);
  const [hours, minutes, rest] = [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60];
  const two = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(rest)}` : `${minutes}:${two(rest)}`;
}

export function trayOf(found: readonly FoundMedia[]): TrayItem[] {
  const items: TrayItem[] = [];
  const seen = new Set<string>();
  for (const each of found) {
    let site: string;
    try {
      const url = new URL(each.address);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      site = url.hostname.replace(/^www\./, '');
    } catch {
      continue;
    }
    const base = { title: each.title === '' ? site : each.title, site, seconds: each.seconds };
    const verdict = recognizeLink(each.address);
    const refusal = verdict.ok ? queueRefusal(verdict.link) : verdict.reason;
    if (verdict.ok && refusal === null && verdict.link.kind !== 'picture') {
      if (seen.has(verdict.link.url)) continue;
      seen.add(verdict.link.url);
      const platform = ['youtube', 'vimeo', 'twitch', 'dailymotion', 'embed'].includes(verdict.link.kind);
      items.push({ ...base, key: verdict.link.url, kind: KINDS[verdict.link.kind] ?? 'VIDEO', rung: platform ? 1 : 2, link: { ...verdict.link, title: linkTitle(base.title, verdict.link.title) } });
    } else {
      // A player a page only frames, and that the Room does not know, is not media anybody asked to see here unless the page says it is one.
      if (each.from === 'player' || seen.has(each.address)) continue;
      seen.add(each.address);
      items.push({ ...base, key: each.address, kind: each.from === 'audio' ? 'SOUND' : 'VIDEO', rung: 5, reason: refusal ?? 'PLAYS ON ITS OWN PAGE ONLY' });
    }
  }
  return items.sort((a, b) => a.rung - b.rung).slice(0, TRAY_MOST);
}
