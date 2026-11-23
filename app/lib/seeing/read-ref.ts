/**
 * A book seen in BROWSER, read in the site's own reader instead (IMPROVE, 2026-11-23, decision 39): an Open Library work's page, or an
 * Internet Archive item's book reader or one of its PDF or EPUB files, gives the reference `/read/<ref>` opens. Anything else gives null,
 * so the key is only there when it leads somewhere. Pure; the address is only read, never fetched.
 */
const ARCHIVE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function readerRef(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const parts = url.pathname.split('/').filter((each) => each !== '');
  if (host === 'openlibrary.org' && parts[0] === 'works' && /^OL[1-9][0-9]{0,11}W$/.test(parts[1] ?? '')) return `books:${parts[1]}`;
  if (host === 'archive.org' && ARCHIVE_ID.test(parts[1] ?? '')) {
    // The book reader's own address, or a book file in the item: an item's page alone may be a film or a record.
    if (parts[0] === 'stream') return `internet_archive:${parts[1]}`;
    if (parts[0] === 'download' && /\.(?:pdf|epub)$/i.test(parts[parts.length - 1]) && parts.length > 2) return `internet_archive:${parts[1]}`;
  }
  return null;
}
