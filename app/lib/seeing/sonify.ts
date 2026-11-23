/**
 * SONIFY (SPEC-seeing-machine.md, idea xiii): a page's structure as a BEATBOX loop. Headings are the beat, links the notes, pictures a bell,
 * each where it stands on the page from its top to its foot. Pure, and the same page always sounds the same.
 *
 * What is handed over is BeepBox's own JSON, which BEATBOX reads from the address's hash as it does any song link; a page's words never go in it.
 */
export type Part = { kind: 'heading'; level: number } | { kind: 'link'; number: number } | { kind: 'picture' };

const PARTS_MOST = 4000;
const STEPS = 16;
const TICKS = 4;
/** A minor pentatonic over two octaves: any two of them sit together. */
const NOTES = [36, 39, 41, 43, 46, 48, 51, 53, 55, 58];
const DRUMS = { kick: 0, snare: 3, hat: 9, bell: 7 } as const;

/** What is on a page, in order. Read as text: nothing is made of it, so nothing on it can run or load. */
export function partsOf(html: string): Part[] {
  const parts: Part[] = [];
  const tag = /<(?:h([1-6])|(a)|(img))(?=[\s/>])([^>]{0,2000})/gi;
  for (let found = tag.exec(html); found !== null && parts.length < PARTS_MOST; found = tag.exec(html)) {
    if (found[1] !== undefined) parts.push({ kind: 'heading', level: Number(found[1]) });
    else if (found[3] !== undefined) parts.push({ kind: 'picture' });
    else {
      const href = /\shref\s*=\s*["']?([^"'\s>]+)/i.exec(found[4])?.[1];
      if (href === undefined) continue;
      let number = 0;
      for (const letter of href) number = (Math.imul(number, 31) + letter.charCodeAt(0)) >>> 0;
      parts.push({ kind: 'link', number });
    }
  }
  return parts;
}

type BarNote = { step: number; pitch: number };
const jsonNotes = (notes: readonly BarNote[]) =>
  [...notes].sort((a, b) => a.step - b.step).map(({ step, pitch }) => ({ pitches: [pitch], points: [{ tick: step, pitchBend: 0, volume: 100 }, { tick: step + 1, pitchBend: 0, volume: 100 }], continuesLastPattern: false }));

/** A song of two, four or eight bars, as how much is on the page; null when there is nothing on it to play. */
export function songOf(parts: readonly Part[]): object | null {
  if (!parts.some((part) => part.kind !== 'picture')) return null;
  const bars = parts.length > 160 ? 8 : parts.length > 40 ? 4 : 2;
  const all = bars * STEPS;
  const drums = new Map<number, number>();
  const notes = new Map<number, number>();
  parts.forEach((part, i) => {
    const at = Math.floor((i / parts.length) * all);
    // Headings fall on the beat: the larger, the stronger. A step holds one sound, and the first on the page keeps it.
    if (part.kind === 'heading') {
      const on = part.level <= 2 ? Math.min(all - 4, Math.round(at / 4) * 4) : Math.min(all - 2, Math.round(at / 2) * 2);
      const drum = part.level === 1 ? DRUMS.kick : part.level === 2 ? DRUMS.snare : DRUMS.hat;
      drums.set(on, Math.min(drum, drums.get(on) ?? drum));
    } else if (part.kind === 'picture') {
      if (!drums.has(at)) drums.set(at, DRUMS.bell);
    } else if (!notes.has(at)) notes.set(at, NOTES[part.number % NOTES.length]);
  });
  // A page with no headings still keeps time.
  if (![...drums.values()].some((drum) => drum !== DRUMS.bell)) for (let at = 0; at < all; at += 4) drums.set(at, at % 16 === 0 ? DRUMS.kick : DRUMS.hat);
  const channel = (type: 'pitch' | 'drum', sounds: ReadonlyMap<number, number>) => ({
    type,
    patterns: Array.from({ length: bars }, (_, bar) => ({ notes: jsonNotes([...sounds].filter(([at]) => Math.floor(at / STEPS) === bar).map(([at, pitch]) => ({ step: at % STEPS, pitch }))) })),
    sequence: Array.from({ length: bars }, (_, bar) => bar + 1),
    ...(type === 'pitch' ? { octaveScrollBar: 2 } : {}),
  });
  return { format: 'BeepBox', version: 9, scale: 'expert', key: 'A', introBars: 0, loopBars: bars, beatsPerBar: STEPS / TICKS, ticksPerBeat: TICKS, beatsPerMinute: 112, channels: [channel('pitch', notes), channel('drum', drums)] };
}

/** BEATBOX with the page's loop in it, or null. */
export function beatBoxHref(html: string): string | null {
  const song = songOf(partsOf(html));
  return song === null ? null : `/beatbox#${encodeURIComponent(JSON.stringify(song))}`;
}
