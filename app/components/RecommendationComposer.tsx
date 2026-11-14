'use client';

import { useState, type DragEvent, type FormEvent } from 'react';
import { useLetter, useLettersOf } from '../lib/letters/store';
import { isWebAddress } from '../lib/letters/things';
import { LETTER_TITLE_MAX, type LetterThing } from '../lib/letters/types';
import {
  RECOMMENDATION_ITEMS_MAX,
  RECOMMENDATION_MESSAGE_MAX,
  RECOMMENDATION_PEOPLE_MAX,
  recommendationTitle,
} from '../lib/recommendations/types';
import { FIELD_TIGHT, PLATE, PLATE_MAIN, PLATE_PRESSED, TITLE_BAR } from '../lib/ui/controls';
import { searchEverywhere } from '../lib/web/everywhere-client';
import { rowAddresses } from '../lib/web/row-addresses';
import { useComms } from './CommsProvider';
import LetterStamp from './LetterStamp';
import type { Placement } from '../lib/letters/types';
import { letterCopy as copyOfLetter, lookOf, placesByThing } from '../lib/recommendations/send-letter';
import type { RecommendationLetter } from '../lib/recommendations/types';
import { useMusicLibrary } from './MusicLibraryProvider';
import { useMusicPlayer } from './MusicPlayerProvider';
import { parseWebTrackId } from '../lib/web/web-audio';
import ProfileName from './ProfileName';

type Source = 'pre' | 'letters' | 'playlists' | 'search';
type Dragged = { from: 'pre' | 'queue'; at: number };
const sameThing = (a: LetterThing, b: LetterThing) => a.kind === b.kind && a.ref === b.ref;

export type SendInput = { message: string; isPublic: boolean; things: LetterThing[]; to: string[]; title: string; letter: RecommendationLetter | null };

/** A whole letter added to the queue: its look, and where each of its things sat on its canvas, by `kind:ref`. */
type LetterCopy = Omit<RecommendationLetter, 'places'> & { placeOf: Record<string, Placement> };

/**
 * Making a recommendation (SPEC-recommendations.md), split as the stream queue is: on the right the PRE-LIST, filled from
 * two sources, YOUR LETTERS and SEARCH (MEDIA, or a pasted link), whose results take the list's place until BACK; on the
 * left YOUR QUEUE, the order it's sent in. Drag from right to left and up and down; [ ← ] [ ↑ ] [ ↓ ] [ × ] do the same for
 * keyboards and phones. Then a message, PUBLIC or people, and SEND.
 */
export default function RecommendationComposer({ me, onSend }: { me: string; onSend: (input: SendInput) => Promise<void> }) {
  const [queue, setQueue] = useState<LetterThing[]>([]);
  const [pre, setPre] = useState<LetterThing[]>([]);
  const [source, setSource] = useState<Source>('pre');
  const [message, setMessage] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [to, setTo] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [dragged, setDragged] = useState<Dragged | null>(null);

  const addToPre = (thing: LetterThing) => {
    setPre((held) => (held.some((each) => sameThing(each, thing)) || queue.some((each) => sameThing(each, thing)) ? held : [...held, thing]));
  };
  const toQueue = (at: number, slot = queue.length) => {
    const thing = pre[at];
    if (!thing || queue.length >= RECOMMENDATION_ITEMS_MAX) return;
    setPre((held) => held.filter((_, index) => index !== at));
    setQueue((held) => [...held.slice(0, slot), thing, ...held.slice(slot)]);
  };
  const move = (from: number, slot: number) => {
    setQueue((held) => {
      if (from < 0 || from >= held.length) return held;
      const next = [...held];
      const [thing] = next.splice(from, 1);
      next.splice(slot > from ? slot - 1 : slot, 0, thing);
      return next;
    });
  };
  /** A whole letter, less what was unticked, into the queue at once; its name becomes the message, so the title. */
  const [letterCopy, setLetterCopy] = useState<LetterCopy | null>(null);
  /** A whole letter (or a playlist), less what was unticked, into the queue at once; its name the title. A letter's look and
   *  its cards' spots come too, so the recommendation carries the letter itself (Luke, 2026-11-11). */
  const addLetter = (things: LetterThing[], name: string, copy?: LetterCopy) => {
    if (copy) setLetterCopy(copy);
    const fresh = things.filter((thing) => !queue.some((each) => sameThing(each, thing)));
    const room = RECOMMENDATION_ITEMS_MAX - queue.length;
    setQueue((held) => [...held, ...fresh.slice(0, room)]);
    setPre((held) => held.filter((each) => !fresh.some((thing) => sameThing(each, thing))));
    setMessage(name.slice(0, RECOMMENDATION_MESSAGE_MAX));
    setNote(fresh.length > room ? `ONLY ${room} FITTED: A RECOMMENDATION HOLDS ${RECOMMENDATION_ITEMS_MAX} THINGS.` : null);
  };
  const backToPre = (at: number) => {
    const thing = queue[at];
    setQueue((held) => held.filter((_, index) => index !== at));
    if (thing) setPre((held) => [...held, thing]);
  };

  const dropAt = (slot: number) => (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (dragged?.from === 'pre') toQueue(dragged.at, slot);
    if (dragged?.from === 'queue') move(dragged.at, slot);
    setDragged(null);
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    setNote(null);
    if (queue.length === 0) {
      setNote('PUT SOMETHING IN YOUR QUEUE FIRST.');
      return;
    }
    if (!isPublic && to.length === 0) {
      setNote('SEND IT TO SOMEONE, OR POST IT PUBLICLY.');
      return;
    }
    setBusy(true);
    // The letter's cards keep their spots; anything added beside them lands somewhere clear on its canvas.
    const letter: RecommendationLetter | null = letterCopy
      ? (() => {
          const { placeOf, ...look } = letterCopy;
          return copyOfLetter(look, queue, placeOf);
        })()
      : null;
    try {
      await onSend({ message: message.trim(), isPublic, things: queue, to, title: letter ? letter.name : recommendationTitle(message, queue), letter });
      setQueue([]);
      setLetterCopy(null);
      setMessage('');
      setTo([]);
      setIsPublic(false);
      setNote('SENT.');
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'The recommendation could not be sent.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void send(event)} className="flex flex-col gap-3 p-2">
      <div className="flex flex-col gap-3 md:flex-row">
        <section
          aria-label="Your queue"
          className="min-w-0 flex-1 border border-ink"
          onDragOver={(event) => event.preventDefault()}
          onDrop={dropAt(queue.length)}
        >
          <h3 className={TITLE_BAR}>YOUR QUEUE</h3>
          {queue.length === 0 ? <p className="p-2 text-label text-ink">DRAG THINGS HERE FROM THE PRE-LIST, OR PRESS ← ON ONE.</p> : null}
          <ol className="md:max-h-96 md:overflow-y-auto">
            {queue.map((thing, at) => (
              <li
                key={`${thing.kind}:${thing.ref}`}
                draggable
                onDragStart={() => setDragged({ from: 'queue', at })}
                onDragOver={(event) => event.preventDefault()}
                onDrop={dropAt(at)}
                className="rule-pixel flex cursor-grab items-center gap-1 px-1 py-1"
              >
                <span className="w-6 shrink-0 text-right text-label text-ink-quiet">{at + 1}</span>
                <span className="min-w-0 flex-1 truncate text-label text-queue-next-ink">{thing.title || thing.ref}</span>
                <button type="button" className={PLATE} aria-label={`Move "${thing.title}" up`} disabled={at === 0} onClick={() => move(at, at - 1)}>
                  [ ↑ ]
                </button>
                <button type="button" className={PLATE} aria-label={`Move "${thing.title}" down`} disabled={at === queue.length - 1} onClick={() => move(at, at + 2)}>
                  [ ↓ ]
                </button>
                <button type="button" className={PLATE} aria-label={`Take "${thing.title}" out of the queue`} onClick={() => backToPre(at)}>
                  [ × ]
                </button>
              </li>
            ))}
          </ol>
        </section>

        <section aria-label="Pre-list and sources" className="min-w-0 flex-1 border border-ink">
          <h3 className={TITLE_BAR}>PRE-LIST</h3>
          <div className="flex flex-wrap gap-1 p-1">
            <button type="button" onClick={() => setSource('letters')} className={source === 'letters' ? PLATE_PRESSED : PLATE}>
              [ YOUR LETTERS ]
            </button>
            <button type="button" onClick={() => setSource('playlists')} className={source === 'playlists' ? PLATE_PRESSED : PLATE}>
              [ YOUR PLAYLISTS ]
            </button>
            <button type="button" onClick={() => setSource('search')} className={source === 'search' ? PLATE_PRESSED : PLATE}>
              [ SEARCH ]
            </button>
            {source !== 'pre' ? (
              <button type="button" onClick={() => setSource('pre')} className={PLATE}>
                [ BACK TO THE PRE-LIST ({pre.length}) ]
              </button>
            ) : null}
          </div>
          {source === 'letters' ? <FromLetters me={me} onAdd={addToPre} onAddLetter={addLetter} /> : null}
          {source === 'playlists' ? <FromPlaylists onAdd={addToPre} onAddLetter={addLetter} /> : null}
          {source === 'search' ? <FromSearch onAdd={addToPre} /> : null}
          {source === 'pre' ? (
            <ol className="md:max-h-96 md:overflow-y-auto">
              {pre.length === 0 ? <li className="p-2 text-label text-ink">EMPTY. ADD THINGS FROM YOUR LETTERS OR A SEARCH.</li> : null}
              {pre.map((thing, at) => (
                <li
                  key={`${thing.kind}:${thing.ref}`}
                  draggable
                  onDragStart={() => setDragged({ from: 'pre', at })}
                  className="rule-pixel flex cursor-grab items-center gap-1 px-1 py-1"
                >
                  <button type="button" className={PLATE} aria-label={`Put "${thing.title}" at the end of your queue`} onClick={() => toQueue(at)}>
                    [ ← ]
                  </button>
                  <span className="min-w-0 flex-1 truncate text-label text-ink">{thing.title || thing.ref}</span>
                  <button type="button" className={PLATE} aria-label={`Take "${thing.title}" off the pre-list`} onClick={() => setPre((held) => held.filter((_, index) => index !== at))}>
                    [ × ]
                  </button>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      </div>

      <label className="flex flex-col gap-1 text-label text-ink">
        MESSAGE (ITS TITLE; LEFT BLANK, OR WITH ONE THING, THE THING&apos;S OWN TITLE IS)
        <input
          type="text"
          value={message}
          maxLength={RECOMMENDATION_MESSAGE_MAX}
          onChange={(event) => setMessage(event.target.value)}
          className={FIELD_TIGHT}
        />
      </label>
      {queue.length > 0 ? <p className="text-label text-ink-quiet">TITLE: {letterCopy ? letterCopy.name : recommendationTitle(message, queue)}</p> : null}
      {letterCopy ? (
        <p className="flex flex-wrap items-center gap-2 text-label text-ink">
          <LetterStamp letter={letterCopy} />
          <span>GOES AS A LETTER</span>
          <button type="button" className={PLATE} onClick={() => setLetterCopy(null)}>
            [ NOT AS A LETTER ]
          </button>
        </p>
      ) : null}

      <SendTo me={me} isPublic={isPublic} onPublic={setIsPublic} to={to} onTo={setTo} />

      <p className="flex flex-wrap items-center gap-2">
        <button type="submit" className={PLATE_MAIN} disabled={busy}>
          SEND
        </button>
        {note ? (
          <span role="status" className="text-label text-ink">
            {note}
          </span>
        ) : null}
      </p>
    </form>
  );
}

function SendTo({
  me,
  isPublic,
  onPublic,
  to,
  onTo,
}: {
  me: string;
  isPublic: boolean;
  onPublic: (on: boolean) => void;
  to: string[];
  onTo: (next: string[]) => void;
}) {
  const { accounts } = useComms();
  const people = accounts.filter((account) => account.id !== me);
  return (
    <fieldset className="border border-ink p-2">
      <legend className="px-1 text-label text-ink">SEND TO</legend>
      <label className="flex items-center gap-2 text-label text-ink">
        <input type="checkbox" checked={isPublic} onChange={(event) => onPublic(event.target.checked)} />
        PUBLIC: ON THE PUBLIC TAB AND IN THE FORUM, FOR EVERYONE
      </label>
      <p className="mt-2 text-label text-ink">AND / OR THESE PEOPLE ({to.length} OF AT MOST {RECOMMENDATION_PEOPLE_MAX}):</p>
      <ul className="mt-1 grid max-h-48 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
        {people.map((person) => {
          const picked = to.includes(person.id);
          return (
            <li key={person.id}>
              <label className="flex items-center gap-2 text-label">
                <input
                  type="checkbox"
                  checked={picked}
                  disabled={!picked && to.length >= RECOMMENDATION_PEOPLE_MAX}
                  onChange={() => onTo(picked ? to.filter((id) => id !== person.id) : [...to, person.id])}
                />
                <ProfileName author={{ id: person.id, displayName: person.displayName }} />
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function FromLetters({
  me,
  onAdd,
  onAddLetter,
}: {
  me: string;
  onAdd: (thing: LetterThing) => void;
  onAddLetter: (things: LetterThing[], name: string, copy?: LetterCopy) => void;
}) {
  const letters = useLettersOf(me);
  const [letterId, setLetterId] = useState<string | null>(null);
  const { items } = useLetter(letterId);
  const chosen = (letters.value ?? []).find((letter) => letter.id === letterId);
  if (letterId === null) {
    return (
      <ul className="p-1">
        {letters.loading && letters.value === null ? <li className="text-label text-ink">READING YOUR LETTERS...</li> : null}
        {!letters.loading && (letters.value ?? []).length === 0 ? <li className="text-label text-ink">NO LETTERS YET: MAKE ONE ON YOUR PROFILE.</li> : null}
        {(letters.value ?? []).map((letter) => (
          <li key={letter.id}>
            <button type="button" onClick={() => setLetterId(letter.id)} className={`${PLATE} w-full text-left`}>
              [ {letter.name} ]
            </button>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="p-1">
      <button type="button" onClick={() => setLetterId(null)} className={PLATE}>
        [ ALL LETTERS ]
      </button>
      <WholeLetter
        key={letterId}
        name={chosen?.name ?? 'LETTER'}
        things={(items.value ?? []).map((item) => ({ kind: item.kind, ref: item.ref, title: item.title, picture: item.picture }))}
        onAdd={onAdd}
        onAddLetter={(things, name) =>
          onAddLetter(
            things,
            name,
            chosen ? { ...lookOf(chosen), placeOf: placesByThing(items.value ?? []) } : undefined,
          )
        }
      />
    </div>
  );
}

/**
 * Your music playlists as a source (Luke: "searching through your letters / playlists etc"): pick one, and it's a block
 * like a letter, every song ticked, the playlist's name the title. A site song goes in as its file, a MEDIA track as its
 * MEDIA row, a video kept in a room's saved queue as its link.
 */
function FromPlaylists({ onAdd, onAddLetter }: { onAdd: (thing: LetterThing) => void; onAddLetter: (things: LetterThing[], name: string) => void }) {
  const { playlists } = useMusicLibrary();
  const { queue } = useMusicPlayer();
  const [listId, setListId] = useState<string | null>(null);
  const list = playlists.find((each) => each.id === listId);
  if (!list) {
    return (
      <ul className="p-1">
        {playlists.length === 0 ? <li className="text-label text-ink">NO PLAYLISTS YET: MAKE ONE FROM A SONG&apos;S MENU.</li> : null}
        {playlists.map((each) => (
          <li key={each.id}>
            <button type="button" onClick={() => setListId(each.id)} className={`${PLATE} w-full text-left`}>
              [ {each.name} ({each.items.length}) ]
            </button>
          </li>
        ))}
      </ul>
    );
  }
  const things = list.items
    .map((item): LetterThing | null => {
      const link = item.link;
      if (link && isWebAddress(link.url) && !link.url.startsWith('/')) return { kind: 'link', ref: link.url, title: (link.title || link.url).slice(0, LETTER_TITLE_MAX) };
      const track = queue.find((each) => each.id === item.trackId);
      const title = (track?.title ?? link?.title ?? 'A SONG').slice(0, LETTER_TITLE_MAX);
      const web = parseWebTrackId(item.trackId);
      return web ? { kind: 'web', ref: `${web.platform}:${web.externalId}`, title } : { kind: 'file', ref: item.trackId.slice(0, 500), title };
    })
    .filter((thing): thing is LetterThing => thing !== null)
    .filter((thing, index, all) => all.findIndex((other) => other.kind === thing.kind && other.ref === thing.ref) === index);
  return (
    <div className="p-1">
      <button type="button" onClick={() => setListId(null)} className={PLATE}>
        [ ALL PLAYLISTS ]
      </button>
      <WholeLetter key={list.id} name={list.name} things={things} onAdd={onAdd} onAddLetter={onAddLetter} what="PLAYLIST" />
    </div>
  );
}

/**
 * One letter, as a block (Luke, 2026-11-11: "add the whole letter similar to adding a series into the stream queue"): every
 * thing on it ticked, untick what to leave out, then [ ADD THE LETTER ] puts the ticked ones in your queue at once and makes
 * the letter's name the recommendation's title. [ + ] still takes one thing to the pre-list on its own.
 */
function WholeLetter({
  name,
  things,
  onAdd,
  onAddLetter,
  what = 'LETTER',
}: {
  name: string;
  things: LetterThing[];
  onAdd: (thing: LetterThing) => void;
  onAddLetter: (things: LetterThing[], name: string) => void;
  /** What the block is called on its key: a LETTER, or a PLAYLIST (the same block, from a music playlist). */
  what?: 'LETTER' | 'PLAYLIST';
}) {
  const [left, setLeft] = useState<string[]>([]);
  const keyOf = (thing: LetterThing) => `${thing.kind}:${thing.ref}`;
  const kept = things.filter((thing) => !left.includes(keyOf(thing)));
  return (
    <>
      <p className="mt-1 flex flex-wrap items-center gap-1">
        <button type="button" className={PLATE} disabled={kept.length === 0} onClick={() => onAddLetter(kept, name)}>
          [ ADD THE {what} ({kept.length} OF {things.length}) ]
        </button>
      </p>
      <ul>
        {things.map((thing) => {
          const key = keyOf(thing);
          const ticked = !left.includes(key);
          return (
            <li key={key} className="rule-pixel flex items-center gap-1 py-1">
              <input
                type="checkbox"
                checked={ticked}
                aria-label={ticked ? `Leave "${thing.title}" out of the letter` : `Put "${thing.title}" back in`}
                onChange={() => setLeft((held) => (ticked ? [...held, key] : held.filter((each) => each !== key)))}
              />
              <span className={`min-w-0 flex-1 truncate text-label ${ticked ? 'text-ink' : 'text-ink-quiet line-through'}`}>{thing.title || thing.ref}</span>
              <button type="button" className={PLATE} aria-label={`Add "${thing.title}" to the pre-list on its own`} onClick={() => onAdd(thing)}>
                [ + ]
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function FromSearch({ onAdd }: { onAdd: (thing: LetterThing) => void }) {
  const [words, setWords] = useState('');
  const [found, setFound] = useState<LetterThing[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const find = async (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const asked = words.trim();
    if (asked.length === 0) return;
    if (isWebAddress(asked)) {
      onAdd({ kind: 'link', ref: asked, title: new URL(asked).hostname.slice(0, LETTER_TITLE_MAX) });
      setNote('LINK ADDED TO THE PRE-LIST.');
      setWords('');
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const page = await searchEverywhere(asked, null);
      setFound(
        page.items.slice(0, 30).map((item) => ({ kind: 'web' as const, ref: item.id, title: item.title.slice(0, LETTER_TITLE_MAX), picture: rowAddresses(item).thumb ?? undefined })),
      );
      if (page.items.length === 0) setNote('NOTHING FOUND.');
    } catch {
      setNote('THE SEARCH DIDN\'T ANSWER. TRY AGAIN.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-1">
      {/* Its own little form inside the composer's: Enter searches here and doesn't send the recommendation. */}
      <div className="flex gap-1" role="search">
        <input
          type="text"
          value={words}
          onChange={(event) => setWords(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void find(event as unknown as FormEvent);
          }}
          placeholder="SEARCH MEDIA OR PASTE A LINK"
          aria-label="Search MEDIA or paste a link"
          className={`${FIELD_TIGHT} min-w-0 flex-1`}
        />
        <button type="button" onClick={(event) => void find(event as unknown as FormEvent)} className={PLATE} disabled={busy}>
          [ FIND ]
        </button>
      </div>
      {note ? <p className="text-label text-ink">{note}</p> : null}
      <ul>
        {found.map((thing) => (
          <li key={thing.ref} className="rule-pixel flex items-center gap-1 py-1">
            <span className="min-w-0 flex-1 truncate text-label text-ink">{thing.title}</span>
            <button type="button" className={PLATE} aria-label={`Add "${thing.title}" to the pre-list`} onClick={() => onAdd(thing)}>
              [ + ]
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
