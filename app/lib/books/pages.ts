/**
 * A book's text as the reader shows it (SPEC-books.md): paragraphs (split at blank lines, each paragraph's own line breaks
 * joined with spaces, so the text flows to the window's width) and pages of about `size` characters that never cut a
 * paragraph. Pure, so a check can hold it; it never sees anything but the text it is handed.
 */

export const PAGE_CHARACTERS = 2400;

export function paragraphsOf(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.replace(/[ \t]*\n[ \t]*/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 0);
}

/** Each page's first paragraph number, in order. A page holds at least one paragraph, however long. */
export function pageStarts(paragraphs: readonly string[], size = PAGE_CHARACTERS): number[] {
  const starts: number[] = [];
  let used = size;
  paragraphs.forEach((paragraph, index) => {
    if (used + paragraph.length > size && used > 0) {
      starts.push(index);
      used = 0;
    }
    used += paragraph.length;
  });
  return starts.length > 0 ? starts : [0];
}

/** The page a paragraph is on. */
export function pageOf(starts: readonly number[], paragraph: number): number {
  let page = 0;
  for (let index = 0; index < starts.length; index += 1) if (starts[index] <= paragraph) page = index;
  return page;
}
