'use client';

import { TaskItem, TaskList } from '@tiptap/extension-list';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap';
import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { docPictureNode } from '../lib/docs/picture-node';
import { DOCS_PICTURE_BASE, getDocsRepository } from '../lib/docs/repository';
import { snippetOf } from '../lib/docs/rules';
import { base64ToBytes, bytesToBase64 } from '../lib/docs/session';
import { DOC_FIELD, type DocVersion, type DocViewer } from '../lib/docs/types';
import { FIELD, PLATE, PLATE_MAIN, TITLE_BAR } from '../lib/ui/controls';
import PopoutWindow from './PopoutWindow';
import TimeStamp from './TimeStamp';

type DocHistoryWindowProps = {
  docId: string;
  /** The live document, so KEEP THIS VERSION copies what is there now. */
  doc: Y.Doc;
  /** The live editor, which a restore writes into. Null for a reader. */
  editor: Editor | null;
  viewer: DocViewer | null;
  editing: boolean;
  onKept: (at: string) => void;
  onClose: () => void;
};

/** A saved copy's writing, as the editor's own JSON. */
function versionContent(state: string): Record<string, unknown> {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, base64ToBytes(state));
  const json = yXmlFragmentToProsemirrorJSON(copy.getXmlFragment(DOC_FIELD));
  copy.destroy();
  return json;
}

function VersionView({ content }: { content: Record<string, unknown> }) {
  const viewer = useEditor(
    {
      extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true }), docPictureNode(DOCS_PICTURE_BASE)],
      content,
      editable: false,
      immediatelyRender: false,
      editorProps: { attributes: { class: 'lore-document doc-document', 'aria-label': 'An earlier version' } },
    },
    [content],
  );

  return <EditorContent editor={viewer} />;
}

/**
 * HISTORY: the document's earlier versions (one an hour while edited, plus every named one, 40 unnamed
 * at most), each viewable, and restorable by an editor.
 *
 * A restore writes the old version into the live document as one ordinary edit, so everybody in it sees
 * it at once, and it can itself be undone or restored over.
 */
export default function DocHistoryWindow({ docId, doc, editor, viewer, editing, onKept, onClose }: DocHistoryWindowProps) {
  const repository = useMemo(() => getDocsRepository(viewer?.id ?? null), [viewer?.id]);
  const [versions, setVersions] = useState<DocVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ version: DocVersion; content: Record<string, unknown> } | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    repository
      .listVersions(docId)
      .then((rows) => {
        if (!cancelled) setVersions(rows);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'HISTORY DID NOT LOAD.');
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, docId, repository]);

  async function view(version: DocVersion): Promise<void> {
    setError(null);
    try {
      const state = await repository.versionState(version.id);
      if (state === null) throw new Error('THAT VERSION IS GONE.');
      setOpen({ version, content: versionContent(state) });
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'THAT VERSION DID NOT LOAD.');
    }
  }

  function restore(): void {
    if (open === null || editor === null || !editing) return;
    editor.chain().focus().setContent(open.content).run();
    onClose();
  }

  async function keep(): Promise<void> {
    if (viewer === null || name.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const text = editor?.getText() ?? '';
      const kept = await repository.keepVersion({
        docId,
        state: bytesToBase64(Y.encodeStateAsUpdate(doc)),
        snippet: snippetOf(text, 200),
        name: name.trim(),
        viewer,
      });
      if (kept !== null) onKept(kept.createdAt);
      setName('');
      setAttempt((value) => value + 1);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'THAT VERSION WAS NOT KEPT.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PopoutWindow title="HISTORY" onClose={onClose} maxWidth="max-w-3xl">
      {error === null ? null : <p className="mb-2 w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">{error}</p>}

      {open === null ? (
        <>
          {editing ? (
            <div className="mb-3 flex flex-wrap items-end gap-2">
              <label className="min-w-0 flex-1 text-label font-bold text-ink">
                NAME THIS VERSION
                <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} className={FIELD} />
              </label>
              <button type="button" className={PLATE_MAIN} disabled={busy || name.trim().length === 0} onClick={() => void keep()}>
                [ KEEP ]
              </button>
            </div>
          ) : null}

          <div className={TITLE_BAR}>
            <span>EARLIER VERSIONS</span>
          </div>

          {versions === null ? (
            <p className="py-1 text-label font-bold text-ink">READING...</p>
          ) : versions.length === 0 ? (
            <p className="py-1 text-label font-bold text-ink">NONE YET.</p>
          ) : (
            <ol>
              {versions.map((version) => (
                <li key={version.id} className="rule-pixel flex flex-wrap items-baseline gap-x-2 gap-y-1 py-1.5 text-label text-ink">
                  <span className="font-bold">
                    <TimeStamp at={version.createdAt} />
                  </span>
                  {version.name === null ? null : <span className="font-bold text-accent-ink">{version.name}</span>}
                  <span>BY {version.createdByLabel}</span>
                  <span className="min-w-0 flex-1 truncate">{version.snippet}</span>
                  <button type="button" className={PLATE} onClick={() => void view(version)}>
                    [ VIEW ]
                  </button>
                </li>
              ))}
            </ol>
          )}
        </>
      ) : (
        <>
          <div className={TITLE_BAR}>
            <span>
              {open.version.name ?? 'VERSION'} :: <TimeStamp at={open.version.createdAt} />
            </span>
          </div>
          <div className="my-2 max-h-96 overflow-y-auto p-2">
            <VersionView content={open.content} />
          </div>
          <div className="flex flex-wrap gap-2">
            {editing && editor !== null ? (
              <button type="button" className={PLATE_MAIN} onClick={restore}>
                [ RESTORE ]
              </button>
            ) : null}
            <button type="button" className={PLATE} onClick={() => setOpen(null)}>
              [ &lt; ALL VERSIONS ]
            </button>
          </div>
        </>
      )}
    </PopoutWindow>
  );
}
