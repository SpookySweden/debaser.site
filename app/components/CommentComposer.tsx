'use client';

import { useMemo, useState } from 'react';
import { type Mentionable } from '../lib/forum/mentions';
import { useCatalogue } from '../lib/media/catalogue';
import { pictureTiles } from '../lib/media/uses';
import type { ForumAuthor, ForumTag, ForumTrack } from '../lib/forum/types';
import { useForum } from './ForumProvider';
import MediaPicker from './MediaPicker';
import MediaUploadWindow from './MediaUploadWindow';
import MentionPicker from './MentionPicker';
import TagChooser from './TagChooser';
import TagStrip from './TagStrip';
import TrackControl from './TrackControl';
import { PLATE, PLATE_MAIN } from '../lib/ui/controls';

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
  /** Optional MP3 attachment: omit both track props to hide the control. */
  track?: ForumTrack | null;
  onTrackChange?: (track: ForumTrack | null) => void;
  busy?: boolean;
  error?: string | null;
  status?: string | null;
  rows?: number;
  /**
   * How much of the composer the caller wants.
   *
   * `full` is the window's own form: every attachment control laid out under the box, and the filled
   * main key, because filing is what that window is for. `reply` is the box that opens inside a post,
   * and it is the textarea and a bracket key and nothing else - a reader who has just opened a post is
   * answering it, and the tag chooser, the account tagger, the picture picker and the MP3 control were
   * seven lines of form standing between the words and the button. They are all still there, behind
   * one key, because a reply *can* carry a picture or a track and a feature nobody can find is a
   * feature that was removed. Its submit is a bracket key rather than the filled pill: the board's one
   * main key is `+ NEW POST`, and an open post can hold several reply boxes (SPEC-efficiency.md).
   */
  variant?: 'full' | 'reply';
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
  track,
  onTrackChange,
  busy = false,
  error = null,
  status = null,
  rows = 3,
  variant = 'full',
}: CommentComposerProps) {
  const { tagVocabulary } = useForum();
  const showTagChooser = tags !== undefined && onTagsChange !== undefined;
  const showMediaPicker = mediaId !== undefined && onMediaIdChange !== undefined;
  // Every picture the site holds, not only the concept sheets: the catalogue is what a post picks
  // from, and a new picture goes into the catalogue first (SPEC-media-catalogue.md, decision 5).
  const catalogue = useCatalogue();
  const pictures = useMemo(() => pictureTiles(catalogue.items), [catalogue.items]);
  const [uploadingPicture, setUploadingPicture] = useState(false);
  const showTrackPicker = onTrackChange !== undefined;
  const condensed = variant === 'reply';

  const field = (
    <textarea
      id={id}
      aria-label="Comment body"
      rows={rows}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={`w-full frame bg-paper p-2 font-mono text-prose text-ink outline-none max-sm:p-3${
        condensed ? ' sm:flex-1' : ''
      }`}
    />
  );

  const submit = (
    <button type="submit" disabled={busy} className={condensed ? `${PLATE} sm:shrink-0` : PLATE_MAIN}>
      {busy ? '[ WORKING... ]' : submitLabel}
    </button>
  );

  /** What a reply can carry besides its words: every control the window's own form has. */
  const attachmentControls = (
    <>
      {previewTags !== undefined && previewTags.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1 text-label font-bold text-ink">
          <span>AUTO TAGS:</span>
          <TagStrip tags={previewTags} className="mt-1" />
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-label font-bold text-ink">CONTAINING MEDIA:</p>
            {author.id === null ? null : (
              <button
                type="button"
                onClick={() => setUploadingPicture(true)}
                className={PLATE}
                title="File a picture of your own into the catalogue and attach it"
              >
                [ + UPLOAD A PICTURE ]
              </button>
            )}
          </div>
          <div className="mt-1">
            <MediaPicker
              id={`${id}-media`}
              items={pictures}
              value={mediaId ?? ''}
              onChange={onMediaIdChange ?? (() => undefined)}
              heightClass="h-24"
            />
          </div>
          {uploadingPicture ? (
            <MediaUploadWindow
              uploader={author.id === null ? null : { id: author.id, displayName: author.displayName }}
              items={catalogue.items}
              bytesUsed={catalogue.bytesUsed}
              kinds={['image']}
              onClose={() => setUploadingPicture(false)}
              onFiled={(item) => {
                setUploadingPicture(false);
                onMediaIdChange?.(item.id);
              }}
            />
          ) : null}
        </div>
      ) : null}

      {/* An MP3 can ride along with any post or reply on the site: one plate in the action row, and
          one window for the picking itself (see ./TrackControl.tsx). It used to be a three-source
          fieldset at the bottom of this box, which put it under everything else the composer draws. */}
      {showTrackPicker ? (
        <TrackControl
          id={`${id}-track`}
          value={track ?? null}
          onChange={onTrackChange ?? (() => undefined)}
          author={author}
        />
      ) : null}
    </>
  );

  const hasAttachmentControls =
    showTagChooser ||
    showMediaPicker ||
    showTrackPicker ||
    accounts.length > 0 ||
    (previewTags !== undefined && previewTags.length > 0);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      // No box of its own (a box inside an open post, inside the board): the typing field's frame is
      // what says "write here", as everywhere else since SPEC-efficiency.md flattened the sections.
      className="mt-2"
    >
      {/* No byline and no character count, in either shape (SPEC-efficiency.md): a post is filed as
          whoever is signed in, and a count is only worth showing near a limit - which posts and
          comments do not have, so there is nothing to count towards. */}
      {condensed ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          {field}
          {submit}
        </div>
      ) : (
        <>
          {field}
          {attachmentControls}
          <div className="mt-2 flex flex-wrap items-center gap-3">{submit}</div>
        </>
      )}

      {condensed && hasAttachmentControls ? (
        // One key, one line: what a reply can carry is here rather than in the way. `[ + ATTACH ]`
        // rather than a bare `[ + ]`, which is a puzzle; the list of what is behind it is the tip.
        <details className="mt-1">
          <summary className={PLATE} title="Tags, a picture, an MP3 or an @name">
            [ + ATTACH ]
          </summary>
          <div className="mt-1">{attachmentControls}</div>
        </details>
      ) : null}

      <div className={`flex flex-wrap items-center gap-3${condensed ? ' mt-1' : ' mt-2'}`}>
        {error !== null ? (
          <span className="bg-bubble-pale px-1 text-label font-bold text-ink-bar">ERROR: {error}</span>
        ) : null}

        {error === null && status !== null ? (
          <span className="text-label font-bold text-ink-quiet">OK: {status}</span>
        ) : null}
      </div>
    </form>
  );
}
