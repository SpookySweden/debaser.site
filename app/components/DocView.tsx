'use client';

import type { Editor } from '@tiptap/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useRef, useState } from 'react';
import { docAnchor, docAnnouncement } from '../lib/docs/forum';
import { getDocsRepository } from '../lib/docs/repository';
import { announcesOnBoard, folderPath, LORE_PATH } from '../lib/docs/rules';
import { useDoc, type DocTarget } from '../lib/docs/use-doc';
import { LORE_FOLDER_ID, type DocAccess, type DocViewer } from '../lib/docs/types';
import { accessWords, dateWords, DOC_FAULT, DOC_KEY, DOC_KEY_MAIN } from '../lib/docs/ui';
import { FORUM_ANCHORS } from '../lib/forum/anchors';
import { profileNameColour } from '../lib/profile/name-colours';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { FIELD_TIGHT, KEY_FOCUS } from '../lib/ui/controls';
import { DYES } from '../lib/ui/themes';
import AddToLetterKey from './AddToLetterKey';
import { useAuth } from './AuthProvider';
import CommentPopout from './CommentPopout';
import DocEditor from './DocEditor';
import DocHistoryWindow from './DocHistoryWindow';
import DocSharingWindow from './DocSharingWindow';
import DocsScale from './DocsScale';
import { useForum } from './ForumProvider';

type DocViewProps = {
  target: DocTarget;
};

/**
 * One document, at `/docs/<id>` or (for a lore page) `/lore/<slug>`, laid out like Google Docs (Luke,
 * 2026-11-13): the way back and a filled [ SHARE ] across the top, the title in big letters (press it to
 * rename), then the editor with its bar and page, and the rarer keys in a quiet row underneath.
 *
 * Keys: [ SHARE ] for the owner; [ HISTORY ] for everyone who can read it; [ BOARD THREAD ] (its forum
 * thread: only the margin key says COMMENT) on every document; the title renames for editors;
 * [ DELETE THIS DOCUMENT ] for the owner, in two presses.
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
  // open to EVERYONE or ANYONE SIGNED IN and has words in it - on that save, or on the sharing change that opens it up.
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
    return <p className="p-3 text-title text-ink">READING THE DOCUMENT...</p>;
  }

  if (live.error !== null) {
    return <p className="w-fit bg-bubble-pale p-3 text-title text-ink-bar">{live.error}</p>;
  }

  const record = live.record;
  if (record === null || live.doc === null || live.awareness === null) {
    return (
      <DocsScale className="space-y-3 p-3">
        {/* The same words whether it does not exist or is not yours to see: nothing is given away. */}
        <p className="docs-key text-ink">NO DOCUMENT HERE{viewer === null ? ' - OR IT NEEDS AN ACCOUNT' : ' THAT YOU CAN OPEN'}.</p>
        <div className="flex flex-wrap gap-3">
          <Link href={'slug' in target ? LORE_PATH : '/docs'} className={DOC_KEY}>
            {'slug' in target ? '[ < LORE ]' : '[ < ALL DOCUMENTS ]'}
          </Link>
          {viewer === null ? (
            <Link href="/account" className={DOC_KEY}>
              [ LOG IN ]
            </Link>
          ) : null}
        </div>
      </DocsScale>
    );
  }

  const owner = record.role === 'owner';
  const lore = record.folderId === LORE_FOLDER_ID;
  const repository = getDocsRepository(viewer?.id ?? null);

  async function rename(title: string): Promise<void> {
    if (record === null || title.trim().length === 0) return;
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
      // post, which the owner made. Its [ BOARD THREAD ] stays: other people's replies are in it.
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
    <DocsScale className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link href={lore ? LORE_PATH : folderPath(record.folderId)} className={DOC_KEY}>
          {lore ? '[ < LORE ]' : '[ < ALL DOCUMENTS ]'}
        </Link>
        <span className="ml-auto inline-flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="docs-meta text-ink">WHO CAN OPEN IT: {accessWords(record.access, owner)}</span>
          {owner && viewer !== null ? (
            <button type="button" className={DOC_KEY_MAIN} onClick={() => setOpen('sharing')}>
              [ SHARE ]
            </button>
          ) : null}
        </span>
      </div>

      <div>
        {renaming === null ? (
          <h2 className="min-w-0">
            {live.editing ? (
              <button
                type="button"
                className={`key inline-flex max-w-full cursor-pointer flex-wrap items-baseline gap-x-4 px-1 py-1 text-left ${KEY_FOCUS}`}
                onClick={() => setRenaming(record.title)}
              >
                <span className="docs-title min-w-0 break-words">{record.title}</span>
                <span className="docs-key whitespace-nowrap">
                  [ <span aria-hidden="true">✎</span> RENAME ]
                </span>
              </button>
            ) : (
              <span className="docs-title block break-words px-1 py-1 text-accent-ink">{record.title}</span>
            )}
          </h2>
        ) : (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void rename(renaming);
            }}
          >
            <label className="sr-only" htmlFor="doc-rename">
              The document&apos;s name
            </label>
            <input
              id="doc-rename"
              value={renaming}
              onChange={(event) => setRenaming(event.target.value)}
              maxLength={120}
              className={`${FIELD_TIGHT} docs-title min-w-0 flex-1`}
              autoComplete="off"
              autoFocus
            />
            <button type="submit" className={DOC_KEY} disabled={renaming.trim().length === 0}>
              [ SAVE NAME ]
            </button>
            <button type="button" className={DOC_KEY} onClick={() => setRenaming(null)}>
              [ CANCEL ]
            </button>
          </form>
        )}
        {record.summary.length === 0 ? null : <p className="docs-meta px-1 text-ink">{record.summary}</p>}
        {error === null ? null : <p className={`${DOC_FAULT} mt-1`}>{error}</p>}
      </div>

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
        saveError={live.saveError}
        onEditor={onEditor}
      />

      {viewer === null ? (
        <p className="docs-key text-ink">
          <Link href="/account" className={DOC_KEY}>
            [ LOG IN ]
          </Link>{' '}
          TO WRITE
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" className={DOC_KEY} onClick={() => setOpen('history')}>
          [ HISTORY ]
        </button>
        <CommentPopout anchor={docAnchor(record)} label="BOARD THREAD" className={DOC_KEY} />
        {lore && record.slug !== null ? <AddToLetterKey thing={{ kind: 'lore', ref: record.slug ?? record.id, title: record.title }} className={DOC_KEY} /> : null}
        {owner ? (
          <span className="ml-auto inline-flex flex-wrap items-center gap-x-3 gap-y-2">
            {deleting ? (
              <>
                <button type="button" className={DOC_KEY} onClick={() => void remove()}>
                  [ REALLY DELETE IT? IT CANNOT COME BACK ]
                </button>
                <button type="button" className={DOC_KEY} onClick={() => setDeleting(false)}>
                  [ KEEP IT ]
                </button>
              </>
            ) : (
              <button type="button" className={DOC_KEY} onClick={() => setDeleting(true)}>
                [ DELETE THIS DOCUMENT ]
              </button>
            )}
          </span>
        ) : null}
      </div>

      <p className="docs-meta text-ink">
        MADE BY {record.ownerLabel.length > 0 ? record.ownerLabel : record.createdByLabel}
        {live.savedAt === null ? ` · LAST SAVED BY ${record.updatedByLabel}, ${dateWords(record.updatedAt)}` : ` · LAST SAVED BY YOU, ${dateWords(live.savedAt)}`}
      </p>

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
          owner={owner}
          onKept={live.noteVersionKept}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </DocsScale>
  );
}
