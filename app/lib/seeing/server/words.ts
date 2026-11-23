/**
 * A page's bytes as words, whatever alphabet they are in (SPEC-seeing-machine.md, "The rewriter"): what the bytes themselves say first,
 * then what came with them, then what the page says of itself, then UTF-8. Pure.
 */

const decoderFor = (label: string): TextDecoder | null => {
  try {
    return new TextDecoder(label);
  } catch {
    return null;
  }
};

/** The charset a page names in its first kilobytes, as a browser looks for it. */
export function charsetInside(bytes: Uint8Array): string | null {
  const start = Buffer.from(bytes.subarray(0, 4096)).toString('latin1');
  const said =
    /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]{1,40})/i.exec(start)?.[1] ??
    /<\?xml[^>]+encoding\s*=\s*["']([\w.:-]{1,40})/i.exec(start)?.[1] ??
    /^@charset "([\w.:-]{1,40})"/.exec(start)?.[1] ??
    null;
  // A page that can be read this far to say it is UTF-16 is not.
  return said !== null && /^utf-?16/i.test(said) ? 'utf-8' : said;
}

export function wordsOf(bytes: Uint8Array, charset: string | null): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  for (const label of [charset, charsetInside(bytes)]) {
    const decoder = label === null ? null : decoderFor(label);
    if (decoder !== null) return decoder.decode(bytes);
  }
  return new TextDecoder('utf-8').decode(bytes);
}
