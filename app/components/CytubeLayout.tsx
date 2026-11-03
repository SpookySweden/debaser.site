'use client';

import { useState } from 'react';
import { LOOKS, lookClass, type LookChoice, type LookId } from '../lib/cytube/looks';
import { saveLookChoice, useLookChoice } from '../lib/cytube/use-looks';
import { PLATE, PLATE_PRESSED, TITLE_BAR } from '../lib/ui/controls';

/**
 * CUSTOMIZE LAYOUT (SPEC-cytube.md): the look your room is drawn in when you broadcast - one of five presets, or
 * none (your site theme) - and, for other people's rooms, SHOW THE HOST'S LOOK or KEEP MY OWN LOOK. Each press
 * saves at once. No colour picker, no moving parts, no fonts in this version.
 */
export default function CytubeLayout({ userId }: { userId: string }) {
  const choice = useLookChoice(userId);
  const [problem, setProblem] = useState<string | null>(null);

  function save(patch: Partial<LookChoice>) {
    setProblem(null);
    void saveLookChoice(userId, patch).catch((failure: unknown) => setProblem(failure instanceof Error ? failure.message : 'YOUR LOOK COULD NOT BE SAVED.'));
  }

  return (
    <section aria-labelledby="cytube-layout-title" className="flex min-w-0 flex-col gap-2" data-cytube-layout>
      <h2 id="cytube-layout-title" className={TITLE_BAR}>
        YOUR LOOK
      </h2>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Your broadcast look">
        {LOOKS.map((look) => (
          <li key={look.id} role="presentation">
            <LookOption id={look.id} label={look.label} note={look.note} chosen={choice.look === look.id} onPick={() => save({ look: look.id })} />
          </li>
        ))}
        <li role="presentation">
          <LookOption id={null} label="NONE" note="YOUR OWN SITE THEME." chosen={choice.look === null} onPick={() => save({ look: null })} />
        </li>
      </ul>

      <h2 className={TITLE_BAR}>IN OTHER PEOPLE&apos;S ROOMS</h2>
      <LookToggle choice={choice} onChange={save} />
      {problem === null ? null : (
        <p className="w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}

/** One look, drawn as a small room in it: the black screen in its frame, and the bar under it with its words and keys. */
function LookOption({ id, label, note, chosen, onPick }: { id: LookId | null; label: string; note: string; chosen: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={chosen}
      onClick={onPick}
      className={`flex w-full cursor-pointer flex-col gap-1 p-1 text-left ${chosen ? 'bg-ink text-paper' : 'text-ink hover:bg-pointed'}`}
      data-cytube-look={id ?? 'none'}
    >
      <span className="flex items-center gap-2 text-key font-bold">
        <span>{chosen ? '(●)' : '( )'}</span>
        {label}
      </span>
      <LookPreview look={id} />
      <span className="text-label">{note}</span>
    </button>
  );
}

/** A room in a look, small: the screen's frame, the LED's words, the bar's strip, words and a key. */
export function LookPreview({ look }: { look: LookId | null }) {
  return (
    <span className={`flex w-full flex-col ${lookClass(look)}`} aria-hidden="true">
      <span className="flex h-16 items-center justify-center frame bg-hardware [--frame-line:var(--room-lines)]">
        <span className="text-label font-bold text-blank-rest">[ VIDEO ]</span>
      </span>
      <span className="flex items-center gap-2 border-t-line border-room-lines bg-room-bar px-1 py-1 text-label">
        <span className="font-bold text-room-keys">[ TV ]</span>
        <span className="min-w-0 flex-1 truncate frame bg-hardware px-1 font-bold text-room-readout [--frame-line:var(--room-lines)]">LIVE :: TITLE</span>
        <span className="text-room-words">HOST</span>
      </span>
    </span>
  );
}

/** SHOW THE HOST'S LOOK (the default) or KEEP MY OWN LOOK: on the CYTUBE page and in the room. */
export function LookToggle({ choice, onChange, compact = false }: { choice: LookChoice; onChange: (patch: Partial<LookChoice>) => void; compact?: boolean }) {
  return (
    <div className={`flex flex-wrap items-center gap-1 ${compact ? '' : 'text-label text-ink'}`} role="radiogroup" aria-label="Whose look you see in other people's rooms" data-cytube-look-toggle>
      <button type="button" role="radio" aria-checked={choice.showHostLook} onClick={() => onChange({ showHostLook: true })} className={choice.showHostLook ? PLATE_PRESSED : PLATE}>
        [ SHOW THE HOST&apos;S LOOK ]
      </button>
      <button type="button" role="radio" aria-checked={!choice.showHostLook} onClick={() => onChange({ showHostLook: false })} className={!choice.showHostLook ? PLATE_PRESSED : PLATE}>
        [ KEEP MY OWN LOOK ]
      </button>
    </div>
  );
}
