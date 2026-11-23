/**
 * BROWSER's limits (SPEC-seeing-machine.md, "Limits, to start"), all in this one file. Counted on the process: a restart starts them again.
 * SERVER ONLY.
 */
export const LIMITS = {
  pagesADay: 400,
  pagesAMinute: 60,
  filesAPage: 200,
  fetchesAtOnceEach: 6,
  fetchesAtOnceAll: 40,
  /** How many may wait their turn, so a page of a hundred pictures queues and a thousand does not. */
  waitingEach: 200,
  pageBytes: 8 * 1024 * 1024,
  assetBytes: 6 * 1024 * 1024,
  /** Every file one person is sent in a minute, so one person can't fill the house's upload. */
  bytesAMinute: 150 * 1024 * 1024,
  timeoutMs: 15_000,
  redirects: 5,
  cacheBytes: 256 * 1024 * 1024,
  cacheMs: 10 * 60_000,
} as const;

type Person = { minute: number[]; day: number[]; bytes: { at: number; size: number }[]; files: { at: number }[]; running: number; parked: number; waiting: (() => void)[] };

export type Counter = ReturnType<typeof createCounter>;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export function createCounter(now: () => number = Date.now) {
  const people = new Map<string, Person>();
  let running = 0;
  const everyone: (() => void)[] = [];

  const of = (id: string): Person => {
    let person = people.get(id);
    if (person === undefined) {
      person = { minute: [], day: [], bytes: [], files: [], running: 0, parked: 0, waiting: [] };
      people.set(id, person);
    }
    return person;
  };

  /** Counts a page opened; a reason when it is one too many. */
  function page(id: string): string | null {
    const person = of(id);
    const at = now();
    person.minute = person.minute.filter((each) => at - each < MINUTE);
    person.day = person.day.filter((each) => at - each < DAY);
    if (person.day.length >= LIMITS.pagesADay) return `${LIMITS.pagesADay} PAGES A DAY, AND THOSE ARE USED`;
    if (person.minute.length >= LIMITS.pagesAMinute) return 'TOO MANY PAGES AT ONCE: WAIT A MINUTE';
    person.minute.push(at);
    person.day.push(at);
    return null;
  }

  /** Counts a file of a page. The most in a minute is what the pages opened in that minute may have between them. */
  function file(id: string): boolean {
    const person = of(id);
    const at = now();
    person.files = person.files.filter((each) => at - each.at < MINUTE);
    person.bytes = person.bytes.filter((each) => at - each.at < MINUTE);
    if (person.bytes.reduce((sum, each) => sum + each.size, 0) >= LIMITS.bytesAMinute) return false;
    const pages = Math.max(1, person.minute.filter((each) => at - each < MINUTE).length);
    if (person.files.length >= LIMITS.filesAPage * Math.min(pages, 10)) return false;
    person.files.push({ at });
    return true;
  }

  function sent(id: string, size: number): void {
    of(id).bytes.push({ at: now(), size });
  }

  /**
   * Runs `work` when there is room for it: six at once each, forty for everybody. Null when too many of theirs are waiting already, for
   * their own room or for everybody's, or when the one who asked has gone by the time there is room.
   */
  async function turn<T>(id: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T | null> {
    const person = of(id);
    while (person.running >= LIMITS.fetchesAtOnceEach || running >= LIMITS.fetchesAtOnceAll) {
      if (person.parked >= LIMITS.waitingEach) return null;
      person.parked += 1;
      await new Promise<void>((go) => {
        if (person.running >= LIMITS.fetchesAtOnceEach) person.waiting.push(go);
        else everyone.push(go);
      });
      person.parked -= 1;
    }
    const next = () => {
      person.waiting.shift()?.();
      everyone.shift()?.();
    };
    if (signal?.aborted === true) {
      next();
      return null;
    }
    person.running += 1;
    running += 1;
    try {
      return await work();
    } finally {
      person.running -= 1;
      running -= 1;
      next();
    }
  }

  return { page, file, sent, turn, atOnce: () => running };
}

const holder = globalThis as typeof globalThis & { debaserSeeingCounter?: Counter };
export const counter: Counter = (holder.debaserSeeingCounter ??= createCounter());
