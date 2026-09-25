import type { AudioTrack } from './tracks';

/**
 * RADI-OH: everything you have been listening to, kept so you can jump straight back in.
 *
 * **Two kinds of entry, and the difference is what they are keyed by.** A *recent* has one plate per
 * track - press it months later and it takes you back to where you left off, however far in you got. A
 * *loop* is one plate per **place**: a track and a second. That distinction is the whole of it, and it is
 * why they share a store but not an identity:
 *
 *   - listening to a track for three minutes must leave **one** plate, not 180. A recent is keyed by the
 *     track, and playing it again updates that plate's position in place.
 *   - a loop is deliberate - the bar you want to come back to. Two loops of one track at different
 *     seconds are two places, and both are worth keeping.
 *
 * Getting this wrong is not a subtle bug: it is a tab that either fills with duplicates of the song you
 * are playing, or forgets where you were. The store was loops-only to begin with, and the day this became
 * quick access is the day the identity had to split (`isRecent` below).
 *
 * **Where entries come from.** The player's own listening (`rememberPlay`, throttled by the caller), and
 * the queue window - following somebody takes the shared player over, so whatever was displaced lands
 * here first as a `taken-over` loop. That contract is unchanged: `queue` displaces, `radio` remembers.
 *
 * Stored per browser, like the player's own settings (`debaser.audio.player.v1`), and for the same
 * reason: this is one reader's history of where they were, not something to be shared or synced. It
 * needs no table, no policy and no account - a recent you made signed out is still yours on this machine.
 */

/**
 * Where an entry came from - which is what its icon says.
 *
 * `shelf` is a file played from the archive, `profile` is somebody's own song, `queue` is a track heard
 * by following a broadcast. Kept because the plates are a *quick access* grid: a reader looking for the
 * thing they were playing needs to tell a profile's song from an archive file at a glance, and the mark
 * is the only place that can be said without a picture (AGENTS.md forbids drawing one).
 */
export type LoopOrigin = 'shelf' | 'profile' | 'queue' | 'own';

export type LoopSource = {
  id: string;
  /** What the entry is called on its plate: the track's title. */
  label: string;
  /** The track's `src`: the same key the player queues on and a like points at. */
  trackId: string;
  /** Where in that track the entry returns to. For a recent, this is kept up to date as you listen. */
  positionSeconds: number;
  /**
   * Why this entry exists.
   *
   * `own` is your own listening - the quick-access kind, one per track. `taken-over` is what was playing
   * when a queue was followed, which is the automatic one and the reason the tab was built.
   */
  kind: 'own' | 'taken-over';
  /** Which of the icons this plate wears. */
  origin: LoopOrigin;
  /**
   * Where this track was first played from - what the caption's globe opens.
   *
   * Recorded at the moment of playing rather than worked out later, because the answer is only knowable
   * then: a track played off somebody's profile and the *same file* played off the archive are the same
   * `src`, so nothing in the file itself says which door the reader came through. A track whose source
   * cannot be placed has no href, and the caption draws no globe rather than a link to somewhere wrong.
   *
   * A site-local address (`/profile/<id>`, `/forum?music=mine`). Absolute web addresses are not stored:
   * every file here is one the site already serves, and an `href` to somewhere off-site would be a claim
   * about provenance the player cannot make.
   */
  originHref?: string;
  /** What the globe's own words are, so a caption can say where it goes before it is followed. */
  originWhere?: string;
  /** When it was first saved, so a list can be read oldest-first for a pruned entry. */
  savedAt: string;
  /** When it was last touched, which for quick access is what the order is really by. */
  playedAt: string;
  /** How many times it has been played, so the icon can say a track is one you return to. */
  plays: number;
  /** For a taken-over loop: the account whose queue displaced it, so the plate can say whose fault it was. */
  displacedBy?: string;
};

/** The most entries kept. Past this the oldest go, because a history nobody prunes is a list nobody reads. */
export const MAX_LOOPS = 30;

/**
 * How often the player writes your position into the grid.
 *
 * **Not per `timeupdate`.** That fires several times a second, and every write wakes every listener and
 * re-serialises the whole list - a store write per tick is a page that stutters while it plays. Five
 * seconds is fine enough that pressing a plate returns you to within a few bars of where you were, and
 * coarse enough that a track costs about a dozen writes rather than three hundred.
 *
 * It is the loop's own clock, deliberately, not the queue's heartbeat: a broadcast has to stay under
 * `QUEUE_STALE_SECONDS` to keep a lamp green, while this only has to be recent enough to be useful.
 */
export const LOOP_SAMPLE_MS = 5000;

/**
 * How long a pointer has to rest on an icon before the grid says where the entry came from.
 *
 * **A second, and the length is the feature.** An icon-only grid withholds everything, so the caption is
 * the only place the title, origin and position can be read without opening the pop-out. Showing it
 * instantly would make a pointer crossing four icons strobe four captions - the reader did not stop to
 * ask, so nothing should answer. A second is long enough that only a deliberate stop earns one, and short
 * enough that it is not a wait.
 *
 * It is deliberately *not* a `wobble`-style animation and knows nothing about `prefers-reduced-motion`: a
 * delay is not motion, and a reader who has asked for calm still needs to be able to read the caption. A
 * check holds it under two seconds, because past that it stops being a hover aid and becomes a wait.
 */
export const CAPTION_DELAY_MS = 1000;

/** Where the loops live. Named like the player's own key so the storage reads as one set of settings. */
const LOOPS_KEY = 'debaser.audio.loops.v1';

/**
 * What a loop is called when the track it points at is gone.
 *
 * The same shape as `unresolvedTrackTitle`: a loop stores the track's `src` and not a copy of it, so a
 * renamed file is not a stale label here and a deleted one leaves a loop the app cannot place. The row
 * says so rather than drawing blank.
 */
export function loopLabel(loop: LoopSource, shelf: AudioTrack[]): string {
  const track = shelf.find((entry) => entry.src === loop.trackId);

  return track?.title ?? `${loop.label} (NOT ON THE SHELF)`;
}

/**
 * The mark on an icon: what kind of thing this is, in one glyph.
 *
 * A *character*, not a picture - the same rule as `app/lib/ui/icons.ts`, and the reason is the asset rules
 * rather than taste: nothing on this site draws an icon in CSS or SVG, and the grid needs the kinds
 * tellable apart at a glance.
 *
 * **The shelf's mark is a music note, and it is the only mark that carries a colour.** The glyph says
 * *what* it is (a piece of music) and the colour says *where from* (your own listening, which is what most
 * of the grid is). The other two are a person's head and a note for a broadcast, so no two entries read
 * alike - which is the whole job, since the grid withholds the text that would otherwise explain them.
 */
export function originMark(origin: LoopOrigin): string {
  switch (origin) {
    case 'profile':
      return '☻';
    case 'queue':
      return '♫';
    case 'shelf':
    case 'own':
      return '♪';
  }
}

/**
 * The Tailwind ink each mark wears.
 *
 * A class rather than a colour value, because a component that writes a hex is the fault
 * `Temp/check-surreal.cjs` fails on - every fill on this site resolves to one of the nine tokens. The
 * shelf's note is Royal Blue (`ena`), which is the same blue the player's hardware plates use, so the
 * site's own music reads as the site's own music.
 */
export function originInk(origin: LoopOrigin): string {
  return origin === 'shelf' || origin === 'own' ? 'text-ena' : 'text-ink';
}

/** What a plate says about where it came from, under the title. */
export function originLabel(entry: LoopSource): string {
  if (entry.kind === 'taken-over') {
    return `TAKEN OVER BY ${(entry.displacedBy ?? 'SOMEONE').toUpperCase()}`;
  }

  switch (entry.origin) {
    case 'profile':
      return 'FROM A PROFILE';
    case 'queue':
      return 'HEARD ON A QUEUE';
    case 'shelf':
      return 'PLAYED FROM THE MUSIC WINDOW';
    case 'own':
      return 'YOU HAD THIS ON';
  }
}

/**
 * The globe, as a glyph.
 *
 * A character like every other mark here (`app/lib/ui/icons.ts`), and the right one for the job: it is the
 * universal sign for "this goes somewhere on the web", which is exactly what the link beside it does. The
 * asset rules forbid drawing one, and a glyph is what a text-mode machine had.
 */
export const GLOBE = '⊕';

/**
 * Where an entry came from, in the reader's words - what the globe's link says it opens.
 *
 * Separate from `originLabel` because they answer different questions: that one says *what kind of thing*
 * this is, and this one names the actual place. A caption shows both, so a reader knows where the globe
 * goes before spending a press on it.
 *
 * A track with no recorded href reads as `null` rather than as a guess, and the caption then draws no
 * globe at all. An empty link and a link to the wrong place look the same to a reader, and only one of
 * them is honest.
 */
export function originWhereLabel(entry: LoopSource): string | null {
  return entry.originHref === undefined ? null : (entry.originWhere ?? 'WHERE THIS CAME FROM');
}

/* ------------------------------------------------------------------------------------------------
 * The store
 * ------------------------------------------------------------------------------------------------ */

/**
 * The loops, as a tiny external store.
 *
 * The same shape as `DesktopSidebar`'s panel and `MusicPlayer`'s bar setting: a module-level value read
 * through `useSyncExternalStore`, so a window can draw the list and a catch-up can write to it without
 * either knowing about the other. A provider would work too and would be more machinery than a list
 * read in two places needs.
 */
const listeners = new Set<() => void>();

/** One shared empty array, so a reader with no loops does not get a new identity on every render. */
const NONE: LoopSource[] = [];

/** Whether one parsed entry is really a loop - a hand-edited storage entry costs its own row, not a throw. */
/**
 * A stored entry that still makes sense.
 *
 * `origin`, `playedAt` and `plays` are *optional here and defaulted below*, which is a deliberate
 * migration rather than laxity: the key `debaser.audio.loops.v1` held entries written before this store
 * became quick access, and a reader who used the old tab would otherwise lose their whole history to a
 * validation rule. Old entries read as `own` with no play count, which is the closest true thing.
 */
function isLoop(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;

  const entry = value as Partial<LoopSource>;

  return (
    typeof entry.id === 'string' &&
    typeof entry.label === 'string' &&
    typeof entry.trackId === 'string' &&
    typeof entry.positionSeconds === 'number' &&
    typeof entry.savedAt === 'string' &&
    (entry.kind === 'own' || entry.kind === 'taken-over')
  );
}

/** One stored entry, with the fields a pre-quick-access record does not have filled in. */
function normalise(entry: LoopSource): LoopSource {
  return {
    ...entry,
    origin: entry.origin ?? 'own',
    playedAt: entry.playedAt ?? entry.savedAt,
    plays: typeof entry.plays === 'number' ? entry.plays : 0,
  };
}

function readStored(): LoopSource[] {
  if (typeof window === 'undefined') return NONE;

  try {
    const raw = window.localStorage.getItem(LOOPS_KEY);
    if (raw === null) return NONE;

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return NONE;

    return parsed.filter(isLoop).map(normalise);
  } catch {
    // Storage blocked, or the entry is not JSON: an empty history is the honest answer.
    return NONE;
  }
}

let loops: LoopSource[] = readStored();

function persist(): void {
  try {
    window.localStorage.setItem(LOOPS_KEY, JSON.stringify(loops));
  } catch {
    // Storage unavailable: the loops hold for this visit only, which is better than throwing.
  }
}

/** The loops as they are now, for `useSyncExternalStore`. */
export function loopState(): LoopSource[] {
  return loops;
}

/** The server render has no storage, so it has no loops - and hydration matches it. */
export function loopServerState(): LoopSource[] {
  return NONE;
}

/** Draws from the store: the listener fires when a loop is saved or cleared. */
export function subscribeToLoops(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function commit(next: LoopSource[]): void {
  loops = next;
  persist();

  for (const listener of listeners) listener();
}

/**
 * Save a *place*: a track and a second, deliberately.
 *
 * Used by the queue window for what a takeover displaced, and by anything else that wants to keep one bar
 * for its own sake. Saving the same place twice replaces rather than duplicates: two plates for one place
 * would be a list that lies about how much history it holds. The identity is the track and the whole
 * second, because a second is as fine as a position is worth keeping.
 *
 * **This is not how listening is recorded** - that is `rememberPlay`, and the two are different on
 * purpose. This one creates a *new* plate each time the place differs, which is right for a deliberate
 * loop and wrong for a play.
 */
export function saveLoop(entry: {
  label: string;
  trackId: string;
  positionSeconds: number;
  kind: LoopSource['kind'];
  origin?: LoopOrigin;
  originHref?: string;
  originWhere?: string;
  displacedBy?: string;
}): LoopSource {
  const at = Math.max(0, Math.floor(entry.positionSeconds));
  const now = new Date().toISOString();

  const loop: LoopSource = {
    id: placeId(entry.trackId, at),
    label: entry.label,
    trackId: entry.trackId,
    positionSeconds: at,
    kind: entry.kind,
    origin: entry.origin ?? 'own',
    originHref: entry.originHref,
    originWhere: entry.originWhere,
    savedAt: now,
    playedAt: now,
    plays: 0,
    displacedBy: entry.displacedBy,
  };

  commit([loop, ...loops.filter((existing) => existing.id !== loop.id)].slice(0, MAX_LOOPS));

  return loop;
}

/**
 * One plate per **track**, keyed by the track alone.
 *
 * The identity split this store's header explains, in one line: a recent is a track you played, so playing
 * it again must find the same plate and move it up the list rather than adding a second one beside it.
 * A *loop*, by contrast, is `placeId` - the track and the second.
 */
export function recentId(trackId: string): string {
  return `recent:${trackId}`;
}

/** A deliberate place: the track and the whole second. */
export function placeId(trackId: string, positionSeconds: number): string {
  return `${trackId}@${Math.max(0, Math.floor(positionSeconds))}`;
}

/**
 * Record that a track is playing, for the quick-access grid.
 *
 * **Called on a throttle, never per tick.** `timeupdate` fires several times a second, and the caller
 * decides how often to write here - `LOOP_SAMPLE_MS` is how often the player's own listener does. That
 * split is deliberate: this function is pure store work, so it can be called from a check with no clock
 * at all, and the throttling lives with the thing that has the clock.
 *
 * Counting is the subtle part. `plays` increments when the *track changes*, not on every write - otherwise
 * a three-minute song would report 60 plays and the icon's "you return to this" reading would be noise.
 * A write for the track already at the top of the list is a position update; a write for a different track
 * is a new play of that track.
 */
export function rememberPlay(entry: {
  label: string;
  trackId: string;
  positionSeconds: number;
  origin?: LoopOrigin;
  originHref?: string;
  originWhere?: string;
}): LoopSource {
  const id = recentId(entry.trackId);
  const existing = loops.find((candidate) => candidate.id === id);
  const at = Math.max(0, Math.floor(entry.positionSeconds));
  const now = new Date().toISOString();

  // A different track from the one at the top is a new play; the same one is the clock moving.
  const isNewPlay = loops.length === 0 || loops[0].id !== id;

  const source: LoopSource = {
    id,
    label: entry.label,
    trackId: entry.trackId,
    positionSeconds: at,
    kind: 'own',
    origin: entry.origin ?? 'shelf',
    // The source is only knowable at the *first* play, so an href already recorded is kept: playing the
    // same file later from somewhere else does not rewrite where the reader first found it, which is what
    // the brief asks the globe to point at ("where you initially started playing it from").
    originHref: existing?.originHref ?? entry.originHref,
    originWhere: existing?.originWhere ?? entry.originWhere,
    savedAt: existing?.savedAt ?? now,
    playedAt: now,
    plays: (existing?.plays ?? 0) + (isNewPlay ? 1 : 0),
  };

  commit([source, ...loops.filter((candidate) => candidate.id !== id)].slice(0, MAX_LOOPS));

  return source;
}

/** Clear one loop - what the red X in its corner does. */
export function clearLoop(id: string): void {
  const next = loops.filter((loop) => loop.id !== id);

  // Nothing changed: do not wake every listener for a press that removed nothing.
  if (next.length !== loops.length) commit(next);
}

/** Clear them all, for a reader who wants the tab empty. */
export function clearAllLoops(): void {
  if (loops.length > 0) commit(NONE);
}
