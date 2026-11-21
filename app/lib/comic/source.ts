/**
 * Where COMIC lives, readable by the server's routes as well as the browser (no browser client imported here): the database
 * when `NEXT_PUBLIC_COMIC_DATA_SOURCE=supabase`, or, with that unset, when the board is on Supabase (the comments on panels are
 * board threads, so the two go together). Otherwise the mock store: this browser, and files on this computer.
 */

function readSource(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value.trim();
}

const REQUESTED = readSource(process.env.NEXT_PUBLIC_COMIC_DATA_SOURCE) ?? readSource(process.env.NEXT_PUBLIC_FORUM_DATA_SOURCE);

const CONFIGURED = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').length > 0 && (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').length > 0;

export const COMIC_DATA_SOURCE: 'mock' | 'supabase' = REQUESTED === 'supabase' && CONFIGURED ? 'supabase' : 'mock';
