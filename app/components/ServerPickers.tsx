'use client';

import { FIELD_TIGHT, PLATE_LARGE } from '../lib/ui/controls';
import { heldEpisodes, type MediaInfo } from '../lib/web/media-titles';
import { filmParts, type ServerPick } from '../lib/web/server-picks';

/** The 44px floor at every width, not only on a phone (Luke's eyesight). */
const BIG_KEY = `${PLATE_LARGE} min-h-tap`;
const BIG_KEY_ON = `${PLATE_LARGE} min-h-tap key-fill key-on [--key-fill:var(--color-ink)] text-paper`;
const PICKER = `${FIELD_TIGHT} min-h-tap text-title`;

/** The EPISODE picker's first option: every episode of the show (server-picks.ts `roomAddFor`). */
export const ALL_OPTION = 'all';

/**
 * A media-server title's choices (SPEC-media-servers.md), the same on the MEDIA page's row and in a room's queue browser: FILM
 * for a film series, and for a show WHOLE SERIES (where a server has a whole-series player), SEASON and EPISODE, the EPISODE list
 * opening with ALL, every episode of every season (Luke, 2026-11-08). Picking a season or an episode chooses that episode and lets
 * WHOLE SERIES and ALL go. Large pickers from the theme tokens, at least the 44px tap size.
 */
export default function ServerPickers({ media, pick, onPick, wholeOffered, title }: { media: MediaInfo; pick: ServerPick; onPick: (next: ServerPick) => void; wholeOffered: boolean; title: string }) {
  const parts = filmParts(media);
  const seasons = heldEpisodes(media);
  return (
    <>
      {parts ? (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 max-w-full flex-col text-label font-bold text-ink">
            FILM
            <select value={pick.partIndex} onChange={(event) => onPick({ ...pick, partIndex: Number(event.target.value) })} className={`${PICKER} max-w-full`} data-pick-film>
              {parts.map((film, index) => (
                <option key={film.id} value={index}>
                  {`${film.date ? `${film.date.slice(0, 4)} · ` : ''}${film.title}`}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {media.type === 'tv' && (seasons.size > 0 || wholeOffered) ? (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          {wholeOffered ? (
            <button type="button" onClick={() => onPick({ ...pick, whole: true, all: false })} aria-pressed={pick.whole} className={pick.whole ? BIG_KEY_ON : BIG_KEY} data-pick-whole>
              [ WHOLE SERIES ]
            </button>
          ) : null}
          {seasons.size > 0 ? (
            <>
              <label className="flex flex-col text-label font-bold text-ink">
                SEASON
                <select
                  value={pick.season}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    onPick({ ...pick, season: next, episode: seasons.get(next)?.[0], whole: false, all: false });
                  }}
                  aria-label={`Season of "${title}"`}
                  className={PICKER}
                  data-pick-season
                >
                  {[...seasons.keys()].map((value) => (
                    <option key={value} value={value}>
                      {`SEASON ${value}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col text-label font-bold text-ink">
                EPISODE
                <select
                  value={pick.all && !pick.whole ? ALL_OPTION : pick.episode}
                  onChange={(event) =>
                    event.target.value === ALL_OPTION
                      ? onPick({ ...pick, whole: false, all: true })
                      : onPick({ ...pick, episode: Number(event.target.value), whole: false, all: false })
                  }
                  aria-label={`Episode of "${title}", or all of them`}
                  className={PICKER}
                  data-pick-episode
                >
                  <option value={ALL_OPTION}>ALL (EVERY SEASON)</option>
                  {(pick.season === undefined ? [] : (seasons.get(pick.season) ?? [])).map((value) => (
                    <option key={value} value={value}>
                      {`EPISODE ${value}`}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
