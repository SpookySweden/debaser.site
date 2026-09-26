'use client';

import { useState } from 'react';
import { PLATE, PLATE_LARGE } from '../lib/ui/controls';
import { summarise, type UnsavedChange } from '../lib/profile/unsaved-changes';
import PopoutWindow from './PopoutWindow';

type UnsavedPromptProps = {
  /** What would be lost. Empty means the prompt should not be shown at all - see the caller. */
  changes: readonly UnsavedChange[];
  /** What the reader was trying to do, so the prompt says *that* rather than a generic warning. */
  intent: 'close' | 'switch-tab';
  /** Go back to the work, having discarded nothing. */
  onStay: () => void;
  /** Lose the changes and continue what was asked for. */
  onDiscard: () => void;
  /** Save what can be saved, then continue. Absent when nothing here is saveable. */
  onSave?: () => Promise<void> | void;
};

/**
 * "You have unsaved changes" - as a window that lists them, with the list folded away by default.
 *
 * **The list is collapsible, and closed by default, which is the opposite of what a warning usually does.** A
 * three-line summary at the top already tells a reader whether they care; expanding is for the ones who do not
 * trust the summary or cannot remember what they did. Opening it automatically would make every close a wall of
 * text, and the reader who is closing *on purpose* would learn to click through - which is exactly how a prompt
 * stops being read.
 *
 * **The count is in the title bar and on the button that opens the list**, so the number is visible in both states.
 * Hiding it inside the collapsed region would mean the reader who most needs it - the one who has not expanded -
 * cannot see it.
 *
 * **Three ways out, and the safe one is the one that looks like the default.** `[ GO BACK ]` comes first and is
 * styled as the ordinary plate; discarding is on its own after a separator and wears the warning colour, because
 * the whole point of this window is to make losing work take a deliberate second press.
 */
export default function UnsavedPrompt({ changes, intent, onStay, onDiscard, onSave }: UnsavedPromptProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const what = intent === 'close' ? 'CLOSING THIS' : 'SWITCHING TAB';

  return (
    <PopoutWindow
      title={`${summarise(changes)} :: ${what} WOULD LOSE THEM`}
      badge="[ HOLD ON ]"
      onClose={onStay}
      maxWidth="max-w-xl"
      dismissOnBackdrop={false}
      status="NOTHING HAS BEEN THROWN AWAY YET :: GO BACK AND IT IS ALL STILL THERE"
    >
      <div className="space-y-2 text-[10px] text-ink">
        <p className="font-bold">
          YOU HAVE {summarise(changes)} THAT HAVE NOT BEEN SAVED. {what} PAGES THEM AWAY, AND THERE IS NO UNDO.
        </p>

        <div className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale">
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            aria-controls="unsaved-list"
            className="flex w-full cursor-pointer items-center justify-between border-b-2 border-b-black px-2 py-1 text-left font-bold hover:bg-ice"
          >
            <span>{open ? '▼' : '▶'} WHAT IS UNSAVED</span>
            <span>[ {changes.length} ]</span>
          </button>

          {open ? (
            <ol id="unsaved-list" className="divide-y divide-ink">
              {changes.map((change, index) => (
                <li key={`${change.tab}-${change.label}-${index}`} className="px-2 py-1">
                  <p className="font-bold">
                    {change.label}
                    <span className="ml-2 font-normal text-ink-plate">ON THE {change.tab.toUpperCase()} TAB</span>
                  </p>
                  <p className="text-ink-plate">{change.detail}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p id="unsaved-list" className="px-2 py-1 text-ink-plate">
              FOLDED AWAY. PRESS THE BAR ABOVE TO SEE ALL {changes.length}.
            </p>
          )}
        </div>

        {/*
         * The character figure's entry says it cannot be saved, and this line says what to do about it. Without
         * this the prompt would list a thing the reader cannot act on, which is worse than not mentioning it.
         */}
        {changes.some((change) => change.tab === 'character') ? (
          <p className="text-ink-plate">
            THE FIGURE IS NOT STORED ANYWHERE YET, SO NO SAVE WILL KEEP IT - GO BACK AND LEAVE THE TAB OPEN IF IT
            MATTERS, OR CARRY ON AND BUILD IT AGAIN LATER.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" onClick={onStay} className={PLATE_LARGE} autoFocus>
            [ GO BACK AND KEEP WORKING ]
          </button>

          {onSave === undefined ? null : (
            <button
              type="button"
              className={PLATE}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                // The caller saves what it can and then closes; `busy` is only here so a second press while the
                // write is in flight cannot fire a second one.
                void Promise.resolve(onSave()).finally(() => setBusy(false));
              }}
            >
              {busy ? '[ SAVING… ]' : '[ SAVE WHAT CAN BE SAVED ]'}
            </button>
          )}

          <span className="grow" />

          <button
            type="button"
            onClick={onDiscard}
            className={`${PLATE} border-bubble-pale bg-bubble-pale text-paper hover:bg-bubble`}
          >
            [ THROW THEM AWAY ]
          </button>
        </div>
      </div>
    </PopoutWindow>
  );
}
