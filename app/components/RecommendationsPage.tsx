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
import type { RecommendationItem, RecommendationSummary, RecommendationTab } from '../lib/recommendations/types';
import { PLATE, PLATE_PRESSED, TITLE_BAR } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import { useForum } from './ForumProvider';
import LetterItemPopout from './LetterItemPopout';
import ProfileAvatarLink from './ProfileAvatarLink';
import RecommendationComposer from './RecommendationComposer';
import TimeStamp from './TimeStamp';

const TABS: { tab: RecommendationTab; label: string; signedIn: boolean }[] = [
  { tab: 'for_me', label: 'FOR YOU', signedIn: true },
  { tab: 'public', label: 'PUBLIC', signedIn: false },
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
  const [chosenTab, setTab] = useState<RecommendationTab>('for_me');
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

function ComposerSection({ me }: { me: string }) {
  const forum = useForum();
  return (
    <section aria-labelledby="recs-make">
      <h2 id="recs-make" className={TITLE_BAR}>
        MAKE ONE
      </h2>
      <RecommendationComposer
        me={me}
        onSend={async ({ message, isPublic, things, to, title }) => {
          const id = await getRecommendationsRepository().send({ message, isPublic, things, to });
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
    </section>
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
  const [fault, setFault] = useState<string | null>(null);
  return (
    <li className="rule-pixel py-2">
      <div className="flex flex-wrap items-center gap-2">
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
    </li>
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
