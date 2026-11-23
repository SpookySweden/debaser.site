/**
 * Rewriting a page's styles (SPEC-seeing-machine.md, "The rewriter"): every address in them goes through `to`, which answers a signed
 * asset address or null to take it out. A small scanner rather than a parser, so a broken sheet (there are many) is passed through as far
 * as it reads, as a browser would. Pure. What stops anything left in is the frame's policy, not this.
 */

/** `style` for an imported sheet, `font` inside @font-face, else `picture`. */
export type CssKind = 'style' | 'font' | 'picture';
export type CssAddress = (address: string, kind: CssKind) => string | null;

/** The text of a CSS string or bare url, its escapes read (`\\2f` is a slash). */
function unescapeCss(text: string): string {
  return text.replace(/\\(?:([0-9a-f]{1,6})\s?|(\r\n|[\n\r\f])|(.))/gi, (_, hex: string | undefined, line: string | undefined, other: string | undefined) => {
    if (hex !== undefined) {
      const code = parseInt(hex, 16);
      return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? '\ufffd' : String.fromCodePoint(code);
    }
    return line !== undefined ? '' : (other ?? '');
  });
}

/** Written back as a string nothing in it can end. */
const quoted = (text: string): string => `"${text.replace(/[^\x20\x21\x23-\x5b\x5d-\x7e]/g, (each) => `\\${each.codePointAt(0)?.toString(16)} `)}"`;

const NOTHING = 'url("")';

type Token = { kind: 'comment' | 'string' | 'url' | 'word' | 'other'; text: string; value?: string };

/** Comments, strings and url()s apart from everything else. An unfinished one runs to the end, as in a browser. */
function* tokens(css: string): Generator<Token> {
  let at = 0;
  const readString = (from: number): { end: number; value: string } => {
    const quote = css[from];
    let i = from + 1;
    while (i < css.length && css[i] !== quote) {
      if (css[i] === '\\') i += 1;
      else if (css[i] === '\n') break;
      i += 1;
    }
    return { end: Math.min(i + 1, css.length), value: unescapeCss(css.slice(from + 1, Math.min(i, css.length))) };
  };
  while (at < css.length) {
    const here = css[at];
    if (here === '/' && css[at + 1] === '*') {
      const end = css.indexOf('*/', at + 2);
      const to = end === -1 ? css.length : end + 2;
      yield { kind: 'comment', text: css.slice(at, to) };
      at = to;
    } else if (here === '"' || here === "'") {
      const { end, value } = readString(at);
      yield { kind: 'string', text: css.slice(at, end), value };
      at = end;
    } else if (/[a-z@_\\-]/i.test(here)) {
      const word = /^(?:[\w@\u0080-\uffff-]|\\[0-9a-f]{1,6}\s?|\\[^\n])+/i.exec(css.slice(at, at + 200))?.[0] ?? here;
      const name = unescapeCss(word).toLowerCase();
      if ((name === 'url' || name === 'src') && css[at + word.length] === '(') {
        let i = at + word.length + 1;
        while (i < css.length && /\s/.test(css[i])) i += 1;
        if (css[i] === '"' || css[i] === "'") {
          const { end, value } = readString(i);
          const close = css.indexOf(')', end);
          const to = close === -1 ? css.length : close + 1;
          yield { kind: 'url', text: css.slice(at, to), value };
          at = to;
        } else {
          let end = i;
          while (end < css.length && css[end] !== ')') end += css[end] === '\\' ? 2 : 1;
          const value = unescapeCss(css.slice(i, Math.min(end, css.length)).trim());
          const to = Math.min(end + 1, css.length);
          yield { kind: 'url', text: css.slice(at, to), value };
          at = to;
        }
      } else {
        yield { kind: 'word', text: word, value: name };
        at += word.length;
      }
    } else {
      yield { kind: 'other', text: here };
      at += 1;
    }
  }
}

/**
 * A sheet, or the inside of a style attribute, with every address rewritten. Nothing is left pointing anywhere else: an address `to`
 * answers null for becomes an empty one, and an @import of nothing goes.
 */
export function rewriteCss(css: string, to: CssAddress): string {
  let out = '';
  let importing = false;
  let depth = 0;
  // How deep the brace of the @font-face being read is, or -1 outside one.
  let font = -1;
  let fontNext = false;
  let imageSet = -1;
  let parens = 0;
  for (const token of tokens(css)) {
    if (token.kind === 'comment') continue;
    if (token.kind === 'word') {
      if (token.value === '@import') importing = true;
      if (token.value === '@font-face') fontNext = true;
      if (token.value === 'image-set' || token.value === '-webkit-image-set') imageSet = parens;
    }
    if (token.kind === 'other') {
      if (token.text === '(') parens += 1;
      if (token.text === ')') {
        parens = Math.max(0, parens - 1);
        if (parens <= imageSet) imageSet = -1;
      }
      if (token.text === '{') {
        depth += 1;
        if (fontNext) font = depth;
        fontNext = false;
        importing = false;
      }
      if (token.text === '}') {
        if (depth === font) font = -1;
        depth = Math.max(0, depth - 1);
      }
      if (token.text === ';') importing = false;
    }
    if ((token.kind === 'url' || (token.kind === 'string' && (importing || imageSet !== -1))) && token.value !== undefined) {
      const local = token.value.startsWith('#') || /^data:/i.test(token.value);
      const answer = local ? token.value : token.value === '' ? null : to(token.value, importing ? 'style' : font !== -1 ? 'font' : 'picture');
      out += answer === null ? NOTHING : `url(${quoted(answer)})`;
      // Only the first string of an @import is its address.
      importing = false;
      continue;
    }
    out += token.text;
  }
  // Inside a <style> nothing may close it.
  return out.replace(/<\/(?=style)/gi, '<\\/');
}
