'use client';

import { useState } from 'react';
import { chatImageUrl, type ImageResult, type ImageSearchKind } from '../lib/watch/chat-images';
import { webSessionHeaders } from '../lib/web/web-session';
import { FIELD_TIGHT, KEY_FOCUS, PLATE, PLATE_PRESSED } from '../lib/ui/controls';

const SOURCES: { kind: ImageSearchKind; label: string; placeholder: string; credit: string }[] = [
  { kind: 'image', label: '[ IMAGES ]', placeholder: 'SEARCH WIKIMEDIA COMMONS', credit: 'FREE IMAGES FROM WIKIMEDIA COMMONS. SHOWN FROM THERE, NOT COPIED.' },
  { kind: 'gif', label: '[ GIFS ]', placeholder: 'SEARCH GIPHY', credit: 'POWERED BY GIPHY. SHOWN FROM THERE, NOT COPIED.' },
  { kind: 'sticker', label: '[ STICKERS ]', placeholder: 'SEARCH GIPHY', credit: 'POWERED BY GIPHY. SHOWN FROM THERE, NOT COPIED.' },
];

type SearchState = { kind: 'idle' } | { kind: 'searching' } | { kind: 'found'; results: ImageResult[] } | { kind: 'failed'; reason: string };

/**
 * Find a profile picture (Luke, 2026-11-07), through the same server search the stream chat uses (`/api/watch/images`).
 * A pick only chooses: it lands in NEW above like any other picture, then `[ FILE AS Pn ]` files it and CROP works on it.
 * Hotlinked from the platform, as chat pictures are, so nothing is copied onto the site.
 */
export default function ProfilePictureSearch({ pendingSrc, onSelectSrc }: { pendingSrc: string | null; onSelectSrc: (src: string) => void }) {
  const [source, setSource] = useState<ImageSearchKind>('image');
  const [words, setWords] = useState('');
  const [state, setState] = useState<SearchState>({ kind: 'idle' });
  const current = SOURCES.find((entry) => entry.kind === source) ?? SOURCES[0];

  async function search(kind: ImageSearchKind, query: string) {
    if (query.trim().length === 0) return;
    setState({ kind: 'searching' });
    try {
      const headers = await webSessionHeaders();
      if (headers === null) {
        setState({ kind: 'failed', reason: 'LOG IN TO SEARCH.' });
        return;
      }
      const response = await fetch(`/api/watch/images?kind=${kind}&q=${encodeURIComponent(query.trim())}`, { headers });
      const answer = (await response.json().catch(() => null)) as { results?: ImageResult[]; error?: string } | null;
      if (!response.ok || answer === null || !Array.isArray(answer.results)) {
        setState({ kind: 'failed', reason: answer?.error ?? 'THE SEARCH DID NOT ANSWER. TRY AGAIN.' });
        return;
      }
      // Only links the site will draw are offered, whatever the server said.
      setState({ kind: 'found', results: answer.results.filter((result) => chatImageUrl(result.url) !== null && chatImageUrl(result.thumb) !== null) });
    } catch {
      setState({ kind: 'failed', reason: 'THE SEARCH DID NOT ANSWER. TRY AGAIN.' });
    }
  }

  return (
    <div className="mt-3">
      <p className="text-label font-bold text-ink">OR SEARCH:</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {SOURCES.map((entry) => (
          <button
            key={entry.kind}
            type="button"
            aria-pressed={entry.kind === source}
            className={entry.kind === source ? PLATE_PRESSED : PLATE}
            onClick={() => {
              setSource(entry.kind);
              if (words.trim().length > 0) void search(entry.kind, words);
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <form
        className="mt-1 flex items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          void search(source, words);
        }}
      >
        <label htmlFor="customise-picture-search" className="sr-only">
          Search for a picture
        </label>
        <input
          id="customise-picture-search"
          value={words}
          maxLength={80}
          onChange={(event) => setWords(event.target.value)}
          placeholder={current.placeholder}
          autoComplete="off"
          className={`${FIELD_TIGHT} min-w-0 flex-1`}
        />
        <button type="submit" className={PLATE} disabled={words.trim().length === 0 || state.kind === 'searching'}>
          [ FIND ]
        </button>
      </form>
      <div className="mt-1" role="status">
        {state.kind === 'searching' ? (
          <p className="text-label font-bold text-ink">SEARCHING...</p>
        ) : state.kind === 'failed' ? (
          <p className="w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">{state.reason}</p>
        ) : state.kind === 'found' ? (
          state.results.length === 0 ? (
            <p className="text-label font-bold text-ink">NOTHING FOUND.</p>
          ) : (
            <ul className="grid max-h-64 grid-cols-4 gap-1 overflow-y-auto sm:grid-cols-6" aria-label="Pictures found">
              {state.results.map((result) => {
                const chosen = pendingSrc === result.url;
                return (
                  <li key={result.id}>
                    <button
                      type="button"
                      onClick={() => onSelectSrc(result.url)}
                      aria-pressed={chosen}
                      aria-label={`Use ${result.title || 'this picture'}`}
                      title={result.title}
                      className={`relative block aspect-square w-full cursor-pointer overflow-hidden border border-ink bg-paper ${KEY_FOCUS} ${chosen ? 'outline-2 -outline-offset-2 outline-ink' : ''}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- hotlinked from GIPHY or Commons, never proxied or copied */}
                      <img src={result.thumb} alt="" loading="lazy" draggable={false} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                      {chosen ? (
                        <span aria-hidden="true" className="absolute left-0 top-0 bg-hardware px-1 text-label text-ink-bar">
                          ✓
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : null}
      </div>
      <p className="mt-1 text-label text-ink-quiet">{current.credit}</p>
    </div>
  );
}
