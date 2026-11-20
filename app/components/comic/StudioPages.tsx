'use client';

import { useRef, useState, type DragEvent } from 'react';
import { getComicRepository } from '../../lib/comic/repository';
import { chapterPages, chaptersOfVolume, cleanTitle, nextNumber, volumesInOrder, WORDS_MAX } from '../../lib/comic/rules';
import type { ComicChapter, ComicContents, ComicPage } from '../../lib/comic/types';
import { pageFileProblem, uploadPage } from '../../lib/comic/upload';
import { FIELD, FIELD_TIGHT, PLATE, PLATE_MAIN, PLATE_PRESSED, TITLE_BAR } from '../../lib/ui/controls';
import ComicPageImage from './ComicPageImage';

type Props = {
  contents: ComicContents;
  reload: () => Promise<void>;
  chapter: ComicChapter | null;
  onChapter: (id: string) => void;
};

type Upload = { key: string; name: string; fraction: number; state: 'waiting' | 'sending' | 'done' | 'failed'; error?: string };

function newId(): string {
  return crypto.randomUUID();
}

function problemOf(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

/**
 * The studio's PAGES (SPEC-comic.md): volumes and chapters, then the chosen chapter's pages. Pages are dropped in (or picked)
 * and go up one at a time, each with its own progress line; the server makes the copies and guesses the panels as each lands.
 * Order by dragging or by the arrow keys; SPREAD, COVER, WORDS, REPLACE and DELETE on each page.
 */
export default function StudioPages({ contents, reload, chapter, onChapter }: Props) {
  const repository = getComicRepository();
  const [problem, setProblem] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const volumes = volumesInOrder(contents);
  const pages = chapter ? chapterPages(contents, chapter.id) : [];

  const act = async (work: () => Promise<void>, fallback: string) => {
    setProblem(null);
    try {
      await work();
      await reload();
    } catch (caught) {
      setProblem(problemOf(caught, fallback));
    }
  };

  const addFiles = async (files: File[]) => {
    if (!chapter || files.length === 0 || busy) return;
    const list: Upload[] = files.map((file) => ({ key: newId(), name: file.name, fraction: 0, state: 'waiting', error: pageFileProblem(file) ?? undefined }));
    setUploads(list.map((each) => (each.error ? { ...each, state: 'failed' } : each)));
    setBusy(true);
    let position = pages.reduce((highest, page) => Math.max(highest, page.position), -1) + 1;
    // Files in the order of their names, so PAGE_01, PAGE_02 … land in order however they were picked.
    const ordered = files.map((file, index) => ({ file, upload: list[index] })).sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true }));
    for (const { file, upload } of ordered) {
      if (upload.error) continue;
      const set = (patch: Partial<Upload>) => setUploads((now) => now.map((each) => (each.key === upload.key ? { ...each, ...patch } : each)));
      set({ state: 'sending' });
      try {
        const pageId = newId();
        const uploaded = await uploadPage(file, { pageId, version: 1 }, (fraction) => set({ fraction }));
        await repository.savePage({ id: pageId, chapterId: chapter.id, position, uploaded, replacing: false });
        position += 1;
        set({ state: 'done', fraction: 1 });
        await reload();
      } catch (caught) {
        set({ state: 'failed', error: problemOf(caught, 'THAT PAGE COULD NOT BE UPLOADED.') });
      }
    }
    setBusy(false);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer.types.includes('application/x-comic-page')) return;
    void addFiles([...event.dataTransfer.files]);
  };

  const move = (from: number, to: number) => {
    if (!chapter || to < 0 || to >= pages.length || from === to) return;
    const ids = pages.map((page) => page.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    void act(() => repository.reorderPages(chapter.id, ids), 'THE ORDER COULD NOT BE SAVED.');
  };

  return (
    <div className="flex flex-col gap-3">
      {problem ? <p className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">{problem}</p> : null}

      <section aria-labelledby="studio-contents" className="flex flex-col gap-2">
        <h2 id="studio-contents" className={TITLE_BAR}>
          CONTENTS
        </h2>
        {volumes.map((volume) => (
          <div key={volume.id} className="flex flex-col gap-1">
            <NamedRow
              label={`VOLUME ${volume.number}`}
              number={volume.number}
              title={volume.title}
              onSave={(number, title) => act(() => repository.updateVolume(volume.id, { number, title }), 'THE VOLUME COULD NOT BE SAVED.')}
              onDelete={() => act(() => repository.deleteVolume(volume.id), 'THE VOLUME COULD NOT BE DELETED.')}
            />
            <ul className="flex flex-col gap-1 pl-4">
              {chaptersOfVolume(contents, volume.id).map((each) => (
                <li key={each.id} className="flex flex-wrap items-center gap-2">
                  <button type="button" aria-pressed={chapter?.id === each.id} onClick={() => onChapter(each.id)} className={chapter?.id === each.id ? PLATE_PRESSED : PLATE}>
                    {`[ CHAPTER ${each.number} ]`}
                  </button>
                  <NamedRow
                    label=""
                    number={each.number}
                    title={each.title}
                    onSave={(number, title) => act(() => repository.updateChapter(each.id, { number, title }), 'THE CHAPTER COULD NOT BE SAVED.')}
                    onDelete={() => act(() => repository.deleteChapter(each.id), 'THE CHAPTER COULD NOT BE DELETED.')}
                    confirmWord={contents.pages.some((page) => page.chapterId === each.id && page.releasedAt !== null) ? 'DELETE' : undefined}
                  />
                </li>
              ))}
              <li>
                <button
                  type="button"
                  className={PLATE}
                  onClick={() => act(() => repository.addChapter({ volumeId: volume.id, number: nextNumber(contents.chapters), title: '' }), 'THE CHAPTER COULD NOT BE ADDED.')}
                >
                  [ + CHAPTER ]
                </button>
              </li>
            </ul>
          </div>
        ))}
        <button
          type="button"
          className={`${PLATE} w-fit`}
          onClick={() => act(() => repository.addVolume({ number: nextNumber(contents.volumes), title: '' }), 'THE VOLUME COULD NOT BE ADDED.')}
        >
          [ + VOLUME ]
        </button>
      </section>

      {chapter ? (
        <section aria-labelledby="studio-pages" className="flex flex-col gap-2">
          <h2 id="studio-pages" className={TITLE_BAR}>
            {`CHAPTER ${chapter.number}: PAGES`}
          </h2>
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
            className="frame flex flex-wrap items-center gap-2 bg-paper p-3"
          >
            <span className="text-label text-ink">{busy ? 'SENDING PAGES…' : 'DROP PAGES HERE'}</span>
            <button type="button" className={PLATE_MAIN} disabled={busy} onClick={() => picker.current?.click()}>
              [ ADD PAGES ]
            </button>
            <input
              ref={picker}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/tiff"
              multiple
              className="hidden"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = '';
                void addFiles(files);
              }}
            />
          </div>
          {uploads.length > 0 ? (
            <ul className="flex flex-col gap-0.5">
              {uploads.map((upload) => (
                <li key={upload.key} className="flex flex-wrap gap-2 text-label text-ink">
                  <span className="min-w-0 truncate">{upload.name}</span>
                  {upload.state === 'sending' ? <span>{`${Math.round(upload.fraction * 100)}%${upload.fraction >= 1 ? ' · MAKING COPIES…' : ''}`}</span> : null}
                  {upload.state === 'waiting' ? <span>WAITING</span> : null}
                  {upload.state === 'done' ? <span>DONE</span> : null}
                  {upload.state === 'failed' ? <span className="bg-bubble-pale px-1 text-ink-bar">{upload.error ?? 'FAILED'}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {pages.length === 0 ? <p className="text-label text-ink">NO PAGES YET.</p> : null}
          <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {pages.map((page, index) => (
              <PageTile
                key={page.id}
                page={page}
                number={index + 1}
                count={pages.length}
                isCover={chapter.coverPageId === page.id}
                onMove={(to) => move(index, to)}
                onDropOn={(fromId) => move(pages.findIndex((each) => each.id === fromId), index)}
                act={act}
                chapter={chapter}
              />
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

/** A volume's or chapter's number and title, shown, or open for changing; and its DELETE (two presses, or a typed word). */
function NamedRow(props: {
  label: string;
  number: number;
  title: string;
  onSave: (number: number, title: string) => Promise<void>;
  onDelete: () => Promise<void>;
  confirmWord?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [number, setNumber] = useState(String(props.number));
  const [title, setTitle] = useState(props.title);
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState('');

  if (editing) {
    return (
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const n = Number(number);
          if (!Number.isInteger(n) || n < 1 || n > 9999) return;
          void props.onSave(n, cleanTitle(title)).then(() => setEditing(false));
        }}
      >
        <label className="flex items-center gap-1 text-label text-ink">
          NUMBER
          <input value={number} onChange={(event) => setNumber(event.target.value)} inputMode="numeric" className={`${FIELD_TIGHT} w-16`} />
        </label>
        <label className="flex items-center gap-1 text-label text-ink">
          TITLE
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} className={`${FIELD_TIGHT} w-64`} />
        </label>
        <button type="submit" className={PLATE}>
          [ SAVE ]
        </button>
        <button type="button" className={PLATE} onClick={() => setEditing(false)}>
          [ CANCEL ]
        </button>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {props.label.length > 0 ? <span className="text-label text-accent-ink">{props.label}</span> : null}
      <span className="text-label text-ink">{props.title.length > 0 ? props.title : 'NO TITLE'}</span>
      <button type="button" className={PLATE} onClick={() => setEditing(true)}>
        [ RENAME ]
      </button>
      {!asking ? (
        <button type="button" className={PLATE} onClick={() => setAsking(true)}>
          [ DELETE ]
        </button>
      ) : (
        <span className="flex flex-wrap items-center gap-1">
          {props.confirmWord ? (
            <label className="flex items-center gap-1 text-label text-ink">
              {`TYPE ${props.confirmWord}`}
              <input value={typed} onChange={(event) => setTyped(event.target.value)} className={`${FIELD_TIGHT} w-24`} />
            </label>
          ) : null}
          <button
            type="button"
            className={PLATE}
            disabled={props.confirmWord !== undefined && typed.trim().toUpperCase() !== props.confirmWord}
            onClick={() => void props.onDelete().then(() => setAsking(false))}
          >
            [ YES, DELETE ]
          </button>
          <button type="button" className={PLATE} onClick={() => setAsking(false)}>
            [ NO ]
          </button>
        </span>
      )}
    </div>
  );
}

function PageTile(props: {
  page: ComicPage;
  number: number;
  count: number;
  isCover: boolean;
  chapter: ComicChapter;
  onMove: (to: number) => void;
  onDropOn: (fromId: string) => void;
  act: (work: () => Promise<void>, fallback: string) => Promise<void>;
}) {
  const { page, number, chapter, act } = props;
  const repository = getComicRepository();
  const [words, setWords] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState('');
  const [replacing, setReplacing] = useState<string | null>(null);
  const replacer = useRef<HTMLInputElement>(null);
  const released = page.releasedAt !== null;

  const replace = async (file: File) => {
    setReplacing('0%');
    await act(async () => {
      const uploaded = await uploadPage(file, { pageId: page.id, version: page.version + 1 }, (fraction) => setReplacing(`${Math.round(fraction * 100)}%`));
      await repository.savePage({ id: page.id, chapterId: page.chapterId, position: page.position, uploaded, replacing: true });
    }, 'THE PAGE COULD NOT BE REPLACED.');
    setReplacing(null);
  };

  return (
    <li
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('application/x-comic-page', page.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('application/x-comic-page')) event.preventDefault();
      }}
      onDrop={(event) => {
        const fromId = event.dataTransfer.getData('application/x-comic-page');
        if (fromId.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        props.onDropOn(fromId);
      }}
      className="flex cursor-grab flex-col gap-1"
    >
      <ComicPageImage page={page} label={`PAGE ${number}`} className="frame overflow-hidden" />
      <div className="flex flex-wrap items-center gap-1 text-label text-ink">
        <span>{`P ${number}`}</span>
        {released ? <span className="text-accent-ink">OUT</span> : <span className="bg-bubble-pale px-1 text-ink-bar">QUEUED</span>}
        {props.isCover ? <span>COVER</span> : null}
        {replacing ? <span>{replacing}</span> : null}
      </div>
      <div className="flex flex-wrap gap-0.5">
        <button type="button" className={PLATE} aria-label={`MOVE PAGE ${number} EARLIER`} disabled={number === 1} onClick={() => props.onMove(number - 2)}>
          [ ◄ ]
        </button>
        <button type="button" className={PLATE} aria-label={`MOVE PAGE ${number} LATER`} disabled={number === props.count} onClick={() => props.onMove(number)}>
          [ ► ]
        </button>
        <button
          type="button"
          aria-pressed={page.isSpread}
          className={page.isSpread ? PLATE_PRESSED : PLATE}
          onClick={() => act(() => repository.updatePage(page.id, { isSpread: !page.isSpread }), 'THE PAGE COULD NOT BE SAVED.')}
        >
          [ SPREAD ]
        </button>
        <button
          type="button"
          aria-pressed={props.isCover}
          className={props.isCover ? PLATE_PRESSED : PLATE}
          onClick={() => act(() => repository.updateChapter(chapter.id, { coverPageId: props.isCover ? null : page.id }), 'THE COVER COULD NOT BE SAVED.')}
        >
          [ COVER ]
        </button>
        <button type="button" aria-expanded={words !== null} className={PLATE} onClick={() => setWords(words === null ? page.words : null)}>
          [ WORDS ]
        </button>
        <button type="button" className={PLATE} onClick={() => replacer.current?.click()}>
          [ REPLACE ]
        </button>
        <input
          ref={replacer}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/tiff"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void replace(file);
          }}
        />
        {!asking ? (
          <button type="button" className={PLATE} onClick={() => setAsking(true)}>
            [ DELETE ]
          </button>
        ) : null}
      </div>
      {asking ? (
        <div className="flex flex-wrap items-center gap-1">
          {released ? (
            <label className="flex items-center gap-1 text-label text-ink">
              TYPE DELETE
              <input value={typed} onChange={(event) => setTyped(event.target.value)} className={`${FIELD_TIGHT} w-24`} />
            </label>
          ) : null}
          <button
            type="button"
            className={PLATE}
            disabled={released && typed.trim().toUpperCase() !== 'DELETE'}
            onClick={() => act(() => repository.deletePage(page.id), 'THE PAGE COULD NOT BE DELETED.')}
          >
            [ YES, DELETE ]
          </button>
          <button type="button" className={PLATE} onClick={() => setAsking(false)}>
            [ NO ]
          </button>
        </div>
      ) : null}
      {words !== null ? (
        <form
          className="fold-body flex flex-col gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            void act(() => repository.updatePage(page.id, { words: words.slice(0, WORDS_MAX) }), 'THE WORDS COULD NOT BE SAVED.').then(() => setWords(null));
          }}
        >
          <label className="text-label text-ink">
            WORDS ON THIS PAGE
            <textarea value={words} onChange={(event) => setWords(event.target.value)} maxLength={WORDS_MAX} rows={4} className={FIELD} />
          </label>
          <span className="text-label text-ink">READABLE IN THE PAGE&apos;S CODE: NEVER A PUZZLE ANSWER.</span>
          <button type="submit" className={`${PLATE} w-fit`}>
            [ SAVE WORDS ]
          </button>
        </form>
      ) : null}
    </li>
  );
}
