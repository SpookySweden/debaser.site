'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { threadDomId } from '../lib/forum/anchors';
import { recommendationAnchor, recommendationIdFromSearch } from '../lib/recommendations/address';
import { getRecommendationsRepository, setRecommendationsViewer } from '../lib/recommendations/repository';
import {
  deleteRecommendation,
  markOpened,
  notePlayed,
  refreshRecommendations,
  usePlayers,
  useRecommendationItems,
  useRecommendationList,
} from '../lib/recommendations/store';
import type { RecommendationItem, RecommendationLetter, RecommendationSummary, RecommendationTab } from '../lib/recommendations/types';
import type { Letter, LetterItem } from '../lib/letters/types';
import LetterCanvas from './LetterCanvas';
import LetterStamp from './LetterStamp';
import { nameInkStyle } from './NameColourWindow';
import { PLATE, PLATE_MAIN, PLATE_PRESSED, TITLE_BAR } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import { useForum } from './ForumProvider';
import LetterItemPopout from './LetterItemPopout';
import PopoutWindow from './PopoutWindow';
import ProfileAvatarLink from './ProfileAvatarLink';
import RecommendationComposer from './RecommendationComposer';
import TimeStamp from './TimeStamp';

/** PUBLIC first, and what the page opens on (Luke, 2026-11-11). */
const TABS: { tab: RecommendationTab; label: string; signedIn: boolean }[] = [
  { tab: 'public', label: 'PUBLIC', signedIn: false },
  { tab: 'for_me', label: 'FOR YOU', signedIn: true },
  { tab: 'sent', label: 'SENT', signedIn: true },
];

const FACES_SHOWN = 5;

/**
 * RECOMMENDATIONS (SPEC-recommendations.md, Luke 2026-11-10), laid out like the stream queue: on top, recommendations to look
 * at (FOR YOU, PUBLIC, SENT), each with the faces of who has played something in it beside its title; below, making one,
 * the stream queue's split (your queue on the left, the pre-list and its sources on the right). Visitors see PUBLIC only,
 * with ANON in place of names.
 */
export default function RecommendationsPage() {
  const { user, status } = useAuth();
  const signedIn = user !== null && status === 'signed-in';
  const me = signedIn ? user.id : null;
  const search = useSearchParams();
  const asked = recommendationIdFromSearch(search.toString());
  const [chosenTab, setTab] = useState<RecommendationTab>('public');
  // Signed out (or a stream guest), PUBLIC is the only tab there is.
  const tab: RecommendationTab = signedIn ? chosenTab : 'public';
  // Undefined until the reader opens or shuts one: until then, whichever the address names (a notification's link).
  const [chosenOpen, setOpen] = useState<string | null | undefined>(undefined);
  const open = chosenOpen === undefined ? asked : chosenOpen;

  useEffect(() => {
    setRecommendationsViewer(signedIn && user ? { id: user.id, name: user.displayName } : null);
  }, [signedIn, user]);

  const list = useRecommendationList(tab, me);
  const rows = list.value ?? [];

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="recs-look">
        <h2 id="recs-look" className={TITLE_BAR}>
          RECOMMENDATIONS
        </h2>
        <div role="tablist" className="flex flex-wrap gap-1 p-2">
          {TABS.filter((each) => signedIn || !each.signedIn).map((each) => (
            <button
              key={each.tab}
              type="button"
              role="tab"
              aria-selected={tab === each.tab}
              onClick={() => setTab(each.tab)}
              className={tab === each.tab ? PLATE_PRESSED : PLATE}
            >
              {each.label}
            </button>
          ))}
        </div>
        {list.loading && list.value === null ? <p className="p-2 text-label text-ink">READING...</p> : null}
        {list.error ? <p className="p-2 text-label text-ink">{list.error}</p> : null}
        {!list.loading && rows.length === 0 && !list.error ? (
          <p className="p-2 text-label text-ink">
            {tab === 'for_me' ? 'NOTHING SENT TO YOU YET.' : tab === 'sent' ? 'YOU HAVEN\'T SENT ANY YET.' : 'NO PUBLIC RECOMMENDATIONS YET.'}
          </p>
        ) : null}
        <ol className="px-2">
          {rows.map((rec) => (
            <RecommendationRow
              key={rec.id}
              rec={rec}
              me={me}
              tab={tab}
              open={open === rec.id}
              onToggle={() => {
                setOpen(open === rec.id ? null : rec.id);
                if (me && tab === 'for_me') void markOpened(rec, me);
              }}
            />
          ))}
        </ol>
        {open !== null && !rows.some((rec) => rec.id === open) ? (
          <div className="px-2">
            <RecommendationQueue id={open} me={me} />
          </div>
        ) : null}
      </section>

      {signedIn && user ? (
        <ComposerSection me={user.id} />
      ) : (
        <p className="p-2 text-label text-ink">SIGN IN TO SEND RECOMMENDATIONS OF YOUR OWN.</p>
      )}
    </div>
  );
}

/** MAKE ONE (Luke, 2026-11-11): a key that opens the composer in a pop-up, over the recommendations. */
function ComposerSection({ me }: { me: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label="Make a recommendation" className="px-2">
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className={PLATE_MAIN}>
        MAKE A RECOMMENDATION
      </button>
      {open ? (
        <PopoutWindow title="MAKE A RECOMMENDATION" onClose={() => setOpen(false)} dismissOnBackdrop={false} maxWidth="max-w-5xl">
          <ComposerBody me={me} />
        </PopoutWindow>
      ) : null}
    </section>
  );
}

function ComposerBody({ me }: { me: string }) {
  const forum = useForum();
  return (
    <>
      <RecommendationComposer
        me={me}
        onSend={async ({ message, isPublic, things, to, title, letter }) => {
          const id = await getRecommendationsRepository().send({ message, isPublic, things, to, letter });
          if (isPublic) {
            // Its forum thread: one per recommendation, by the sender, linked back (as a stream's thread is).
            try {
              const thread = await forum.createThread({ title, body: message, anchor: recommendationAnchor(id) });
              await getRecommendationsRepository().attachThread(id, thread.id);
            } catch {
              // Sent all the same: the thread is the place to talk about it, not the recommendation itself.
            }
          }
          refreshRecommendations();
        }}
      />
    </>
  );
}

function RecommendationRow({
  rec,
  me,
  tab,
  open,
  onToggle,
}: {
  rec: RecommendationSummary;
  me: string | null;
  tab: RecommendationTab;
  open: boolean;
  onToggle: () => void;
}) {
  const players = usePlayers(rec.id);
  const unread = tab === 'for_me' && rec.readAt === null;
  const [letterOpen, setLetterOpen] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  return (
    <li className="rule-pixel py-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* A recommended letter (Luke, 2026-11-11): its envelope, in its colour with its stamp, opens its canvas. */}
        {rec.letter ? (
          <button
            type="button"
            onClick={() => setLetterOpen(true)}
            aria-haspopup="dialog"
            aria-label={`Open the letter "${rec.letter.name}"`}
            title="Open the letter"
            className="cursor-pointer p-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-ink"
          >
            <LetterStamp letter={rec.letter} scale={2} />
          </button>
        ) : null}
        <button type="button" onClick={onToggle} aria-expanded={open} className={`${open ? PLATE_PRESSED : PLATE} max-w-full`}>
          {open ? '▾' : '▸'} <span className="break-words">{rec.title}</span>
        </button>
        {unread ? <span className="bg-ena px-1 text-label text-ink-bar">NEW</span> : null}
        {/* The faces of who has played something in it, to the right of its title (at most five, then +N). */}
        {me !== null && players.length > 0 ? (
          <span className="flex items-center gap-1" aria-label={`${players.length} played something in it`}>
            {players.slice(0, FACES_SHOWN).map((person) => (
              <ProfileAvatarLink key={person} author={{ id: person, displayName: '' }} size={20} showName={false} variant="plain" />
            ))}
            {players.length > FACES_SHOWN ? <span className="text-label text-ink">+{players.length - FACES_SHOWN}</span> : null}
          </span>
        ) : null}
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-label text-ink-quiet">
        {rec.sender ? (
          <ProfileAvatarLink author={{ id: rec.sender, displayName: rec.senderName ?? '' }} size={20} variant="plain" />
        ) : (
          <span>ANON</span>
        )}
        <TimeStamp at={rec.createdAt} />
        <span>
          {rec.itemCount} {rec.itemCount === 1 ? 'THING' : 'THINGS'}
        </span>
        {rec.isPublic ? <span>PUBLIC</span> : null}
        {rec.forumThreadId ? (
          <Link href={`/forum#${threadDomId(rec.forumThreadId)}`} className="underline">
            THREAD
          </Link>
        ) : null}
        {me !== null && rec.sender === me ? (
          <button
            type="button"
            className={PLATE}
            onClick={() => {
              if (!window.confirm('Delete this recommendation? It goes for everyone it was sent to.')) return;
              deleteRecommendation(rec.id).catch((error: unknown) => setFault(error instanceof Error ? error.message : 'Not deleted.'));
            }}
          >
            [ DELETE ]
          </button>
        ) : null}
      </p>
      {rec.message && rec.itemCount > 1 && rec.message !== rec.title ? <p className="mt-1 break-words text-label text-ink">{rec.message}</p> : null}
      {fault ? <p role="status" className="text-label text-ink">{fault}</p> : null}
      {open ? <RecommendationQueue id={rec.id} me={me} /> : null}
      {letterOpen && rec.letter ? <RecommendedLetter rec={rec} letter={rec.letter} me={me} onClose={() => setLetterOpen(false)} /> : null}
    </li>
  );
}

/**
 * A recommended letter, opened from its envelope (Luke, 2026-11-11): the letter as it was sent, its name in its colour, its
 * description, and its canvas, with the stamp's pattern behind and the recommendation's things where they sat on it. A card
 * opens the same pop-up as a letter's, and its WATCH, LISTEN or READ puts the reader's face beside the recommendation.
 */
function RecommendedLetter({ rec, letter, me, onClose }: { rec: RecommendationSummary; letter: RecommendationLetter; me: string | null; onClose: () => void }) {
  const items = useRecommendationItems(rec.id);
  const [opened, setOpened] = useState<LetterItem | null>(null);
  const look: Letter = {
    id: rec.id,
    owner: rec.sender ?? '',
    name: letter.name,
    description: letter.description,
    textColour: letter.textColour,
    stampUrl: letter.stampUrl,
    stampOpacity: letter.stampOpacity,
    stampDensity: letter.stampDensity,
    isPublic: rec.isPublic,
    createdAt: rec.createdAt,
    updatedAt: rec.createdAt,
  };
  const cards: LetterItem[] = (items.value ?? []).map((item) => {
    const spot = letter.places[item.position] ?? { x: 0.5, y: 0.5, turn: 0 };
    return { id: item.id, letterId: rec.id, kind: item.kind, ref: item.ref, title: item.title, picture: item.picture, x: spot.x, y: spot.y, turn: spot.turn, addedAt: rec.createdAt };
  });
  const ink = letter.textColour ? { className: 'name-ink', style: nameInkStyle(letter.textColour) } : { className: 'text-ink', style: undefined };
  return (
    <PopoutWindow title="LETTER" onClose={onClose} maxWidth="max-w-3xl" centred>
      <div className="flex flex-col gap-2 p-2">
        <p className="flex items-center gap-2">
          <LetterStamp letter={letter} scale={2} />
          <span className={`min-w-0 flex-1 break-words text-title ${ink.className}`} style={ink.style}>
            {letter.name}
          </span>
        </p>
        {letter.description ? (
          <p className={`break-words text-label ${ink.className}`} style={ink.style}>
            {letter.description}
          </p>
        ) : null}
        {items.loading && items.value === null ? <p className="text-label text-ink">READING...</p> : <LetterCanvas letter={look} items={cards} onOpen={setOpened} />}
      </div>
      {opened ? <LetterItemPopout item={opened} owner={false} onClose={() => setOpened(null)} onUse={me ? () => void notePlayed(rec.id, me) : undefined} /> : null}
    </PopoutWindow>
  );
}

/** One recommendation's things, as the stream queue lists its queue, each opening the letters' pop-up. */
function RecommendationQueue({ id, me }: { id: string; me: string | null }) {
  const items = useRecommendationItems(id);
  const [opened, setOpened] = useState<RecommendationItem | null>(null);
  if (items.loading && items.value === null) return <p className="p-2 text-label text-ink">READING...</p>;
  if (items.error) return <p className="p-2 text-label text-ink">{items.error}</p>;
  return (
    <>
      <ol className="mt-2 border border-ink bg-sun-pale p-1">
        {(items.value ?? []).map((item, at) => (
          <li key={item.id} className="rule-pixel flex items-center gap-2 py-1">
            <span className="w-6 shrink-0 text-right text-label text-ink-quiet">{at + 1}</span>
            <button type="button" onClick={() => setOpened(item)} className="min-w-0 flex-1 cursor-pointer truncate text-left text-label text-queue-next-ink hover:underline">
              {item.title || item.ref}
            </button>
          </li>
        ))}
      </ol>
      {opened ? (
        <LetterItemPopout
          item={{ ...opened, letterId: '' }}
          owner={false}
          onClose={() => setOpened(null)}
          onUse={me ? () => void notePlayed(id, me) : undefined}
        />
      ) : null}
    </>
  );
}
