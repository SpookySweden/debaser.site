'use client';

import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import type { LoreIdentity, LorePeer, LoreStatus } from '../lib/lore/session';
import { lorePresence } from '../lib/lore/session';
import { LORE_DOCUMENT_FIELD } from '../lib/lore/types';
import { PLATE, TITLE_BAR } from '../lib/ui/controls';
import TimeStamp from './TimeStamp';

/**
 * The page's editor: Tiptap over a Yjs document, with a Win95 toolbar and a filing line.
 *
 * The document is the row's own state and nothing else - not a string seeded into the editor.
 * Two tabs priming the same page from the same paragraph would each add their own copy of it, so
 * the *only* thing that puts words in is somebody typing; the initial content travels as Yjs
 * updates, from whoever has it (see ../lib/lore/session.ts).
 *
 * The toolbar is the whole of the formatting this archive allows itself: headings, bold, italic,
 * strike, code, lists, a quote and a rule. Undo and redo come from the collaboration extension's
 * own history rather than from ProseMirror's, because history has to be per-editor: the thing
 * being undone is *your own* last edit, not whoever else typed in between.
 */

/** How long the editor waits after the last keystroke before filing the page. */
export const SAVE_AFTER_MS = 2500;

/** What the room's line says, in the site's own words. */
export const LORE_STATUS_LINES: Record<LoreStatus, string> = {
  SYNCING: 'ASKING WHO ELSE IS HERE...',
  LIVE: 'LIVE :: WHAT YOU TYPE IS ALREADY ON EVERYBODY ELSE\'S PAGE',
  ALONE: 'NOBODY ELSE IS ON THIS PAGE :: WHAT YOU WRITE IS FILED AS YOU GO',
};

/** A toolbar plate that reads as pressed while the mark it toggles is on the cursor. */
function toolClass(isOn: boolean): string {
  return isOn
    ? 'cursor-pointer rounded-none border-t-2 border-l-2 border-black border-r border-b border-white bg-gray-300 px-2 py-[2px] text-[10px] font-bold text-black'
    : PLATE;
}

type LoreEditorProps = {
  doc: Y.Doc;
  awareness: Awareness;
  /** Who this tab is: the name on the caret and in the room's list. */
  user: LoreIdentity;
  peers: LorePeer[];
  status: LoreStatus;
  /** Files the writing. A refusal is the page's to draw, so this never rejects. */
  onSave: (text: string) => void;
  saving: boolean;
  savedAt: string | null;
  saveError: string | null;
};

export default function LoreEditor({
  doc,
  awareness,
  user,
  peers,
  status,
  onSave,
  saving,
  savedAt,
  saveError,
}: LoreEditorProps) {
  const latest = useRef('');
  const timer = useRef<number | null>(null);

  const editor = useEditor(
    {
      extensions: [
        // History belongs to the collaboration extension when a page is shared: `undoRedo` on its
        // own would step back through everybody's edits rather than this editor's own.
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({ document: doc, field: LORE_DOCUMENT_FIELD }),
        // The carets. `provider` is only read for its `awareness`, which is what makes one
        // editor's cursor visible in another's page. The name and colour are written the way the
        // wire spells them (see `lorePresence`).
        CollaborationCaret.configure({ provider: { awareness }, user: lorePresence(user) }),
      ],
      // The editor is only mounted on the client, once the row has been read, so it never has to
      // render on the server - where there is no document and nowhere to put a caret.
      immediatelyRender: false,
      editorProps: {
        attributes: { class: 'lore-document', 'aria-label': 'The page' },
      },
      onUpdate: ({ editor: instance }) => schedule(instance.getText()),
    },
    [awareness, doc],
  );

  function schedule(text: string): void {
    latest.current = text;

    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      onSave(latest.current);
    }, SAVE_AFTER_MS);
  }

  useEffect(() => {
    // The last keystrokes are not left behind: walking away from the page files what is there, and
    // so does a tab being put away - which is the moment before a browser is closed.
    const flush = () => {
      if (latest.current.length > 0) onSave(latest.current);
    };

    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };

    document.addEventListener('visibilitychange', onHidden);

    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      if (timer.current !== null) window.clearTimeout(timer.current);
      flush();
    };
  }, [onSave]);

  function saveNow(): void {
    if (editor === null) return;

    latest.current = editor.getText();
    onSave(latest.current);
  }

  return (
    <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
      <div className={TITLE_BAR}>
        <span>THE PAGE :: {peers.length === 1 ? '1 EDITOR' : `${peers.length} EDITORS`}</span>
        <span>{LORE_STATUS_LINES[status]}</span>
      </div>

      {/* Whose carets are in it, in the colours those names wear everywhere else. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-500 bg-[#f0f0f0] px-2 py-1 text-[10px] font-bold text-black">
        <span>IN THE ROOM:</span>
        {peers.map((peer) => (
          <span key={peer.clientId} className="border border-black bg-white px-1" style={{ color: peer.colour }}>
            {peer.self ? `${peer.name} (YOU)` : peer.name}
          </span>
        ))}
      </div>

      {/* The toolbar. Every plate toggles one mark, and reads pressed while that mark is on. */}
      {editor === null ? null : (
        <div className="flex flex-wrap items-center gap-1 border-b border-gray-500 px-2 py-1">
          <button type="button" className={toolClass(editor.isActive('bold'))} onClick={() => editor.chain().focus().toggleBold().run()}>
            [ BOLD ]
          </button>
          <button type="button" className={toolClass(editor.isActive('italic'))} onClick={() => editor.chain().focus().toggleItalic().run()}>
            [ ITALIC ]
          </button>
          <button type="button" className={toolClass(editor.isActive('strike'))} onClick={() => editor.chain().focus().toggleStrike().run()}>
            [ STRIKE ]
          </button>
          <button type="button" className={toolClass(editor.isActive('code'))} onClick={() => editor.chain().focus().toggleCode().run()}>
            [ CODE ]
          </button>
          <button type="button" className={toolClass(editor.isActive('heading', { level: 1 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
            [ H1 ]
          </button>
          <button type="button" className={toolClass(editor.isActive('heading', { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
            [ H2 ]
          </button>
          <button type="button" className={toolClass(editor.isActive('bulletList'))} onClick={() => editor.chain().focus().toggleBulletList().run()}>
            [ BULLETS ]
          </button>
          <button type="button" className={toolClass(editor.isActive('orderedList'))} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
            [ NUMBERS ]
          </button>
          <button type="button" className={toolClass(editor.isActive('blockquote'))} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            [ QUOTE ]
          </button>
          <button type="button" className={PLATE} onClick={() => editor.chain().focus().setHorizontalRule().run()}>
            [ RULE ]
          </button>

          <span className="ml-auto flex items-center gap-1">
            {/* Undo is this tab's own history, which is what the collaboration extension keeps. */}
            <button type="button" className={PLATE} onClick={() => editor.chain().focus().undo().run()}>
              [ UNDO ]
            </button>
            <button type="button" className={PLATE} onClick={() => editor.chain().focus().redo().run()}>
              [ REDO ]
            </button>
          </span>
        </div>
      )}

      <div className="p-2">
        <EditorContent editor={editor} />
      </div>

      {/* The filing line: what the shelf has, and the button that files what it does not. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-gray-500 px-2 py-1 text-[10px] font-bold text-black">
        {savedAt === null ? (
          <span className="text-[#800000]">NOT FILED YET :: THE ROOM SEES IT, THE SHELF DOES NOT</span>
        ) : (
          <span>
            FILED :: <TimeStamp at={savedAt} />
          </span>
        )}

        {saving ? <span>FILING...</span> : null}
        {saveError === null ? null : <span className="text-[#800000]">{saveError}</span>}

        <button type="button" className={`ml-auto ${PLATE}`} onClick={saveNow} disabled={saving}>
          [ SAVE NOW ]
        </button>
      </div>
    </section>
  );
}
