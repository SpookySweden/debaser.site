import { mergeAttributes, Node } from '@tiptap/react';
import { isOwnPicture, PICTURE_MAX_BYTES, PICTURE_MAX_EDGE, PICTURE_TYPES } from './rules';

/**
 * A picture in a document: one block holding the address of a file in our own bucket.
 *
 * A document is written by other people, so a picture whose address is anywhere else is drawn as a
 * line saying so instead of an image (no tracking pixels, nothing hotlinked from elsewhere).
 */

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    docPicture: {
      insertPicture: (src: string) => ReturnType;
    };
  }
}

export function docPictureNode(base: string) {
  return Node.create({
    name: 'image',
    group: 'block',
    atom: true,
    draggable: true,

    addAttributes() {
      return {
        src: { default: null },
      };
    },

    parseHTML() {
      return [{ tag: 'img[src]' }];
    },

    renderHTML({ HTMLAttributes }) {
      const src: unknown = HTMLAttributes.src;
      if (!isOwnPicture(src, base)) {
        return ['p', { class: 'doc-picture-refused' }, '[ A PICTURE FROM ELSEWHERE: NOT SHOWN ]'];
      }
      return ['img', mergeAttributes({ class: 'doc-picture', alt: 'A picture in the document', loading: 'lazy' }, { src })];
    },

    addCommands() {
      return {
        insertPicture:
          (src: string) =>
          ({ commands }) =>
            commands.insertContent({ type: this.name, attrs: { src } }),
      };
    },
  });
}

/**
 * A chosen file made fit to file: at most 1600px on its longest edge and 1 MB, as a JPEG (a PNG or a
 * GIF stays as it is when it is already small enough, so a drawing keeps its hard edges and a GIF
 * keeps moving). Refused in plain words when it cannot be made to fit.
 */
export async function shrinkPicture(file: File): Promise<Blob> {
  if (!PICTURE_TYPES.includes(file.type)) throw new Error('PNG, JPG, WEBP OR GIF ONLY.');

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (bitmap === null) throw new Error('THAT FILE DID NOT OPEN AS A PICTURE.');

  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= PICTURE_MAX_EDGE && file.size <= PICTURE_MAX_BYTES && file.type !== 'image/webp') {
    bitmap.close();
    return file;
  }
  if (file.type === 'image/gif') {
    bitmap.close();
    throw new Error('THAT GIF IS TOO BIG: 1600PX AND 1 MB AT MOST.');
  }

  const scale = Math.min(1, PICTURE_MAX_EDGE / longest);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('THIS BROWSER COULD NOT SHRINK THE PICTURE.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const keepsEdges = file.type === 'image/png';
  for (const quality of [0.9, 0.8, 0.7, 0.6, 0.5]) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, keepsEdges && quality === 0.9 ? 'image/png' : 'image/jpeg', quality),
    );
    if (blob !== null && blob.size <= PICTURE_MAX_BYTES) return blob;
  }

  throw new Error('THAT PICTURE STAYS OVER 1 MB EVEN SHRUNK.');
}
