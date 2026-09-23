'use client';

import { authorTag } from '../lib/auth/author';
import { ARCHIVE_MEDIA } from '../lib/concepts/sheets';
import { type Mentionable } from '../lib/forum/mentions';
import type { ForumAuthor, ForumTag } from '../lib/forum/types';
import { useForum } from './ForumProvider';
import MediaPicker from './MediaPicker';
import MentionPicker from './MentionPicker';
import ProfileName from './ProfileName';
import TagChooser from './TagChooser';
import { TagRow } from './TagBadge';
import { PLATE_LARGE } from '../lib/ui/controls';

type CommentComposerProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  submitLabel: string;
  placeholder: string;
  author: ForumAuthor;
  /** Live auto-tag preview, so posters can see how their post will be filed. */
  previewTags?: ForumTag[];
  /** Selected user tags; omit both tag props to hide the chooser. */
  tags?: string[];
  onTagsChange?: (labels: string[]) => void;
  /**
   * Accounts that can be tagged with `@`. Omitted (or empty) where there is nobody to tag -
   * a guest's reply box, or a page that has no account list to hand.
   */
  accounts?: Mentionable[];
  /** The author this box answers: tagged without being asked, and said so. */
  autoTag?: Mentionable | null;
  /** Optional image attachment: omit both media props to hide the picker. */
  mediaId?: string;
  onMediaIdChange?: (id: string) => void;
  busy?: boolean;
  error?: string | null;
  status?: string | null;
  rows?: number;
};

/**
 * Shared Win95 textarea + submit block. Used by the New Post form, the reply
 * forms inside threads, and every comment box dropped under a site asset.
 *
 * Artwork is picked the way the new-post window picks it - a pane of thumbnails with the chosen
 * sheet shown beside it (see ./MediaPicker.tsx) - because a reply can carry a picture too, and
 * two different media controls in one window is one too many.
 */
export default function CommentComposer({
  id,
  value,
  onChange,
  onSubmit,
  submitLabel,
  placeholder,
  author,
  previewTags,
  tags,
  onTagsChange,
  accounts = [],
  autoTag = null,
  mediaId,
  onMediaIdChange,
  busy = false,
  error = null,
  status = null,
  rows = 3,
}: CommentComposerProps) {
  const { tagVocabulary } = useForum();
  const showTagChooser = tags !== undefined && onTagsChange !== undefined;
  const showMediaPicker = mediaId !== undefined && onMediaIdChange !== undefined;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="mt-2 border border-gray-600 bg-[#c0c0c0] p-2"
    >
      <div className="mb-1 flex items-center justify-between text-[10px] font-bold text-black">
        <span>
          AUTHOR: <ProfileName author={author}>{authorTag(author)}</ProfileName>
        </span>
        <span>{value.trim().length} CHARS</span>
      </div>

      <textarea
        id={id}
        aria-label="Comment body"
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-2 font-mono text-xs text-black outline-none max-sm:p-3"
      />

      {previewTags !== undefined && previewTags.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px] font-bold text-black">
          <span>AUTO TAGS:</span>
          <TagRow tags={previewTags} />
        </div>
      ) : null}

      {showTagChooser ? (
        <TagChooser id={`${id}-tags`} value={tags} onChange={onTagsChange} options={tagVocabulary} />
      ) : null}

      {/* Tagging an account: the same strip the new-post window uses, so a reply can name
          somebody - and says so when the reply answers somebody and tags them by itself. */}
      <MentionPicker id={`${id}-mentions`} accounts={accounts} body={value} onChange={onChange} autoTag={autoTag} />

      {showMediaPicker ? (
        <div className="mt-2">
          <p className="text-[10px] font-bold text-black">CONTAINING MEDIA:</p>
          <div className="mt-1">
            <MediaPicker
              id={`${id}-media`}
              items={ARCHIVE_MEDIA}
              value={mediaId ?? ''}
              onChange={onMediaIdChange ?? (() => undefined)}
              heightClass="h-24"
            />
          </div>
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className={PLATE_LARGE}
        >
          {busy ? '[ WORKING... ]' : submitLabel}
        </button>

        {error !== null ? (
          <span className="text-[10px] font-bold text-[#800000]">ERROR: {error}</span>
        ) : null}

        {error === null && status !== null ? (
          <span className="text-[10px] font-bold text-[#006000]">OK: {status}</span>
        ) : null}
      </div>
    </form>
  );
}
