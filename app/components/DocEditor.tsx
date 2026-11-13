'use client';

import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import { useEffect, useRef, useState } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import { placeAt } from '../lib/docs/anchors';
import { CommentMarks } from '../lib/docs/comment-marks';
import { renderCaret } from '../lib/docs/people';
import { docPictureNode, shrinkPicture } from '../lib/docs/picture-node';
import { DOCS_PICTURE_BASE, getDocsRepository } from '../lib/docs/repository';
import { SAVE_AFTER_MS } from '../lib/docs/rules';
import { docPresence, type DocIdentity, type DocPeer, type DocSession, type DocStatus } from '../lib/docs/session';
import { DOC_FIELD, type DocRole, type DocViewer } from '../lib/docs/types';
import { PLATE, TITLE_BAR } from '../lib/ui/controls';
import DocFace from './DocFace';
import DocMargin, { type CommentDraft } from './DocMargin';
import DocPointers from './DocPointers';
import TimeStamp from './TimeStamp';

/** What the room's line says. */
export const DOC_STATUS_LINES: Record<DocStatus, string> = {
  SYNCING: 'CONNECTING...',
  LIVE: 'LIVE',
  ALONE: 'ALONE',
};

function toolClass(isOn: boolean): string {
  return isOn ? 'cursor-pointer key key-fill [--key-fill:var(--color-ink)] px-2 py-0.5 text-label font-bold text-paper' : PLATE;
}

type DocEditorProps = {
  docId: string;
  doc: Y.Doc;
  awareness: Awareness;
  session: DocSession | null;
  identity: DocIdentity;
  viewer: DocViewer | null;
  role: DocRole;
  editing: boolean;
  peers: DocPeer[];
  status: DocStatus;
  onSave: (text: string) => void;
  saving: boolean;
  savedAt: string | null;
  saveError: string | null;
  /** Hands the editor up, for the history window's restore. */
  onEditor: (editor: Editor | null) => void;
};

/**
 * A document's editor: Tiptap over the shared Yjs document, with everyone's carets (picture and name),
 * everyone's pointers, pictures, checklists and margin comments.
 *
 * The document's words come only from the Yjs state, never a string handed to the editor, so two tabs
 * opening it at once cannot each add a copy. Undo is per person (the collaboration extension's own).
 * A reader gets the same live page with no toolbar and no typing.
 */
export default function DocEditor({
  docId,
  doc,
  awareness,
  session,
  identity,
  viewer,
  role,
  editing,
  peers,
  status,
  onSave,
  saving,
  savedAt,
  saveError,
  onEditor,
}: DocEditorProps) {
  const latest = useRef('');
  const timer = useRef<number | null>(null);
  const frame = useRef<HTMLDivElement | null>(null);
  const pictureInput = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<CommentDraft | null>(null);
  const [pictureNote, setPictureNote] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        TaskList,
        TaskItem.configure({ nested: true }),
        docPictureNode(DOCS_PICTURE_BASE),
        CommentMarks,
        Collaboration.configure({ document: doc, field: DOC_FIELD }),
        CollaborationCaret.configure({ provider: { awareness }, user: docPresence(identity), render: renderCaret }),
      ],
      editable: editing,
      immediatelyRender: false,
      editorProps: { attributes: { class: 'lore-document doc-document', 'aria-label': 'The document' } },
      onUpdate: ({ editor: instance, transaction }) => {
        // Only this tab's own typing schedules a save; a change that arrived from someone else is theirs to save.
        if (editing && transaction.getMeta(ySyncPluginKey) === undefined) schedule(instance.getText());
      },
    },
    [awareness, doc, editing],
  );

  useEffect(() => {
    onEditor(editor);
    return () => onEditor(null);
  }, [editor, onEditor]);

  const marks = useEditorState({
    editor,
    selector: ({ editor: instance }) =>
      instance === null
        ? null
        : {
            bold: instance.isActive('bold'),
            italic: instance.isActive('italic'),
            strike: instance.isActive('strike'),
            h1: instance.isActive('heading', { level: 1 }),
            h2: instance.isActive('heading', { level: 2 }),
            bullets: instance.isActive('bulletList'),
            numbers: instance.isActive('orderedList'),
            checklist: instance.isActive('taskList'),
            quote: instance.isActive('blockquote'),
            picked: !instance.state.selection.empty,
          },
  });

  function schedule(text: string): void {
    latest.current = text;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      onSave(latest.current);
    }, SAVE_AFTER_MS);
  }

  useEffect(() => {
    if (!editing) return;
    const flush = () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
        onSave(latest.current);
      }
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      flush();
    };
  }, [editing, onSave]);

  function saveNow(): void {
    if (editor === null) return;
    latest.current = editor.getText();
    onSave(latest.current);
  }

  function startComment(): void {
    if (editor === null) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const anchorFrom = placeAt(editor, from);
    const anchorTo = placeAt(editor, to);
    if (anchorFrom === null || anchorTo === null) return;
    setDraft({ anchorFrom, anchorTo, quote: editor.state.doc.textBetween(from, to, ' ').slice(0, 300) });
  }

  async function addPicture(file: File | undefined): Promise<void> {
    if (file === undefined || editor === null || viewer === null) return;
    setUploading(true);
    setPictureNote(null);
    try {
      const shrunk = await shrinkPicture(file);
      const src = await getDocsRepository(viewer.id).uploadPicture(shrunk, viewer);
      editor.chain().focus().insertPicture(src).run();
    } catch (caught: unknown) {
      setPictureNote(caught instanceof Error ? caught.message : 'THE PICTURE WAS NOT ADDED.');
    } finally {
      setUploading(false);
      if (pictureInput.current !== null) pictureInput.current.value = '';
    }
  }

  const others = peers.filter((peer) => !peer.self);

  return (
    <section>
      <div className={TITLE_BAR}>
        <span>THE DOCUMENT</span>
        <span className="min-w-0 shrink whitespace-normal text-right">{editing ? DOC_STATUS_LINES[status] : 'READ ONLY'}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-2 py-1 text-label font-bold text-ink">
        <span>IN IT:</span>
        {editing ? <DocFace name={identity.name} colour={identity.colour} userId={identity.userId} self /> : null}
        {others.map((peer) => (
          <DocFace key={peer.clientId} name={peer.name} colour={peer.colour} userId={peer.userId} />
        ))}
        {!editing && others.length === 0 ? <span>NOBODY EDITING</span> : null}
      </div>

      {editor === null || marks === null || !editing ? null : (
        <div className="flex flex-wrap items-center gap-1 px-2 py-1">
          <button type="button" className={toolClass(marks.bold)} onClick={() => editor.chain().focus().toggleBold().run()}>
            [ BOLD ]
          </button>
          <button type="button" className={toolClass(marks.italic)} onClick={() => editor.chain().focus().toggleItalic().run()}>
            [ ITALIC ]
          </button>
          <button type="button" className={toolClass(marks.strike)} onClick={() => editor.chain().focus().toggleStrike().run()}>
            [ STRIKE ]
          </button>
          <button type="button" className={toolClass(marks.h1)} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
            [ H1 ]
          </button>
          <button type="button" className={toolClass(marks.h2)} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
            [ H2 ]
          </button>
          <button type="button" className={toolClass(marks.bullets)} onClick={() => editor.chain().focus().toggleBulletList().run()}>
            [ BULLETS ]
          </button>
          <button type="button" className={toolClass(marks.numbers)} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
            [ NUMBERS ]
          </button>
          <button type="button" className={toolClass(marks.checklist)} onClick={() => editor.chain().focus().toggleTaskList().run()}>
            [ CHECKLIST ]
          </button>
          <button type="button" className={toolClass(marks.quote)} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            [ QUOTE ]
          </button>
          <button type="button" className={PLATE} onClick={() => editor.chain().focus().setHorizontalRule().run()}>
            [ RULE ]
          </button>
          <button type="button" className={PLATE} disabled={uploading} onClick={() => pictureInput.current?.click()}>
            {uploading ? '[ ADDING... ]' : '[ PICTURE ]'}
          </button>
          <input
            ref={pictureInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="sr-only"
            tabIndex={-1}
            aria-label="Picture to add"
            onChange={(event) => void addPicture(event.target.files?.[0])}
          />
          <button type="button" className={PLATE} disabled={!marks.picked} onClick={startComment} title="Select words first">
            [ COMMENT ON THIS ]
          </button>

          <span className="ml-auto flex items-center gap-1">
            <button type="button" className={PLATE} onClick={() => editor.chain().focus().undo().run()}>
              [ UNDO ]
            </button>
            <button type="button" className={PLATE} onClick={() => editor.chain().focus().redo().run()}>
              [ REDO ]
            </button>
          </span>
        </div>
      )}

      {pictureNote === null ? null : <p className="mx-2 w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">{pictureNote}</p>}

      <div className="lg:grid lg:grid-cols-4 lg:gap-3">
        <div ref={frame} className="doc-frame relative p-2 lg:col-span-3">
          <EditorContent editor={editor} />
          <DocPointers editor={editor} session={session} peers={peers} frame={frame} sends={editing} />
        </div>

        <div className="px-2 lg:px-0">
          <DocMargin editor={editor} docId={docId} viewer={viewer} role={role} draft={draft} onDraftDone={() => setDraft(null)} />
        </div>
      </div>

      {editing ? (
        <div className="flex flex-wrap items-center gap-2 px-2 py-1 text-label font-bold text-ink">
          {savedAt === null ? (
            <span className="bg-bubble-pale px-1 text-ink-bar">UNSAVED</span>
          ) : (
            <span>
              SAVED :: <TimeStamp at={savedAt} />
            </span>
          )}
          {saving ? <span>SAVING...</span> : null}
          {saveError === null ? null : <span className="bg-bubble-pale px-1 text-ink-bar">{saveError}</span>}
          <button type="button" className={`ml-auto ${PLATE}`} onClick={saveNow} disabled={saving}>
            [ SAVE NOW ]
          </button>
        </div>
      ) : null}
    </section>
  );
}
