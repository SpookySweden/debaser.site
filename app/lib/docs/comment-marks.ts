import { Extension } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * The words margin comments are left on, shaded in the document.
 *
 * Drawn as decorations, not marks: a mark would be part of the shared text (everybody's undo, every saved
 * copy), while a comment's place is its own row with two relative positions (./anchors.ts). The margin
 * hands this plugin the current ranges whenever the comments or the text change.
 */

export type CommentRange = { id: string; from: number; to: number; active: boolean };

export const commentMarksKey = new PluginKey<DecorationSet>('docCommentMarks');

export const CommentMarks = Extension.create({
  name: 'docCommentMarks',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: commentMarksKey,
        state: {
          init: () => DecorationSet.empty,
          apply(transaction, set) {
            const ranges = transaction.getMeta(commentMarksKey) as CommentRange[] | undefined;
            if (ranges !== undefined) {
              return DecorationSet.create(
                transaction.doc,
                ranges
                  .filter((range) => range.to > range.from)
                  .map((range) =>
                    Decoration.inline(range.from, range.to, {
                      class: range.active ? 'doc-commented doc-commented--on' : 'doc-commented',
                      'data-comment': range.id,
                    }),
                  ),
              );
            }
            return set.map(transaction.mapping, transaction.doc);
          },
        },
        props: {
          decorations(state) {
            return commentMarksKey.getState(state);
          },
        },
      }),
    ];
  },
});
