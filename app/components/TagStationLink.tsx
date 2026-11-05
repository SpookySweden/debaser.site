'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { findTag, wordsInText, type StationIndex } from '../lib/tag-station/query';
import type { LinkAnswer } from '../lib/tag-station/types';
import { rowAddresses, type ExtraHosts } from '../lib/web/row-addresses';
import { PLATFORM_LABELS } from '../lib/web/types';
import { webSessionHeaders } from '../lib/web/web-session';
import { STATION_KEY, Thumb, WordChip } from './TagStationParts';

export type LinkState = { link: string; answer: LinkAnswer | null; error: boolean };

/** Asks the server about a pasted link. The answer is only ever about this one link, and is forgotten when it changes. */
export function useLinkAnswer(link: string | null): LinkState | null {
  const [state, setState] = useState<LinkState | null>(null);
  useEffect(() => {
    if (link === null) return;
    let live = true;
    void (async () => {
      try {
        const headers = await webSessionHeaders();
        if (headers === null) throw new Error('signed out');
        const response = await fetch(`/api/tag-station/link?url=${encodeURIComponent(link)}`, { headers });
        if (!response.ok) throw new Error('refused');
        const answer = (await response.json()) as LinkAnswer;
        if (live) setState({ link, answer, error: false });
      } catch {
        if (live) setState({ link, answer: null, error: true });
      }
    })();
    return () => {
      live = false;
    };
  }, [link]);
  if (link === null) return null;
  return state !== null && state.link === link ? state : { link, answer: null, error: false };
}

/** The words a link lands on: its outside words that match the map, then map words its title or description mention. */
export function linkMapWords(index: StationIndex, answer: LinkAnswer | null): { matched: string[]; fromText: string[]; suggested: string[] } {
  if (answer === null || answer.outcome !== 'found') return { matched: [], fromText: [], suggested: [] };
  const matched = new Set<string>();
  const suggested: string[] = [];
  for (const { word } of answer.words) {
    const tag = findTag(index, word);
    if (tag !== null) matched.add(tag.name);
    else suggested.push(word);
  }
  const title = answer.item?.title ?? answer.card?.title ?? '';
  const fromText = wordsInText(index, `${title} ${answer.item?.description ?? ''}`).filter((word) => !matched.has(word));
  return { matched: [...matched], fromText, suggested };
}

const REFUSALS: Record<Exclude<LinkAnswer['outcome'], 'found'>, string> = {
  unknown: "DISCOVER DOESN'T KNOW LINKS FROM THERE.",
  'not-found': 'NOTHING AT THAT LINK.',
  'no-answer': 'THE PLATFORM DID NOT ANSWER. TRY AGAIN.',
};

/** The input panel with a link pasted. Nothing here is saved: the words are matched to the map and suggestions stay suggestions. */
export function LinkInput({
  index,
  state,
  extraHosts,
  onPick,
  onAdd,
  play,
}: {
  index: StationIndex;
  state: LinkState;
  extraHosts: ExtraHosts;
  onPick: (word: string) => void;
  onAdd: (word: string) => void;
  /** The play and open keys for a platform MEDIA can play. */
  play: (item: NonNullable<LinkAnswer['item']>) => ReactNode;
}) {
  const { answer, error } = state;
  const words = useMemo(() => linkMapWords(index, answer), [index, answer]);

  if (error) return <p className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">THE LINK COULD NOT BE READ. TRY AGAIN.</p>;
  if (answer === null) {
    return (
      <p role="status" className="text-prose text-ink">
        READING THE LINK...
      </p>
    );
  }
  if (answer.outcome !== 'found') return <p className="w-fit break-words bg-bubble-pale px-1 text-label text-ink-bar">{REFUSALS[answer.outcome]}</p>;

  const { item, card } = answer;
  const thumb = item ? rowAddresses(item, extraHosts).thumb : null;
  return (
    <div className="flex flex-col gap-2">
      {item ? <Thumb src={thumb} wide /> : null}
      <p className="break-words text-title font-bold text-ink">{item?.title ?? card?.title}</p>
      <p className="break-words text-label text-ink">
        {item ? `${PLATFORM_LABELS[item.platform]} · ${item.kind.toUpperCase()}` : card?.source}
        {item?.creator || card?.creator ? ` · ${item?.creator ?? card?.creator}` : ''}
      </p>
      <p className="text-label text-ink-quiet">NOT SAVED.</p>
      {item ? play(item) : null}
      {card ? (
        <a href={card.link} target="_blank" rel="noopener noreferrer nofollow" aria-label={`Open "${card.title}" on ${card.source} (new tab)`} className={STATION_KEY}>
          [ OPEN ↗ ]
        </a>
      ) : null}

      <h3 className="text-label font-bold text-ink-quiet">ON THE MAP</h3>
      {words.matched.length + words.fromText.length === 0 ? <p className="text-prose text-ink">NONE OF ITS WORDS ARE ON THE MAP YET.</p> : null}
      <ul className="flex flex-wrap gap-1">
        {words.matched.map((word) => (
          <li key={word}>
            <WordChip word={word} letter="L" letterLabel="the link's own word" onPick={onPick} onAdd={onAdd} />
          </li>
        ))}
        {words.fromText.map((word) => (
          <li key={word}>
            <WordChip word={word} letter="T" letterLabel="in its title or description" onPick={onPick} onAdd={onAdd} />
          </li>
        ))}
      </ul>

      {words.suggested.length > 0 ? (
        <>
          <h3 className="text-label font-bold text-ink-quiet">SUGGESTED, NOT ADDED</h3>
          <p className="break-words text-prose text-ink">{words.suggested.join(', ')}</p>
        </>
      ) : null}
    </div>
  );
}
