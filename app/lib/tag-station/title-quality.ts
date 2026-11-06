/**
 * Which titles say nothing, so lists can sink them (Luke, 2026-11-06). Nothing is deleted: a junk title stays findable, last. Pure and client-safe. A number alone, a machine's id, a camera's or
 * a program's file name, "untitled". A real short title ("Up", "Se7en", "1984") is left alone.
 */

const FILE_ENDING = /\.(mp4|m4v|mov|avi|mkv|webm|wmv|flv|mpg|mpeg|3gp|mp3|m4a|wav|flac|ogg|jpe?g|png|gif|tiff?|bmp|pdf|txt|docx?|zip|iso)$/i;
/** A word that only names what the thing is, with or without a number after it: "IMG_0412", "video 3", "New file", "untitled". */
const NAMES_NOTHING =
  /^(new\s+)?(img|image|dsc|dscn|dscf|pict?|photo|mov|mvi|vid|video|clip|film|movie|audio|track|sound|recording|rec|scan|screenshot|screen\s*shot|document|doc|file|upload|test|untitled|unknown|unnamed|no\s*title|none|null|n\/?a|placeholder)[\s_.-]*\d*$/i;
const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]{12,}$/i;

/** One word that reads like a machine made it: digits among letters, or letters no one could say. */
function machineWord(word: string): boolean {
  if (UUID.test(word) || HEX.test(word)) return true;
  const digits = (word.match(/\p{N}/gu) ?? []).length;
  const letters = (word.match(/\p{L}/gu) ?? []).length;
  if (word.length >= 8 && digits >= 2 && letters >= 1) return true;
  if (/^[A-Za-z]+$/.test(word) && word.length >= 7 && !/[aeiouy]/i.test(word)) return true;
  // Case flipping all the way through: "aBcDeFgHiJ", as a video id or a hash in base 64.
  const flips = (word.match(/[a-z][A-Z]|[A-Z][a-z]/g) ?? []).length;
  return word.length >= 8 && flips >= 5;
}

export function poorTitle(title: string | null | undefined, externalId = ''): boolean {
  const text = (title ?? '').trim();
  if ([...text].length < 2) return true;
  // Nothing but numbers and marks, except a year, which is a title often enough ("1984", "1917").
  if (!/\p{L}/u.test(text)) return !/^\d{4}$/.test(text);
  if (NAMES_NOTHING.test(text)) return true;
  if (/\s/.test(text)) return false;
  if (FILE_ENDING.test(text) || /^S\d+(E\d+)?([-.]\d+)?$/i.test(text)) return true;
  // Real words joined by marks are a title someone typed: "Redes_sociales_abiertas", "SB-1.18.15_by_HG_Urmila_Devi".
  if (text.split(/[_.-]+/).filter((part) => /^\p{L}{3,}$/u.test(part)).length >= 2) return false;
  if (machineWord(text.replace(/[_.-]+/g, ''))) return true;
  // The title is just the id, and the id looks like one.
  return externalId.length > 0 && text.toLowerCase() === externalId.toLowerCase() && /\d/.test(text);
}

/** Playable first, then what has no player here, then what says nothing. Each keeps the order it came in, so a sort still means what it says. */
export function sinkPoor<T extends { title: string; externalId: string; seenOnly?: boolean }>(items: readonly T[]): T[] {
  const good: T[] = [];
  const noPlayer: T[] = [];
  const poor: T[] = [];
  for (const item of items) {
    if (poorTitle(item.title, item.externalId)) poor.push(item);
    else if (item.seenOnly) noPlayer.push(item);
    else good.push(item);
  }
  return [...good, ...noPlayer, ...poor];
}

/** What's already on the reader's screen stays where it is, in that order; anything new comes after it. So digging for more never moves the row they're looking at. */
export function keepShownFirst<T extends { id: string }>(shownIds: readonly string[], items: readonly T[]): T[] {
  if (shownIds.length === 0) return [...items];
  const byId = new Map(items.map((item) => [item.id, item]));
  const shown = new Set(shownIds);
  return [...shownIds.flatMap((id) => byId.get(id) ?? []), ...items.filter((item) => !shown.has(item.id))];
}
