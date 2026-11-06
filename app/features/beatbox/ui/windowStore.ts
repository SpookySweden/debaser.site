// The pop-up windows' state, outside React so moving one doesn't redraw the page: which are open, which is in front, and
// where each one sits. Where they sit is remembered in this browser. Which are open isn't: the page always opens clear.

export type WindowName = "sounds" | "recorder" | "playing" | "song" | "settings";

export interface Place {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface PlaceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_KEY = "debaser.beatbox.windows.v1";
const FIRST_PLACE = 8;
const CASCADE = 32;
const CASCADE_ORDER: readonly WindowName[] = ["sounds", "recorder", "playing", "song", "settings"];

/** Keeps the whole window in the room, so it can never be lost off an edge. In a room too small for it, it sits at the top left. */
export function clampPlace(place: Place, size: Size, room: Size): Place {
  return {
    x: Math.max(0, Math.min(room.width - size.width, place.x)),
    y: Math.max(0, Math.min(room.height - size.height, place.y)),
  };
}

/** Where a window opens before anyone moves it: stepped down and across, so each one's title shows. */
export function startingPlace(name: WindowName): Place {
  const step = CASCADE_ORDER.indexOf(name) * CASCADE;
  return { x: FIRST_PLACE + step, y: FIRST_PLACE + step };
}

function readPlaces(storage: PlaceStorage | null): Partial<Record<WindowName, Place>> {
  try {
    const saved: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "{}");
    const places: Partial<Record<WindowName, Place>> = {};
    for (const name of CASCADE_ORDER) {
      const place = (saved as Record<string, Partial<Place> | undefined>)?.[name];
      if (Number.isFinite(place?.x) && Number.isFinite(place?.y)) places[name] = { x: place?.x ?? 0, y: place?.y ?? 0 };
    }
    return places;
  } catch {
    return {};
  }
}

export interface WindowStore {
  subscribe(listener: () => void): () => void;
  /** The open windows, the one in front last. */
  getOpen(): readonly WindowName[];
  isOpen(name: WindowName): boolean;
  isFront(name: WindowName): boolean;
  open(name: WindowName): void;
  close(name: WindowName): void;
  toFront(name: WindowName): void;
  getPlace(name: WindowName): Place;
  /** Moves a window. It's only written down by rememberPlaces, so a drag isn't a save per pixel. */
  setPlace(name: WindowName, place: Place): void;
  rememberPlaces(): void;
  /** Every window back where it started. */
  resetPlaces(): void;
}

export function createWindowStore(storage: PlaceStorage | null): WindowStore {
  const listeners = new Set<() => void>();
  let open: readonly WindowName[] = [];
  let places = readPlaces(storage);
  const starting = Object.fromEntries(CASCADE_ORDER.map((name) => [name, startingPlace(name)])) as Record<WindowName, Place>;

  function notify() {
    for (const listener of listeners) listener();
  }

  function toFront(name: WindowName) {
    if (open[open.length - 1] === name) return;
    open = [...open.filter((other) => other !== name), name];
    notify();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getOpen: () => open,
    isOpen: (name) => open.includes(name),
    isFront: (name) => open[open.length - 1] === name,
    open: toFront,
    close(name) {
      if (!open.includes(name)) return;
      open = open.filter((other) => other !== name);
      notify();
    },
    toFront,
    getPlace: (name) => places[name] ?? starting[name],
    setPlace(name, place) {
      const current = places[name] ?? starting[name];
      if (current.x === place.x && current.y === place.y) return;
      places = { ...places, [name]: place };
      notify();
    },
    rememberPlaces() {
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify(places));
      } catch {
        // A browser that won't keep it only forgets where the windows were.
      }
    },
    resetPlaces() {
      places = {};
      try {
        storage?.removeItem(STORAGE_KEY);
      } catch {
        // As above.
      }
      notify();
    },
  };
}
