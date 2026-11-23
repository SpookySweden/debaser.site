/**
 * An eye (SPEC-seeing-machine.md, "The two eyes"): a way of getting a page. A lens never knows which one is in use.
 *
 * Phase 1 has one, the built-in test page's (`./test-engine.ts`), which fetches nothing.
 */

/** Real steps only: each is said when it is being done, and no other words reach the status line. */
export type SeeStep = 'ACQUIRING SOURCE' | 'PARSING DOCUMENT STRUCTURE' | 'EXTRACTING MEDIA REFERENCES';

/** A company's code or picture on the page that would have reported who is reading it. */
export type Watcher = { company: string; host: string; refused: boolean };

/** A video or a sound found on a page, as the page says it: words and addresses, nothing played or fetched. Never counts, ratings or views. */
export type FoundMedia = { address: string; title: string; from: 'page' | 'video' | 'audio' | 'player' | 'declared' | 'link'; seconds: number | null };

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
  media: readonly FoundMedia[];
  /** Files loaded with the page, and files refused. */
  files: number;
  refused: number;
  /** What the source answered (200, 404); null for a page that was not fetched. */
  status: number | null;
  /** A password box was found, and made dead. */
  signIn: boolean;
  /** Where the page says it sends people on to, and after how many seconds; null for most. */
  refresh: { address: string; after: number } | null;
  /** Where its signed files are, and the only place the frame may load from; null for a page with none. */
  assets: string | null;
  /** Whether the page's own scripts run. */
  scripts: boolean;
};

export type SeeAnswer = { ok: true; document: SeenDocument } | { ok: false; reason: string };

export interface SeeingEngine {
  /** Said on the status line: `SERVER EYE`. */
  readonly name: string;
  takes(address: string): boolean;
  /** Stops at once when the signal aborts; what it answers after that is ignored. */
  open(address: string, onStep: (step: SeeStep) => void, signal: AbortSignal): Promise<SeeAnswer>;
}
