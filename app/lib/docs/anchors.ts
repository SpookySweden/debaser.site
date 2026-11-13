import type { Editor } from '@tiptap/react';
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { base64ToBytes, bytesToBase64 } from './session';

/**
 * A place in a document's text that survives edits around it: a Yjs relative position, carried as base64.
 *
 * Used twice: a margin comment's words (two of these, start and end), and a pointer (one, plus a small
 * pixel offset). An absolute position (character 120) would drift the moment someone typed above it; a
 * relative one names the character itself, so it moves with the text, in every copy of the document.
 */

type SyncState = {
  doc: Y.Doc;
  type: Y.XmlFragment;
  binding: { mapping: Map<unknown, unknown> } | null;
};

function syncState(editor: Editor): SyncState | null {
  const state = ySyncPluginKey.getState(editor.state) as SyncState | undefined;
  return state === undefined || state.binding === null || state.binding === undefined ? null : state;
}

/** The place at a ProseMirror position, ready to send or store. */
export function placeAt(editor: Editor, position: number): string | null {
  const sync = syncState(editor);
  if (sync === null) return null;

  try {
    const relative = absolutePositionToRelativePosition(position, sync.type, sync.binding?.mapping as never);
    return bytesToBase64(Y.encodeRelativePosition(relative));
  } catch {
    return null;
  }
}

/** Where a stored place is now, or null when its words have been deleted or it does not read. */
export function positionOf(editor: Editor, place: string): number | null {
  const sync = syncState(editor);
  if (sync === null || place.length === 0 || place.length > 400) return null;

  try {
    const relative = Y.decodeRelativePosition(base64ToBytes(place));
    const position = relativePositionToAbsolutePosition(sync.doc, sync.type, relative, sync.binding?.mapping as never);
    if (position === null) return null;
    return Math.max(0, Math.min(position, editor.state.doc.content.size));
  } catch {
    return null;
  }
}
