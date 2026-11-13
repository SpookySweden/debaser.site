'use client';

import type { Editor } from '@tiptap/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useRef, useState } from 'react';
import { docAnchor, docAnnouncement } from '../lib/docs/forum';
import { getDocsRepository } from '../lib/docs/repository';
import { announcesOnBoard, DOC_ACCESS_LABELS, folderPath, LORE_PATH } from '../lib/docs/rules';
import { useDoc, type DocTarget } from '../lib/docs/use-doc';
import { LORE_FOLDER_ID, type DocAccess, type DocViewer } from '../lib/docs/types';
import { FORUM_ANCHORS } from '../lib/forum/anchors';
import { profileNameColour } from '../lib/profile/name-colours';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { FIELD_TIGHT, PLATE, PLATE_LINK, TITLE_BAR } from '../lib/ui/controls';
import { DYES } from '../lib/ui/themes';
import AddToLetterKey from './AddToLetterKey';
import { useAuth } from './AuthProvider';
import CommentPopout from './CommentPopout';
import DocEditor from './DocEditor';
import DocHistoryWindow from './DocHistoryWindow';
import DocSharingWindow from './DocSharingWindow';
import { useForum } from './ForumProvider';
import TimeStamp from './TimeStamp';

type DocViewProps = {
  target: DocTarget;
};

/**
 * One document, at `/docs/<id>` or (for a lore page) `/lore/<slug>`: its line, its keys, and the live editor.
 *
 * Keys: [ SHARING ] for the owner; [ HISTORY ] for everyone who can read it; [ COMMENT ] (its forum
 * thread) on every document; [ RENAME ] for editors; [ DELETE ] for the owner, in two presses.
 */
export default function DocView({ target }: DocViewProps) {
  const { user, status: authStatus } = useAuth();
  const router = useRouter();
  const viewer = useMemo<DocViewer | null>(() => (user === null ? null : { id: user.id, name: user.displayName }), [user]);
  const { profile } = usePublicProfile(viewer?.id ?? null);
  const colour = (viewer === null ? undefined : profileNameColour(profile)) ?? DYES.royalBlue;
  const live = useDoc(target, authStatus === 'loading' ? null : viewer, colour);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [open, setOpen] = useState<'sharing' | 'history' | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onEditor = useCallback((next: Editor | null) => setEditor(next), []);
  const forum = useForum();
  const announcing = useRef(false);
  const { record: current, patchRecord, save } = live;
  const viewerId = viewer?.id ?? null;

  // The one board post (SPEC-live-docs.md, decision 8): made by the owner's tab the first time the document is
  // PUBLIC or ANYONE SIGNED IN and has words in it - on that save, or on the sharing change that opens it up.
  const announce = useCallback(
    async (access: DocAccess, text: string) => {
      if (current === null || current.role !== 'owner' || current.boardThreadId !== null || announcing.current) return;
      if (!announcesOnBoard(access) || text.trim().length === 0) return;
      announcing.current = true;
      try {
        const post = docAnnouncement(current, text, window.location.origin);
        const thread = await forum.createThread({ title: post.title, body: post.body, anchor: FORUM_ANCHORS.board });
        await getDocsRepository(viewerId).updateDoc(current.id, { boardThreadId: thread.id });
        patchRecord({ boardThreadId: thread.id });
      } catch (caught: unknown) {
        announcing.current = false;
        setError(caught instanceof Error ? `NOT POSTED TO THE BOARD: ${caught.message}` : 'NOT POSTED TO THE BOARD.');
      }
    },
    [current, forum, patchRecord, viewerId],
  );

  const onSave = useCallback(
    (text: string) => {
      void save(text).then((landed) => {
        if (landed && current !== null) void announce(current.access, text);
      });
    },
    [announce, current, save],
  );

  if (!live.ready || authStatus === 'loading') {
    return <p className="p-3 text-label font-bold text-ink">READING THE DOCUMENT...</p>;
  }

  if (live.error !== null) {
    return <p className="w-fit bg-bubble-pale p-3 text-label font-bold text-ink-bar">{live.error}</p>;
  }

  const record = live.record;
  if (record === null || live.doc === null || live.awareness === null) {
    return (
      <div className="space-y-2 p-3">
        {/* The same words whether it does not exist or is not yours to see: nothing is given away. */}
        <p className="text-label font-bold text-ink">NO DOCUMENT HERE{viewer === null ? ' - OR IT NEEDS AN ACCOUNT' : ' THAT YOU CAN OPEN'}.</p>
        <Link href={'slug' in target ? LORE_PATH : '/docs'} className={PLATE_LINK}>
          {'slug' in target ? '[ < LORE ]' : '[ < DOCS ]'}
        </Link>
        {viewer === null ? (
          <Link href="/account" className={PLATE_LINK}>
            [ LOG IN ]
          </Link>
        ) : null}
      </div>
    );
  }

  const owner = record.role === 'owner';
  const lore = record.folderId === LORE_FOLDER_ID;
  const repository = getDocsRepository(viewer?.id ?? null);

  async function rename(title: string): Promise<void> {
    if (record === null) return;
    setRenaming(null);
    setError(null);
    try {
      await repository.updateDoc(record.id, { title });
      live.patchRecord({ title: title.trim().toUpperCase().slice(0, 120) });
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'NOT RENAMED.');
    }
  }

  async function remove(): Promise<void> {
    if (record === null) return;
    setError(null);
    try {
      // The owner's own pictures in it go with it (other editors' files are theirs to remove), and so does its board
      // post, which the owner made. Its [ COMMENT ] thread stays: other people's replies are in it.
      const own = `/doc-pictures/${record.ownerId ?? ''}/`;
      const pictures = (editor?.getJSON().content ?? [])
        .flatMap(function walk(node: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }): string[] {
          const here = node.type === 'image' && typeof node.attrs?.src === 'string' ? [node.attrs.src] : [];
          return [...here, ...((node.content ?? []) as (typeof node)[]).flatMap(walk)];
        })
        .filter((src) => src.includes(own));
      await repository.deleteDoc(record.id);
      if (pictures.length > 0) await repository.removePictures(pictures).catch(() => undefined);
      if (record.boardThreadId !== null) await forum.deleteThread(record.boardThreadId).catch(() => undefined);
      router.push(lore ? LORE_PATH : folderPath(record.folderId));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'NOT DELETED.');
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-3">
      <section>
        <div className={TITLE_BAR}>
          <h2 className="truncate">{record.title}</h2>
        </div>

        <div className="space-y-1 py-2 text-label text-ink">
          {record.summary.length === 0 ? null : <p className="font-bold">{record.summary}</p>}
          <p>
            {DOC_ACCESS_LABELS[record.access]} :: BY {record.ownerLabel} :: LAST SAVED BY {record.updatedByLabel} <TimeStamp at={record.updatedAt} />
          </p>

          <div className="flex flex-wrap items-center gap-2">
            {owner && viewer !== null ? (
              <button type="button" className={PLATE} onClick={() => setOpen('sharing')}>
                [ SHARING ]
              </button>
            ) : null}
            <button type="button" className={PLATE} onClick={() => setOpen('history')}>
              [ HISTORY ]
            </button>
            <CommentPopout anchor={docAnchor(record)} />
            {lore && record.slug !== null ? <AddToLetterKey thing={{ kind: 'lore', ref: record.slug ?? record.id, title: record.title }} /> : null}
            {live.editing ? (
              renaming === null ? (
                <button type="button" className={PLATE} onClick={() => setRenaming(record.title)}>
                  [ RENAME ]
                </button>
              ) : (
                <>
                  <label className="sr-only" htmlFor="doc-rename">
                    Title
                  </label>
                  <input id="doc-rename" value={renaming} onChange={(event) => setRenaming(event.target.value)} maxLength={120} className={FIELD_TIGHT} />
                  <button type="button" className={PLATE} disabled={renaming.trim().length === 0} onClick={() => void rename(renaming)}>
                    [ OK ]
                  </button>
                </>
              )
            ) : null}
            {owner ? (
              deleting ? (
                <button type="button" className={PLATE} onClick={() => void remove()}>
                  [ REALLY DELETE? ]
                </button>
              ) : (
                <button type="button" className={PLATE} onClick={() => setDeleting(true)}>
                  [ DELETE ]
                </button>
              )
            ) : null}
            <Link href={lore ? LORE_PATH : folderPath(record.folderId)} className={PLATE_LINK}>
              {lore ? '[ < LORE ]' : '[ < FOLDER ]'}
            </Link>
          </div>

          {error === null ? null : <p className="w-fit bg-bubble-pale px-1 font-bold text-ink-bar">{error}</p>}
        </div>
      </section>

      <DocEditor
        docId={record.id}
        doc={live.doc}
        awareness={live.awareness}
        session={live.session}
        identity={live.identity}
        viewer={viewer}
        role={record.role}
        editing={live.editing}
        peers={live.peers}
        status={live.status}
        onSave={onSave}
        saving={live.saving}
        savedAt={live.savedAt}
        lastSavedAt={record.updatedAt}
        saveError={live.saveError}
        onEditor={onEditor}
      />

      {viewer === null ? (
        <p className="text-label text-ink">
          <Link href="/account" className={PLATE_LINK}>
            [ LOG IN ]
          </Link>{' '}
          TO WRITE
        </p>
      ) : null}

      {open === 'sharing' && viewer !== null ? (
        <DocSharingWindow
          record={record}
          announce={(access) => announce(access, editor?.getText() ?? record.bodyText)}
          viewer={viewer}
          onChanged={live.patchRecord}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open === 'history' ? (
        <DocHistoryWindow
          docId={record.id}
          doc={live.doc}
          editor={editor}
          viewer={viewer}
          editing={live.editing}
          onKept={live.noteVersionKept}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}
