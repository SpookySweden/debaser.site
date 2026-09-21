'use client';

import { authorTag } from '../lib/auth/author';
import { ARCHIVE_MEDIA } from '../lib/concepts/sheets';
import type { ForumAuthor, ForumTag } from '../lib/forum/types';
import { useForum } from './ForumProvider';
import MediaThumbnail from './MediaThumbnail';
import ProfileName from './ProfileName';
import TagChooser from './TagChooser';
import { TagRow } from './TagBadge';

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
  const attachedMedia = ARCHIVE_MEDIA.find((item) => item.id === mediaId);

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
        className="w-full rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-2 font-mono text-xs text-black outline-none"
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

      {showMediaPicker ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-bold text-black">
          <label htmlFor={`${id}-media`}>CONTAINING MEDIA:</label>
          <select
            id={`${id}-media`}
            value={mediaId ?? ''}
            onChange={(event) => onMediaIdChange?.(event.target.value)}
            className="rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-1 font-mono text-[10px] text-black outline-none"
          >
            <option value="">NONE - TEXT ONLY</option>
            {ARCHIVE_MEDIA.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>

          {attachedMedia === undefined ? null : <MediaThumbnail media={attachedMedia.preview} size={32} />}
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-3 py-1 text-xs font-bold text-black hover:bg-gray-300 disabled:cursor-wait disabled:opacity-60"
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
