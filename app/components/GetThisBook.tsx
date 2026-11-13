'use client';

import { useState } from 'react';
import { getBookLinks } from '../lib/books/get-book';
import { PLATE, PLATE_PRESSED } from '../lib/ui/controls';

/**
 * GET THIS BOOK (Luke, 2026-11-13): a dropdown on a book's page with every legal way to get it: borrow it free, find it in
 * a library, buy it, listen to it, preview it. Each opens the service's own site in a new tab.
 */
export default function GetThisBook({ title, author, isbn, work }: { title: string; author?: string; isbn?: string; work?: string }) {
  const [open, setOpen] = useState(false);
  const groups = getBookLinks({ title, author, isbn, work });
  return (
    <div className="px-3 py-1">
      <button type="button" onClick={() => setOpen((was) => !was)} aria-expanded={open} className={open ? PLATE_PRESSED : PLATE}>
        {open ? '[ GET THIS BOOK ▴ ]' : '[ GET THIS BOOK ▾ ]'}
      </button>
      {open ? (
        <div className="mt-1 grid grid-cols-1 gap-3 border border-ink bg-sun-pale p-2 sm:grid-cols-2">
          {groups.map((group) => (
            <section key={group.heading} aria-label={group.heading}>
              <h3 className="text-label font-bold text-ink">{group.heading}</h3>
              <ul className="mt-1 flex flex-col gap-1">
                {group.links.map((link) => (
                  <li key={link.label} className="text-label">
                    <a href={link.href} target="_blank" rel="noopener noreferrer" className="text-accent-ink underline" aria-label={`${link.label}: ${link.note} (opens a new tab)`}>
                      {link.label} ↗
                    </a>
                    <span className="text-ink-quiet"> {link.note}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
