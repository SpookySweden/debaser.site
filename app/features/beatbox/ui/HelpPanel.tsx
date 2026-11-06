'use client';

import { useEffect, useRef } from "react";
import { KEY_HELP } from "./keyHelp";
import { bigKey } from "./looks";

/** Every key, in a panel that can also be printed. */
export function HelpPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="beatbox-help-title"
      onClose={onClose}
      className="m-0 h-full max-h-none w-full max-w-none overflow-y-auto bg-bb-nigrosine p-bb-gutter text-bb-white print:static print:h-auto print:overflow-visible print:bg-bb-white print:text-bb-black"
    >
      <div className="flex flex-col items-start gap-bb-gap">
        <h2 id="beatbox-help-title" className="text-bb-title font-bold wrap-anywhere">
          Keys
        </h2>
        <div className="flex flex-wrap gap-bb-gutter print:hidden">
          <button type="button" onClick={onClose} title="Close (Esc)" className={bigKey()}>
            Close
          </button>
          <button type="button" onClick={() => window.print()} className={bigKey()}>
            Print
          </button>
        </div>
        {KEY_HELP.map((group) => (
          <section key={group.title} className="flex w-full flex-col gap-bb-gutter">
            <h3 className="text-bb-large font-bold wrap-anywhere uppercase">{group.title}</h3>
            <dl className="flex flex-col gap-bb-gutter text-bb-large">
              {group.keys.map(([keys, action]) => (
                <div key={keys} className="flex flex-col wrap-anywhere">
                  <dt className="font-bold">{keys}</dt>
                  <dd>{action}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </dialog>
  );
}
