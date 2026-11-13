import Link from 'next/link';
import type { ReactNode } from 'react';
import { docPath } from '../lib/docs/rules';
import type { DocFolder, DocSummary } from '../lib/docs/types';
import { accessWords, whenWords } from '../lib/docs/ui';
import { KEY_FOCUS } from '../lib/ui/controls';

/** A whole row to press: the pointed-at fill, which carries the field's own inks in every theme. */
const ROW_LINK = `flex min-w-0 flex-1 items-start gap-3 px-2 py-3 text-ink hover:bg-pointed ${KEY_FOCUS}`;
/** The text character a row starts with: three lines for a document, a block for a folder. No drawn icons. */
const ROW_MARK = 'docs-text shrink-0 text-accent-ink';

type DocRowProps = {
  doc: DocSummary;
  viewerId: string | null;
  /** The moment the list was read, so "5 MINUTES AGO" is said against one clock for every row. */
  now: number;
  /** The folder it is filed in, said on lists that mix folders (RECENT). */
  folderName?: string | null;
  /** A key at the row's end: [ MOVE ] for its owner. */
  action?: ReactNode;
};

/**
 * One document in a list, as a large row (the DOCS front page and the lore shelf): its title in big
 * letters, then who can open it, whose it is and when it last changed in plain words, then its one line.
 * The whole row opens it.
 */
export function DocRow({ doc, viewerId, now, folderName = null, action }: DocRowProps) {
  const mine = viewerId !== null && doc.ownerId === viewerId;
  const facts = [
    accessWords(doc.access, mine),
    mine ? 'BY YOU' : doc.ownerLabel.length > 0 ? `BY ${doc.ownerLabel}` : null,
    folderName === null ? null : `IN ${folderName}`,
    `CHANGED ${whenWords(doc.updatedAt, now)}`,
  ].filter((fact): fact is string => fact !== null);

  return (
    <li className="rule-pixel flex items-center gap-2" data-doc-row={doc.id}>
      <Link href={docPath(doc)} className={ROW_LINK}>
        <span className={ROW_MARK} aria-hidden="true">
          ≡
        </span>
        <span className="min-w-0 flex-1">
          <span className="docs-text block break-words text-accent-ink underline">{doc.title}</span>
          <span className="docs-meta block">{facts.join(' · ')}</span>
          {doc.summary.length === 0 ? null : <span className="docs-meta block break-words">{doc.summary}</span>}
        </span>
      </Link>
      {action}
    </li>
  );
}

type FolderRowProps = {
  folder: DocFolder;
  href: string;
};

/** One folder in a list, as the same large row. */
export function FolderRow({ folder, href }: FolderRowProps) {
  return (
    <li className="rule-pixel flex items-center gap-2" data-doc-folder={folder.id}>
      <Link href={href} className={ROW_LINK}>
        <span className={ROW_MARK} aria-hidden="true">
          ■
        </span>
        <span className="min-w-0 flex-1">
          <span className="docs-text block break-words text-accent-ink underline">{folder.name}</span>
          <span className="docs-meta block">
            FOLDER{folder.kind === 'shared' && folder.ownerLabel.length > 0 ? ` · BY ${folder.ownerLabel}` : ''}
          </span>
        </span>
      </Link>
    </li>
  );
}
