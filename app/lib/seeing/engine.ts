/**
 * An eye (SPEC-seeing-machine.md, "The two eyes"): a way of getting a page. A lens never knows which one is in use.
 *
 * Phase 1 has one, the built-in test page's (`./test-engine.ts`), which fetches nothing.
 */

/** Real steps only: each is said when it is being done, and no other words reach the status line. */
export type SeeStep = 'ACQUIRING SOURCE' | 'PARSING DOCUMENT STRUCTURE' | 'EXTRACTING MEDIA REFERENCES';

/** A company's code or picture on the page that would have reported who is reading it. */
export type Watcher = { company: string; host: string; refused: boolean };

export type SeenDocument = {
  /** Where it really came from: the address asked for, or where that led. */
  address: string;
  title: string;
  eye: string;
  /** The page as its makers sent it, scripts and all. It only ever reaches the sandboxed frame. */
  html: string;
  /** The page's main words and pictures, in reading order, for READER; null when none were found. */
  reading: string | null;
  watchers: readonly Watcher[];
  /** Files loaded with the page, and files refused. */
  files: number;
  refused: number;
};

export type SeeAnswer = { ok: true; document: SeenDocument } | { ok: false; reason: string };

export interface SeeingEngine {
  /** Said on the status line: `SERVER EYE`. */
  readonly name: string;
  takes(address: string): boolean;
  /** Stops at once when the signal aborts; what it answers after that is ignored. */
  open(address: string, onStep: (step: SeeStep) => void, signal: AbortSignal): Promise<SeeAnswer>;
}
