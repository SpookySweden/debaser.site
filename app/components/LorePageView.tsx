'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useLorePage, type LoreEditor as LoreEditorIdentity } from '../lib/lore/use-lore-page';
import { PANEL, PLATE_LINK, TITLE_BAR } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import LoreEditor from './LoreEditor';
import TimeStamp from './TimeStamp';

type LorePageViewProps = {
  /** The page's address, straight from the route. */
  slug: string;
};

/**
 * One lore page: what it is, and the editor when there is an account to write with.
 *
 * A visitor who is not signed in reads the writing and is told why they cannot change it, which is
 * the same shape the rest of the site keeps (the board's guests post anonymously because a row
 * without an owner is a row nobody can take back; a *shared document* has nowhere to put an
 * ownerless keystroke, so this is the one shelf that asks first).
 *
 * The read view is the plain-text copy the last save filed, drawn as paragraphs - not the Yjs state
 * re-rendered. That is deliberate: the state is a CRDT binary, and the alternative would be to ship
 * a second HTML copy of every page that could disagree with the document it came from.
 */
export default function LorePageView({ slug }: LorePageViewProps) {
  const { user, status: authStatus } = useAuth();
  const editor = useMemo<LoreEditorIdentity | null>(
    () => (user === null ? null : { id: user.id, name: user.displayName }),
    [user],
  );
  const lore = useLorePage(slug, editor);

  if (!lore.ready || authStatus === 'loading') {
    return (
      <p className="p-3 text-label font-bold text-ink">
        READING THE PAGE...
      </p>
    );
  }

  if (lore.error !== null) {
    return (
      <p className="w-fit bg-bubble-pale p-3 text-label font-bold text-ink-bar">
        {lore.error}
      </p>
    );
  }

  if (lore.page === null) {
    return (
      <div className="space-y-2">
        <p className="p-3 text-label font-bold text-ink">
          NO PAGE LIVES AT /lore/{slug}. IT MAY HAVE BEEN RENAMED, OR NEVER OPENED AT ALL.
        </p>
        <Link href="/lore" className="text-label font-bold underline hover:bg-ice-pale">
          [ &lt; BACK TO THE LORE SHELF ]
        </Link>
      </div>
    );
  }

  const page = lore.page;
  const paragraphs = page.bodyText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  return (
    <div className="space-y-3">
      <section className={PANEL}>
        <div className={TITLE_BAR}>
          <span className="truncate">{page.title}</span>
        </div>

        <div className="p-3 text-label font-bold text-ink">
          {page.summary.length === 0 ? null : <p>{page.summary}</p>}
          <p className="mt-1 text-ink">
            OPENED BY {page.createdByLabel} :: LAST FILED BY {page.updatedByLabel}{' '}
            <TimeStamp at={page.updatedAt} />
          </p>
        </div>
      </section>

      {editor === null ? (
        <section className={PANEL}>
          <div className={TITLE_BAR}>
            <span>THE PAGE</span>
          </div>

          <div className="space-y-2 p-3 text-prose leading-normal text-ink">
            {paragraphs.length === 0 ? (
              <p className="text-label font-bold text-ink">NOTHING HAS BEEN WRITTEN ON THIS PAGE YET.</p>
            ) : (
              paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)
            )}
          </div>
        </section>
      ) : null}

      {editor !== null && lore.doc !== null && lore.awareness !== null ? (
        <LoreEditor
          doc={lore.doc}
          awareness={lore.awareness}
          user={lore.identity}
          peers={lore.peers}
          status={lore.status}
          onSave={lore.save}
          saving={lore.saving}
          savedAt={lore.savedAt}
          saveError={lore.saveError}
        />
      ) : null}

      {/* A guest gets one line; a writer's explanation is the editor's title tip (./LoreEditor.tsx). */}
      {editor === null ? (
        <p className="text-label text-ink">
          <Link href="/account" className={PLATE_LINK}>
            [ LOG IN ]
          </Link>{' '}
          TO WRITE ON THIS PAGE
        </p>
      ) : null}
    </div>
  );
}
