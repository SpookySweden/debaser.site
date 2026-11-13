import type { ProfileCharacterRepository, ShownCharacter } from './profile-character-repository';
import { isMood, readSheet } from './sheet';

/** The mock accounts' shown characters: one browser's storage, the strip kept as a data address. */
const STORAGE_KEY = 'debaser.profile-character.v1';

function isDataAddress(value: string): boolean {
  try {
    return new URL(value).protocol === 'data:';
  } catch {
    return false;
  }
}

function readAll(): Record<string, ShownCharacter> {
  if (typeof window === 'undefined') return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null) return {};
    const clean: Record<string, ShownCharacter> = {};
    for (const [person, entry] of Object.entries(parsed as Record<string, unknown>)) {
      const row = entry as Record<string, unknown> | null;
      const sheet = readSheet(row?.sheet);
      if (row === null || sheet === null || typeof row.characterId !== 'string' || !isMood(row.mood)) continue;
      // A data address this browser made from the baked strip, never an address somebody typed in.
      if (typeof row.stripUrl !== 'string' || !isDataAddress(row.stripUrl)) continue;
      clean[person] = {
        person,
        characterId: row.characterId,
        mood: row.mood,
        stripUrl: row.stripUrl,
        sheet,
        bakedAt: typeof row.bakedAt === 'string' ? row.bakedAt : new Date(0).toISOString(),
      };
    }
    return clean;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, ShownCharacter>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Full or switched off: it lasts this visit only.
  }
}

const asDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

export function createMockProfileCharacterRepository(): ProfileCharacterRepository {
  return {
    async getShown(person) {
      return readAll()[person] ?? null;
    },
    async show(person, input) {
      const shown: ShownCharacter = {
        person,
        characterId: input.characterId,
        mood: input.mood,
        stripUrl: await asDataUrl(input.strip),
        sheet: input.sheet,
        bakedAt: new Date().toISOString(),
      };
      writeAll({ ...readAll(), [person]: shown });
      return shown;
    },
    async setMood(person, mood) {
      const all = readAll();
      if (all[person] === undefined) return;
      writeAll({ ...all, [person]: { ...all[person], mood } });
    },
    async hide(person) {
      const all = readAll();
      delete all[person];
      writeAll(all);
    },
  };
}
