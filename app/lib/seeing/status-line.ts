import { pageBytes, took, weighs } from './took';

/** What the status line says of a page that was drawn: only what really happened, in the order it happened. Pure. */
export function shownLine(
  document: { eye: string; files: number; refused: number; status: number | null; html: string },
  lens: string,
  restricted: number,
  ms: number | undefined,
): string {
  return [
    'DOCUMENT RECONSTRUCTED',
    document.eye,
    `${document.files} ${document.files === 1 ? 'FILE' : 'FILES'}`,
    `${document.refused} REFUSED`,
    `PAGE ${weighs(pageBytes(document))}`,
    `LENS: ${lens}`,
    restricted > 0 ? `${restricted} RESTRICTED` : null,
    document.status !== null && document.status >= 400 ? `HTTP ${document.status}` : null,
    ms !== undefined ? `IN ${took(ms)}` : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');
}
