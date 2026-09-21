'use client';

import { useState, type ReactNode } from 'react';
import { validateProfileComment } from '../lib/profile/visibility';

const FIELD =
  'mt-1 w-full rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-2 font-mono text-xs text-black outline-none';

const BUTTON =
  'cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-3 py-1 text-xs font-bold text-black hover:bg-gray-300 disabled:cursor-wait disabled:opacity-60';

type ProfileCommentBoxProps = {
  /** Unique id for the textarea, so the window can focus it on open. */
  id: string;
  title: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (body: string) => Promise<void>;
  /**
   * What the comment is about, drawn where the version buttons used to sit.
   *
   * The caller supplies it rather than the box knowing about pictures and tracks: the
   * profile's comment window passes a run of links - the three aspects, and the version
   * being written about (see ./ProfileCommentWindow) - and the box stays the box.
   */
  chooser?: ReactNode;
  /** A line under the fields, for anything the writer should know before they write. */
  footer?: string | null;
};

/**
 * The Win95 comment box, for everything a profile can be commented on.
 *
 * The caller supplies the write itself (so the box works on your own profile and on
 * somebody else's) and the choices (so one box serves a drawing, a track and the profile
 * without knowing which it is writing about). What is left here is the part that is always
 * the same: the field, the count, the button, and the answer.
 */
export default function ProfileCommentBox({
  id,
  title,
  placeholder,
  submitLabel,
  onSubmit,
  chooser,
  footer,
}: ProfileCommentBoxProps) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

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
      </div>

      {chooser === undefined ? null : <div className="mt-1">{chooser}</div>}

      <textarea
        id={id}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={placeholder}
        rows={3}
        className={FIELD}
      />

      {footer === undefined || footer === null ? null : (
        <p className="mt-1 text-[10px] font-bold text-gray-700">{footer}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void handleSubmit()} disabled={busy} className={BUTTON}>
          {busy ? '[ WORKING... ]' : submitLabel}
        </button>
        <span className="text-[10px] text-gray-700">{body.trim().length} CHARS</span>
        {error === null ? null : <p className="text-[10px] font-bold text-[#800000]">{error}</p>}
        {status === null ? null : <p className="text-[10px] font-bold text-black">{status}</p>}
      </div>
    </div>
  );
}
