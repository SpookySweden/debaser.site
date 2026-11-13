'use client';

import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
import { DOCS_SIZE_STACKS_FROM, DOC_FAULT, DOC_KEY, DOC_KEY_ON, roomWords } from '../lib/docs/ui';
import { useDocsSize } from '../lib/docs/use-docs-size';
import DocFace from './DocFace';
import DocMargin, { type CommentDraft } from './DocMargin';
import DocPointers from './DocPointers';
import { DocsSizeKeys } from './DocsScale';

/** The gap kept between the typing spot and the edge of what can be seen, in pixels of scroll (not a look value). */
const CARET_ROOM = 12;

/**
 * Keeps the typing spot in view under the bar. The bar sticks to the top of the scrolling pane and covers
 * the first lines there, which the editor's own scrolling does not know: it would leave the caret behind
 * the toolbar. Answers false (the editor's own scrolling) when there is no pane to scroll.
 */
function keepCaretInView(view: Editor['view']): boolean {
  try {
    let pane: HTMLElement | null = view.dom.parentElement;
    while (pane !== null && !/auto|scroll/.test(window.getComputedStyle(pane).overflowY)) pane = pane.parentElement;
    if (pane === null) return false;

    const caret = view.coordsAtPos(view.state.selection.head);
    const box = pane.getBoundingClientRect();
    const bar = view.dom.closest('section')?.querySelector<HTMLElement>('.docs-bar') ?? null;
    const stuck = bar !== null && window.getComputedStyle(bar).position === 'sticky';
    const topEdge = Math.max(box.top, stuck ? bar.getBoundingClientRect().bottom : box.top) + CARET_ROOM;
    const bottomEdge = box.bottom - CARET_ROOM;

    if (caret.top < topEdge) pane.scrollTop -= topEdge - caret.top;
    else if (caret.bottom > bottomEdge) pane.scrollTop += caret.bottom - bottomEdge;
    return true;
  } catch {
    return false;
  }
}

type ToolKeyProps = {
  /** A text character beside the word (never a drawn icon): hidden from screen readers, which read the word. */
  glyph: ReactNode;
  label: string;
  /** Whether what it does is on where the typing spot is (BOLD inside bold words). Leave out for a key that is not a switch. */
  on?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

/** One key of the toolbar: big, labelled, a thumb tall. `[ B BOLD ]`. */
function ToolKey({ glyph, label, on, disabled = false, onClick }: ToolKeyProps) {
  return (
    <button type="button" className={`${on === true ? DOC_KEY_ON : DOC_KEY} whitespace-nowrap`} aria-pressed={on} disabled={disabled} onClick={onClick}>
      [ <span aria-hidden="true">{glyph}</span> {label} ]
    </button>
  );
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
  saveError: string | null;
  /** Hands the editor up, for the history window's restore. */
  onEditor: (editor: Editor | null) => void;
};

/**
 * A document's editor: Tiptap over the shared Yjs document, with everyone's carets (picture and name),
 * everyone's pointers, pictures, checklists and margin comments.
 *
 * Laid out for someone who does not use computers much (Luke, 2026-11-13): one bar that stays at the top
 * while the page scrolls, holding the saved state in plain words (ALL CHANGES SAVED), who is here, and one
 * toolbar of big labelled keys; under it one large framed page; comments in a side panel that opens and
 * shuts. Nothing appears on hover.
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
  /** Typing waiting for its save: SAVING... until it lands. */
  const [pending, setPending] = useState(false);
  /** The rarer keys' second row. */
  const [more, setMore] = useState(false);
  /** COMMENT pressed with no words selected: says what to do first. */
  const [needsWords, setNeedsWords] = useState(false);
  /** The comments panel: the reader's own choice once they press its key; until then it is open while there are comments. */
  const [commentsChoice, setCommentsChoice] = useState<boolean | null>(null);
  const [commentCount, setCommentCount] = useState(0);
  const { size } = useDocsSize();

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
      editorProps: { attributes: { class: 'lore-document doc-document', 'aria-label': 'The document' }, handleScrollToSelection: keepCaretInView },
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
    setPending(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setPending(false);
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
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setPending(false);
    latest.current = editor.getText();
    onSave(latest.current);
  }

  function startComment(): void {
    if (editor === null) return;
    const { from, to } = editor.state.selection;
    if (from === to) {
      setNeedsWords(true);
      return;
    }
    const anchorFrom = placeAt(editor, from);
    const anchorTo = placeAt(editor, to);
    if (anchorFrom === null || anchorTo === null) return;
    setNeedsWords(false);
    setCommentsChoice(true);
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

  const onCommentCount = useCallback((count: number) => setCommentCount(count), []);
  const onDraftDone = useCallback(() => setDraft(null), []);

  const others = peers.filter((peer) => !peer.self);
  const showComments = draft !== null || (commentsChoice ?? commentCount > 0);
  // Beside the page while the text is a size a narrow panel can hold; under it at the two biggest steps.
  const beside = showComments && size < DOCS_SIZE_STACKS_FROM;
  const tools = editor !== null && marks !== null && editing;

  return (
    <section>
      <div className="docs-bar sticky top-0 z-10 border-b-line border-ink bg-paper">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 py-2">
          <span className="docs-key inline-flex flex-wrap items-center gap-2 text-ink" role="status" aria-live="polite" data-doc-saved={!editing ? 'reading' : pending || saving ? 'saving' : saveError !== null ? 'failed' : 'saved'}>
            {!editing ? (
              'YOU CAN READ THIS, NOT CHANGE IT'
            ) : pending || saving ? (
              'SAVING...'
            ) : saveError !== null ? (
              <>
                <span className="bg-bubble-pale px-2 py-1 text-ink-bar">NOT SAVED</span>
                <span className="docs-meta">{saveError}</span>
              </>
            ) : (
              <>
                <span aria-hidden="true">✓</span> ALL CHANGES SAVED
              </>
            )}
          </span>
          {editing && saveError !== null && !pending && !saving ? (
            <button type="button" className={DOC_KEY} onClick={saveNow}>
              [ TRY AGAIN ]
            </button>
          ) : null}

          <span className="docs-people docs-meta inline-flex flex-wrap items-center gap-2 text-ink">
            {roomWords(status === 'SYNCING', others.length, editing)}
            {editing ? <DocFace name={identity.name} colour={identity.colour} userId={identity.userId} self /> : null}
            {others.map((peer) => (
              <DocFace key={peer.clientId} name={peer.name} colour={peer.colour} userId={peer.userId} />
            ))}
          </span>

          <span className="ml-auto inline-flex flex-wrap items-center gap-x-4 gap-y-1">
            <DocsSizeKeys />
            <button
              type="button"
              className={`${showComments ? DOC_KEY_ON : DOC_KEY} whitespace-nowrap`}
              aria-expanded={showComments}
              disabled={draft !== null}
              onClick={() => setCommentsChoice(!showComments)}
            >
              [ COMMENTS{commentCount > 0 ? ` ${commentCount}` : ''} ]
            </button>
          </span>
        </div>

        {tools ? (
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1 pb-2" role="toolbar" aria-label="Writing tools">
            <ToolKey glyph="↶" label="UNDO" onClick={() => editor.chain().focus().undo().run()} />
            <ToolKey glyph="↷" label="REDO" onClick={() => editor.chain().focus().redo().run()} />
            <ToolKey glyph="B" label="BOLD" on={marks.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
            <ToolKey glyph="I" label="ITALIC" on={marks.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
            <ToolKey glyph="H" label="HEADING" on={marks.h1} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
            <ToolKey glyph="•" label="LIST" on={marks.bullets} onClick={() => editor.chain().focus().toggleBulletList().run()} />
            <ToolKey glyph="1." label="NUMBERS" on={marks.numbers} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
            <ToolKey glyph="☑" label="CHECKLIST" on={marks.checklist} onClick={() => editor.chain().focus().toggleTaskList().run()} />
            <ToolKey glyph="▣" label={uploading ? 'ADDING...' : 'PICTURE'} disabled={uploading} onClick={() => pictureInput.current?.click()} />
            <input
              ref={pictureInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="sr-only"
              tabIndex={-1}
              aria-label="Picture to add"
              onChange={(event) => void addPicture(event.target.files?.[0])}
            />
            <ToolKey glyph="✎" label="COMMENT" onClick={startComment} />
            <button type="button" className={`${more ? DOC_KEY_ON : DOC_KEY} whitespace-nowrap`} aria-expanded={more} onClick={() => setMore((value) => !value)}>
              [ MORE <span aria-hidden="true">{more ? '▴' : '▾'}</span> ]
            </button>
          </div>
        ) : null}

        {tools && more ? (
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1 pb-2" role="toolbar" aria-label="More writing tools">
            <ToolKey glyph="h" label="SMALL HEADING" on={marks.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
            <ToolKey glyph={<span className="line-through">S</span>} label="STRIKE OUT" on={marks.strike} onClick={() => editor.chain().focus().toggleStrike().run()} />
            <ToolKey glyph="❝" label="QUOTE" on={marks.quote} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
            <ToolKey glyph="—" label="LINE ACROSS" onClick={() => editor.chain().focus().setHorizontalRule().run()} />
          </div>
        ) : null}

        {tools && needsWords && !marks.picked ? <p className="docs-meta pb-2 text-ink">FIRST SELECT THE WORDS IT IS ABOUT, THEN PRESS COMMENT.</p> : null}
        {pictureNote === null ? null : <p className={`${DOC_FAULT} mb-2`}>{pictureNote}</p>}
      </div>

      <div className={beside ? 'mt-3 lg:grid lg:grid-cols-4 lg:gap-4' : 'mt-3'}>
        <div ref={frame} className={`doc-frame frame relative bg-paper ${beside ? 'lg:col-span-3' : ''}`}>
          <EditorContent editor={editor} />
          <DocPointers editor={editor} session={session} peers={peers} frame={frame} sends={editing} />
        </div>

        <div className={showComments ? (beside ? 'pt-3 lg:pt-0' : 'pt-3') : 'hidden'}>
          <DocMargin editor={editor} docId={docId} viewer={viewer} role={role} draft={draft} beside={beside} onCount={onCommentCount} onDraftDone={onDraftDone} />
        </div>
      </div>
    </section>
  );
}
