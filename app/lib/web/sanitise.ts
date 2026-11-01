/**
 * Third-party text, made safe to show as plain text.
 *
 * Everything a platform sends is treated as hostile: tags are stripped, entities decoded, control
 * characters removed, whitespace collapsed, and the result capped. It is still rendered by React as a
 * text node, never through `dangerouslySetInnerHTML` - this function makes it readable, React makes it
 * inert.
 */

export const MAX_TEXT_LENGTH = 1000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      // Out-of-range and surrogate code points become nothing rather than throwing.
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Strip HTML, decode entities, collapse whitespace, cap at `max` characters. */
export function sanitiseText(input: unknown, max: number = MAX_TEXT_LENGTH): string {
  if (typeof input !== 'string') return '';

  const withoutTags = input
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, ' ');

  // Decoding can produce new `<`: they stay as literal characters, which React renders as text.
  const decoded = dropLoneSurrogates(decodeEntities(withoutTags))
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Counted and cut in code points, so an emoji is one character either way.
  const chars = Array.from(decoded);
  if (chars.length <= max) return decoded;
  return `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

/**
 * A remote date as ISO 8601, or undefined when it is unreadable or implausible: before year 1, after
 * year 9999 (whose ISO form `+010000-...` would break the string ordering paging relies on), or more
 * than a day after `notAfter` (a date in the future would pin an item to the top of the stream).
 */
export function plausibleIsoDate(value: unknown, notAfter: string): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return undefined;
  const date = new Date(time);
  const year = date.getUTCFullYear();
  if (year < 1 || year > 9999) return undefined;
  const limit = Date.parse(notAfter);
  if (Number.isFinite(limit) && time > limit + 24 * 60 * 60 * 1000) return undefined;
  return date.toISOString();
}

/**
 * Removes UTF-16 halves that have no partner. JSON can carry one (an escaped half pair), and a string
 * holding one is not valid Unicode: a database insert later can refuse the whole row over it.
 */
function dropLoneSurrogates(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i] + text[i + 1];
        i += 1;
      }
    } else if (code < 0xdc00 || code > 0xdfff) {
      out += text[i];
    }
  }
  return out;
}
