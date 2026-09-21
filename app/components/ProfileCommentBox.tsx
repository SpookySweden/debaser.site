'use client';

import { useState } from 'react';
import { validateProfileComment } from '../lib/profile/visibility';
import SheetImage from './SheetImage';

const FIELD =
  'mt-1 w-full rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-2 font-mono text-xs text-black outline-none';

const BUTTON =
  'cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-3 py-1 text-xs font-bold text-black hover:bg-gray-300 disabled:cursor-wait disabled:opacity-60';

export type CommentVersionOption = {
  id: string;
  label: string;
  /**
   * The drawing itself, shown as a preview while the option is hovered. A pointer
   * device gets that; a touch screen has no hover, which is why choosing an option
   * inside the comment window also swaps the picture the window is showing.
   */
  preview?: { src: string; alt: string; width: number; height: number };
};

type ProfileCommentBoxProps = {
  /** Unique id for the textarea, so the window can focus it on open. */
  id: string;
  title: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (body: string) => Promise<void>;
  /** Picture comments pick a version; the default is the current drawing. */
  versions?: CommentVersionOption[];
  versionId?: string;
  onVersionChange?: (versionId: string) => void;
  versionLabel?: string;
  /** When set, the box is replaced by this notice. */
  closedNotice?: string | null;
};

/**
 * The Win95 comment box used for both kinds of profile comment: the ones left
 * on the profile itself, and the ones left on the picture.
 *
 * The caller supplies the write itself (so the box works on your own profile in
 * the customiser and on someone else's page), and picture comments carry the
 * version they are attached to.
 */
export default function ProfileCommentBox({
  id,
  title,
  placeholder,
  submitLabel,
  onSubmit,
  versions,
  versionId,
  onVersionChange,
  versionLabel = 'ATTACHED TO:',
  closedNotice,
}: ProfileCommentBoxProps) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  if (closedNotice !== undefined && closedNotice !== null) {
    return (
      <p className="mt-2 rounded-none border border-gray-500 bg-[#f0f0f0] p-2 text-[10px] font-bold text-black">
        {closedNotice}
      </p>
    );
  }

  async function handleSubmit() {
    const problem = validateProfileComment(body);
    if (problem !== undefined) {
      setError(problem);
      setStatus(null);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await onSubmit(body);
      setBody('');
      setStatus('FILED.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'UNKNOWN ERROR');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] p-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold text-black">
        <span>{title}</span>
        <span>{body.trim().length} CHARS</span>
      </div>

      {versions === undefined || onVersionChange === undefined ? null : (
        <div className="mt-1 text-[10px] font-bold text-black">
          <p>{versionLabel}</p>

          <ul className="mt-1 flex flex-wrap gap-1">
            {versions.map((version) => (
              <li key={version.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onVersionChange(version.id)}
                  className={`${BUTTON} ${
                    version.id === versionId ? 'bg-[#000080] text-white hover:bg-[#000080]' : ''
                  }`}
                  title={version.preview === undefined ? undefined : `${version.preview.src} :: HOVER TO SEE IT`}
                >
                  {version.label}
                </button>

                {/* Desktop: the drawing appears while the pointer rests on the button. */}
                {version.preview === undefined ? null : (
                  <span className="pointer-events-none absolute bottom-full left-0 z-10 mb-1 hidden w-40 rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] p-1 group-hover:block">
                    <SheetImage
                      src={version.preview.src}
                      alt={version.preview.alt}
                      width={version.preview.width}
                      height={version.preview.height}
                      sizes="160px"
                    />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <textarea
        id={id}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={placeholder}
        rows={3}
        className={FIELD}
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void handleSubmit()} disabled={busy} className={BUTTON}>
          {busy ? '[ WORKING... ]' : submitLabel}
        </button>
        {error === null ? null : <p className="text-[10px] font-bold text-[#800000]">{error}</p>}
        {status === null ? null : <p className="text-[10px] font-bold text-black">{status}</p>}
      </div>
    </div>
  );
}
