/**
 * A small, strict, bounded XML reader for the feeds WEB reads (podcast RSS 2.0, YouTube's Atom feed).
 *
 * Written here rather than added as a dependency: WEB needs a handful of elements out of two well-formed
 * feed formats, and a full parser brings DTDs, external entities and a supply chain with it. This one:
 * - refuses any `<!DOCTYPE` or `<!ENTITY` outright, so there is no entity expansion and nothing external;
 * - decodes only the five XML entities and numeric references, everything else stays literal text;
 * - is bounded: input length, element count and nesting depth are capped, and it throws on anything
 *   malformed (a stray `<`, an unclosed or mismatched tag, an unquoted attribute) rather than guessing.
 * Element names keep their prefix as written (`itunes:duration`, `media:group`); feeds use the
 * conventional prefixes, and a feed that does not simply yields fewer fields.
 *
 * Text out of here is still untrusted: it goes through `sanitiseText` like every other remote string.
 */

export type XmlElement = {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** The element's own text and CDATA, concatenated (not its children's). */
  text: string;
};

export const XML_MAX_LENGTH = 2 * 1024 * 1024;
export const XML_MAX_ELEMENTS = 20_000;
export const XML_MAX_DEPTH = 32;

export class XmlError extends Error {
  constructor(message: string) {
    super(`XML: ${message}`);
    this.name = 'XmlError';
  }
}

const NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]+);/g, (whole, body: string) => {
    // Own keys only: `&constructor;` must stay literal, not find Object's inherited members.
    if (body[0] !== '#') return Object.hasOwn(ENTITIES, body) ? ENTITIES[body] : whole;
    const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    if (code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
    return String.fromCodePoint(code);
  });
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = Object.create(null);
  const pattern = /\s*([^\s=]+)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y;
  let at = 0;
  while (at < source.length) {
    if (/^\s*$/.test(source.slice(at))) break;
    pattern.lastIndex = at;
    const match = pattern.exec(source);
    if (!match) throw new XmlError('malformed attribute');
    const [, name, double, single] = match;
    if (!NAME.test(name)) throw new XmlError('bad attribute name');
    attrs[name] = decode(double ?? single ?? '');
    at = pattern.lastIndex;
  }
  return attrs;
}

/** Where a start tag ends: the first `>` outside a quoted attribute value, or -1. */
function tagEnd(input: string, from: number): number {
  let quote = '';
  for (let i = from; i < input.length; i += 1) {
    const char = input[i];
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return i;
    }
  }
  return -1;
}

/** The document's root element, or a thrown `XmlError`. */
export function parseXml(input: string): XmlElement {
  if (typeof input !== 'string') throw new XmlError('not text');
  if (input.length > XML_MAX_LENGTH) throw new XmlError('too large');
  if (/<!DOCTYPE|<!ENTITY/i.test(input)) throw new XmlError('DTDs and entity declarations are refused');

  const root: XmlElement = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlElement[] = [root];
  let count = 0;
  let at = 0;

  while (at < input.length) {
    const lt = input.indexOf('<', at);
    const top = stack[stack.length - 1];
    if (lt === -1) {
      if (input.slice(at).trim() !== '') throw new XmlError('text after the root element');
      break;
    }
    if (lt > at) {
      const text = input.slice(at, lt);
      if (stack.length === 1) {
        if (text.trim() !== '') throw new XmlError('text outside the root element');
      } else {
        top.text += decode(text);
      }
    }

    if (input.startsWith('<!--', lt)) {
      const end = input.indexOf('-->', lt + 4);
      if (end === -1) throw new XmlError('unclosed comment');
      at = end + 3;
    } else if (input.startsWith('<![CDATA[', lt)) {
      const end = input.indexOf(']]>', lt + 9);
      if (end === -1) throw new XmlError('unclosed CDATA');
      if (stack.length === 1) throw new XmlError('CDATA outside the root element');
      top.text += input.slice(lt + 9, end);
      at = end + 3;
    } else if (input.startsWith('<?', lt)) {
      const end = input.indexOf('?>', lt + 2);
      if (end === -1) throw new XmlError('unclosed processing instruction');
      at = end + 2;
    } else if (input.startsWith('</', lt)) {
      const end = input.indexOf('>', lt);
      if (end === -1) throw new XmlError('unclosed end tag');
      const name = input.slice(lt + 2, end).trim();
      if (stack.length === 1 || top.name !== name) throw new XmlError(`mismatched </${name.slice(0, 40)}>`);
      stack.pop();
      at = end + 1;
    } else {
      const end = tagEnd(input, lt);
      if (end === -1) throw new XmlError('unclosed tag');
      let body = input.slice(lt + 1, end);
      const selfClosing = body.endsWith('/');
      if (selfClosing) body = body.slice(0, -1);
      const nameMatch = body.match(/^[^\s/]+/);
      const name = nameMatch?.[0] ?? '';
      if (!NAME.test(name)) throw new XmlError('bad element name');
      if (stack.length === 1 && root.children.length > 0) throw new XmlError('more than one root element');
      count += 1;
      if (count > XML_MAX_ELEMENTS) throw new XmlError('too many elements');
      const element: XmlElement = { name, attrs: parseAttrs(body.slice(name.length)), children: [], text: '' };
      top.children.push(element);
      if (!selfClosing) {
        if (stack.length > XML_MAX_DEPTH) throw new XmlError('nested too deeply');
        stack.push(element);
      }
      at = end + 1;
    }
  }

  if (stack.length !== 1) throw new XmlError(`unclosed <${stack[stack.length - 1].name.slice(0, 40)}>`);
  const [element] = root.children;
  if (!element) throw new XmlError('no root element');
  return element;
}

/** The first child element with this name. */
export function child(element: XmlElement | undefined, name: string): XmlElement | undefined {
  return element?.children.find((entry) => entry.name === name);
}

/** Every child element with this name. */
export function children(element: XmlElement | undefined, name: string): XmlElement[] {
  return element ? element.children.filter((entry) => entry.name === name) : [];
}

/** The text of the first child with this name, or undefined when there is none. */
export function childText(element: XmlElement | undefined, name: string): string | undefined {
  return child(element, name)?.text;
}
