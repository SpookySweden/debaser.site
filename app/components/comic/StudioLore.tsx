'use client';

import { useEffect, useState } from 'react';
import { getComicRepository } from '../../lib/comic/repository';
import type { ComicChapter, ComicContents, ComicPanel, LoreLink } from '../../lib/comic/types';
import { FIELD_TIGHT, PLATE, PLATE_PRESSED, TITLE_BAR } from '../../lib/ui/controls';
import ComicPageImage from './ComicPageImage';
import { pageInHand, StudioPagePicker } from './StudioPanels';

type Props = {
  contents: ComicContents;
  chapter: ComicChapter | null;
  onChapter: (id: string) => void;
  pageId: string | null;
  onPage: (id: string) => void;
};

/** Lore pages found by title, for tagging a panel or marking a CHARACTER. */
function useLoreSearch(): { query: string; setQuery: (value: string) => void; found: LoreLink[]; refresh: () => void } {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<LoreLink[]>([]);
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      void getComicRepository()
        .searchLore(query)
        .then((links) => {
          if (live) setFound(links);
        });
    }, 200);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query, count]);
  return { query, setQuery, found, refresh: () => setCount((value) => value + 1) };
}

/**
 * The studio's LORE (SPEC-comic.md, Q13, Q14): pick a panel, then the lore pages for the characters and places in it. Readers
 * see them as WHO in the panel's pane, and each lore page lists where it APPEARS IN (released pages only). Below, any lore
 * page can be marked a CHARACTER: it then shows the panel where the character first appears.
 */
export default function StudioLore(props: Props) {
  const held = pageInHand(props.contents, props.chapter, props.pageId);
  const [panels, setPanels] = useState<ComicPanel[]>([]);
  const [tags, setTags] = useState<Record<string, LoreLink[]>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const tagSearch = useLoreSearch();
  const characterSearch = useLoreSearch();
  const heldId = held?.page.id ?? null;

  useEffect(() => {
    if (heldId === null) return;
    let live = true;
    const repository = getComicRepository();
    void repository.panels([heldId]).then(async (found) => {
      if (!live) return;
      setPanels(found);
      const links = await repository.tags(found.map((panel) => panel.id));
      if (live) setTags(links);
    });
    return () => {
      live = false;
    };
  }, [heldId, count]);

  const run = async (work: () => Promise<void>) => {
    setProblem(null);
    try {
      await work();
      setCount((value) => value + 1);
      tagSearch.refresh();
      characterSearch.refresh();
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : 'THAT COULD NOT BE SAVED.');
    }
  };

  const panel = panels.find((each) => each.id === selected) ?? null;
  const panelTags = panel ? (tags[panel.id] ?? []) : [];

  return (
    <div className="flex flex-col gap-3">
      <StudioPagePicker {...props} />
      {problem ? <p className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">{problem}</p> : null}
      {held ? (
        <div className="flex flex-col gap-3 md:flex-row md:items-start">
          <div className="relative mx-auto w-full max-w-xl">
            <ComicPageImage page={held.page} label={`PAGE ${held.number}`} />
            {panels.map((each, index) => (
              <button
                key={each.id}
                type="button"
                aria-pressed={selected === each.id}
                aria-label={`PANEL ${index + 1}`}
                onClick={() => setSelected(selected === each.id ? null : each.id)}
                className={`comic-panel absolute cursor-pointer ${(tags[each.id]?.length ?? 0) > 0 ? 'comic-panel-lit' : ''} ${selected === each.id ? 'comic-panel-open' : ''}`}
                style={{ left: `${each.x * 100}%`, top: `${each.y * 100}%`, width: `${each.w * 100}%`, height: `${each.h * 100}%` }}
              >
                <span className="absolute left-0 top-0 bg-paper px-0.5 text-label text-ink">{index + 1}</span>
              </button>
            ))}
          </div>
          <section aria-labelledby="studio-who" className="flex w-full flex-col gap-2 md:w-80">
            <h2 id="studio-who" className={TITLE_BAR}>
              {panel ? `PANEL ${panels.indexOf(panel) + 1}: WHO` : 'WHO'}
            </h2>
            {panel === null ? <p className="text-label text-ink">PICK A PANEL.</p> : null}
            {panel ? (
              <>
                {panelTags.length === 0 ? <p className="text-label text-ink">NOBODY TAGGED.</p> : null}
                <ul className="flex flex-col gap-0.5">
                  {panelTags.map((link) => (
                    <li key={link.docId} className="flex items-center gap-1 text-label text-ink">
                      <span className="flex-1">{link.title}</span>
                      <button
                        type="button"
                        className={PLATE}
                        aria-label={`UNTAG ${link.title}`}
                        onClick={() => run(() => getComicRepository().setTags(panel.id, panelTags.filter((each) => each.docId !== link.docId).map((each) => each.docId)))}
                      >
                        [ × ]
                      </button>
                    </li>
                  ))}
                </ul>
                <label className="flex flex-col gap-1 text-label text-ink">
                  FIND A LORE PAGE
                  <input value={tagSearch.query} onChange={(event) => tagSearch.setQuery(event.target.value)} className={FIELD_TIGHT} />
                </label>
                <ul className="flex flex-col gap-0.5">
                  {tagSearch.found
                    .filter((link) => !panelTags.some((each) => each.docId === link.docId))
                    .map((link) => (
                      <li key={link.docId} className="flex items-center gap-1 text-label text-ink">
                        <span className="flex-1">{link.title}</span>
                        <button
                          type="button"
                          className={PLATE}
                          onClick={() => run(() => getComicRepository().setTags(panel.id, [...panelTags.map((each) => each.docId), link.docId]))}
                        >
                          [ + TAG ]
                        </button>
                      </li>
                    ))}
                </ul>
              </>
            ) : null}
          </section>
        </div>
      ) : null}

      <section aria-labelledby="studio-characters" className="flex flex-col gap-2">
        <h2 id="studio-characters" className={TITLE_BAR}>
          CHARACTERS
        </h2>
        <label className="flex flex-col gap-1 text-label text-ink sm:w-96">
          FIND A LORE PAGE
          <input value={characterSearch.query} onChange={(event) => characterSearch.setQuery(event.target.value)} className={FIELD_TIGHT} />
        </label>
        {characterSearch.found.length === 0 ? <p className="text-label text-ink">NO LORE PAGES FOUND.</p> : null}
        <ul className="flex flex-col gap-0.5 sm:w-96">
          {characterSearch.found.map((link) => (
            <li key={link.docId} className="flex items-center gap-1 text-label text-ink">
              <span className="flex-1">{link.title}</span>
              <button
                type="button"
                aria-pressed={link.isCharacter}
                className={link.isCharacter ? PLATE_PRESSED : PLATE}
                onClick={() => run(() => getComicRepository().setCharacter(link.docId, !link.isCharacter))}
              >
                [ CHARACTER ]
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
