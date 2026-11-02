/**
 * What a search's words mean beyond the words themselves (Luke, 2026-11-02). Pure and client-safe;
 * `scripts/check-web-kino.cjs` holds it.
 *
 * - **A year without a filter word.** "alien 1979": the 1979 is read as the year the work was made, by the sources
 *   that know that (TMDB, the Internet Archive), and stays a plain word everywhere else (a YouTube date is only when
 *   it was uploaded). Case by case, so it never hides a title with a number in it: the source is asked with the year
 *   as a word too ("1917", "Blade Runner 2049": 2049 is not a year yet, so it is only ever a word). A search that is
 *   only a year is just a word.
 * - **VIBE** (the toggle): mood and tag words. `vibePlan` turns them into TMDB genres, a decade and leftover words
 *   for TMDB's keywords ("80s horror" is horror films of 1980-1989).
 */

const YEAR = /^(?:18[89]\d|19\d\d|20\d\d)$/;
export const FIRST_YEAR = 1880;

/** The last whole word that is a plausible year of making, and the words without it; null year when none (or alone). */
export function splitYear(words: string, now: Date = new Date()): { words: string; year: number | null } {
  const parts = words.split(' ').filter(Boolean);
  const last = now.getUTCFullYear() + 1;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const value = Number(parts[index]);
    if (YEAR.test(parts[index]) && value >= FIRST_YEAR && value <= last && parts.length > 1) {
      return { words: [...parts.slice(0, index), ...parts.slice(index + 1)].join(' '), year: value };
    }
  }
  return { words: parts.join(' '), year: null };
}

/** The year at the front of a date (`1979-05-25`, `1979`), or null. */
export function yearOfDate(date: string | undefined): number | null {
  return date !== undefined && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null;
}

/** TMDB's genre numbers (fixed by TMDB) for the words people use, films and shows apart (shows group some). */
const GENRES: Readonly<Record<string, { movie?: number; tv?: number }>> = {
  action: { movie: 28, tv: 10759 },
  adventure: { movie: 12, tv: 10759 },
  animation: { movie: 16, tv: 16 },
  animated: { movie: 16, tv: 16 },
  cartoon: { movie: 16, tv: 16 },
  comedy: { movie: 35, tv: 35 },
  funny: { movie: 35, tv: 35 },
  crime: { movie: 80, tv: 80 },
  documentary: { movie: 99, tv: 99 },
  drama: { movie: 18, tv: 18 },
  family: { movie: 10751, tv: 10751 },
  fantasy: { movie: 14, tv: 10765 },
  history: { movie: 36 },
  historical: { movie: 36 },
  horror: { movie: 27 },
  scary: { movie: 27 },
  music: { movie: 10402 },
  musical: { movie: 10402 },
  mystery: { movie: 9648, tv: 9648 },
  romance: { movie: 10749 },
  romantic: { movie: 10749 },
  scifi: { movie: 878, tv: 10765 },
  thriller: { movie: 53 },
  war: { movie: 10752, tv: 10768 },
  western: { movie: 37, tv: 37 },
  kids: { tv: 10762 },
};

const DECADE_WORDS: Readonly<Record<string, number>> = {
  twenties: 1920, thirties: 1930, forties: 1940, fifties: 1950, sixties: 1960, seventies: 1970, eighties: 1980, nineties: 1990,
};

export type VibePlan = {
  movieGenres: number[];
  tvGenres: number[];
  /** First and last day, from a decade ("80s", "1980s", "eighties") or a year. */
  from?: string;
  to?: string;
  /** The words left for TMDB's keyword search. */
  keywords: string[];
  /** A genre word with no show genre (horror): shows are not asked, rather than every show. Same for films (kids). */
  skipTv: boolean;
  skipMovies: boolean;
  /** Nothing in the words could narrow a list: the plain search is used instead. */
  empty: boolean;
};

/** A decade word as its first year: `80s` 1980, `1980s` 1980, `eighties` 1980; null otherwise. */
export function decadeOf(word: string, now: Date = new Date()): number | null {
  if (Object.prototype.hasOwnProperty.call(DECADE_WORDS, word)) return DECADE_WORDS[word];
  const short = /^([0-9])0s$/.exec(word);
  if (short) {
    const decade = Number(short[1]) * 10;
    // "20s" is the 2020s once those have begun; "30s".."90s" are the last century.
    return decade <= now.getUTCFullYear() - 2000 ? 2000 + decade : 1900 + decade;
  }
  const long = /^(1[89][0-9]0|20[0-9]0)s$/.exec(word);
  return long ? Number(long[1]) : null;
}

/** The VIBE reading of a search's words (`searchText`: lower case letters and digits). */
export function vibePlan(words: string, now: Date = new Date()): VibePlan {
  const plan: VibePlan = { movieGenres: [], tvGenres: [], keywords: [], skipTv: false, skipMovies: false, empty: true };
  const { words: rest, year } = splitYear(words, now);
  let tokens = rest.split(' ').filter(Boolean);
  // "science fiction" and "sci fi" are one genre.
  const joined = ` ${tokens.join(' ')} `.replace(/ science fiction | sci fi /g, ' scifi ');
  tokens = joined.trim().split(' ').filter(Boolean);
  if (year !== null) {
    plan.from = `${year}-01-01`;
    plan.to = `${year}-12-31`;
  }
  for (const token of tokens) {
    const decade = decadeOf(token, now);
    if (decade !== null && plan.from === undefined) {
      plan.from = `${decade}-01-01`;
      plan.to = `${decade + 9}-12-31`;
      continue;
    }
    const genre = Object.prototype.hasOwnProperty.call(GENRES, token) ? GENRES[token] : undefined;
    if (genre !== undefined) {
      if (genre.movie !== undefined && !plan.movieGenres.includes(genre.movie)) plan.movieGenres.push(genre.movie);
      if (genre.tv !== undefined && !plan.tvGenres.includes(genre.tv)) plan.tvGenres.push(genre.tv);
      if (genre.tv === undefined) plan.skipTv = true;
      if (genre.movie === undefined) plan.skipMovies = true;
      continue;
    }
    if (!['film', 'films', 'movie', 'movies', 'show', 'shows', 'series', 'tv', 'a', 'the', 'and', 'of', 'with'].includes(token)) plan.keywords.push(token);
  }
  plan.keywords = plan.keywords.slice(0, 4);
  plan.empty = plan.movieGenres.length === 0 && plan.tvGenres.length === 0 && plan.from === undefined && plan.keywords.length === 0;
  return plan;
}
