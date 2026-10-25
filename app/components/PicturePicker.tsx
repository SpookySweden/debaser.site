'use client';

import { useMemo, useState } from 'react';
import type { ForumAuthor } from '../lib/forum/types';
import { useCatalogue } from '../lib/media/catalogue';
import { pictureTiles } from '../lib/media/uses';
import { PLATE } from '../lib/ui/controls';
import MediaPicker from './MediaPicker';
import MediaUploadWindow from './MediaUploadWindow';

type PicturePickerProps = {
  id: string;
  /** The chosen catalogue item's id, or '' for none. */
  value: string;
  onChange: (id: string) => void;
  /** Whoever is filing: an account gets the upload key, a guest only the pictures already here. */
  author: ForumAuthor;
  /** Height of the picker's icon pane. */
  heightClass?: string;
};

/**
 * The picture a post or reply carries, chosen from the media catalogue - or filed into it first.
 *
 * One component for the new-post window, the reply box and an item's comment box, because the rule
 * it carries has to hold on all three (SPEC-media-catalogue.md, decision 5): every picture the site
 * holds is offered, a new picture goes into the catalogue before it goes onto the post, and the
 * upload window does the matching (the same bytes are the original; a picture that looks the same
 * is pointed out). The composer only learns the chosen id.
 */
export default function PicturePicker({ id, value, onChange, author, heightClass = 'h-24' }: PicturePickerProps) {
  const catalogue = useCatalogue();
  const pictures = useMemo(() => pictureTiles(catalogue.items), [catalogue.items]);
  const [uploading, setUploading] = useState(false);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-label font-bold text-ink">CONTAINING MEDIA:</p>
        {author.id === null ? null : (
          <button
            type="button"
            onClick={() => setUploading(true)}
            className={PLATE}
          >
            [ + UPLOAD ]
          </button>
        )}
      </div>
      <div className="mt-1">
        <MediaPicker id={id} items={pictures} value={value} onChange={onChange} heightClass={heightClass} />
      </div>
      {uploading ? (
        <MediaUploadWindow
          uploader={author.id === null ? null : { id: author.id, displayName: author.displayName }}
          items={catalogue.items}
          bytesUsed={catalogue.bytesUsed}
          kinds={['image']}
          onClose={() => setUploading(false)}
          onFiled={(item) => {
            setUploading(false);
            onChange(item.id);
          }}
        />
      ) : null}
    </div>
  );
}
