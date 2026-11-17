/**
 * OP.GG's app server (SPEC-leaguebot.md) answers most tools in a compact text form instead of JSON:
 *
 *   class Profile: data
 *   class Data: summoner
 *   class Summoner: game_name,tagline,level
 *
 *   Profile(Data(Summoner("Posty","Herta",619)))
 *
 * The `class` lines name each constructor's fields in order; the last line builds the value. This reads it back into plain
 * objects (`{ data: { summoner: { game_name: 'Posty', ... } } }`). Strings are JSON strings; numbers, true, false, null and
 * [lists] as in JSON. Anything it can't read throws, and the caller falls back to another source. Pure.
 */

export type Decoded = null | boolean | number | string | Decoded[] | { [field: string]: Decoded };

export function decodeOpggText(text: string): Decoded {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed) as Decoded;
  const classes = new Map<string, string[]>();
  const lines = trimmed.split('\n');
  let index = 0;
  for (; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line === '') continue;
    const match = /^class (\w+): ?(.*)$/.exec(line);
    if (!match) break;
    classes.set(match[1], match[2] === '' ? [] : match[2].split(','));
  }
  const body = lines.slice(index).join('\n').trim();
  if (body === '') throw new Error('nothing to decode');
  const reader = new Reader(body, classes);
  const value = reader.value();
  reader.space();
  if (!reader.done()) throw new Error('trailing text');
  return value;
}

class Reader {
  private at = 0;

  constructor(
    private readonly text: string,
    private readonly classes: Map<string, string[]>,
  ) {}

  done(): boolean {
    return this.at >= this.text.length;
  }

  space(): void {
    while (!this.done() && /\s/.test(this.text[this.at])) this.at += 1;
  }

  value(): Decoded {
    this.space();
    const c = this.text[this.at];
    if (c === '"') return this.string();
    if (c === '[') return this.list();
    if (c === '-' || (c >= '0' && c <= '9')) return this.number();
    const word = /^[A-Za-z_]\w*/.exec(this.text.slice(this.at));
    if (!word) throw new Error(`unexpected ${c ?? 'end'} at ${this.at}`);
    this.at += word[0].length;
    if (word[0] === 'null') return null;
    if (word[0] === 'true') return true;
    if (word[0] === 'false') return false;
    return this.call(word[0]);
  }

  private string(): string {
    const match = /^"(?:[^"\\]|\\.)*"/.exec(this.text.slice(this.at));
    if (!match) throw new Error('unclosed string');
    this.at += match[0].length;
    return JSON.parse(match[0]) as string;
  }

  private number(): number {
    const match = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.text.slice(this.at));
    if (!match) throw new Error('bad number');
    this.at += match[0].length;
    return Number(match[0]);
  }

  private list(): Decoded[] {
    this.at += 1;
    const items: Decoded[] = [];
    this.space();
    if (this.text[this.at] === ']') {
      this.at += 1;
      return items;
    }
    for (;;) {
      items.push(this.value());
      this.space();
      const c = this.text[this.at];
      this.at += 1;
      if (c === ']') return items;
      if (c !== ',') throw new Error('expected , or ]');
    }
  }

  private call(name: string): Decoded {
    this.space();
    if (this.text[this.at] !== '(') {
      // A bare word: OP.GG quotes every string, so this is something it never sends.
      throw new Error(`bare word ${name}`);
    }
    this.at += 1;
    const args: Decoded[] = [];
    this.space();
    if (this.text[this.at] === ')') this.at += 1;
    else {
      for (;;) {
        args.push(this.value());
        this.space();
        const c = this.text[this.at];
        this.at += 1;
        if (c === ')') break;
        if (c !== ',') throw new Error('expected , or )');
      }
    }
    const fields = this.classes.get(name);
    if (!fields) throw new Error(`unknown class ${name}`);
    const out: { [field: string]: Decoded } = {};
    fields.forEach((field, i) => {
      out[field] = i < args.length ? args[i] : null;
    });
    return out;
  }
}
