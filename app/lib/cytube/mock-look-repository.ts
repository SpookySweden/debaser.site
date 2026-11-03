import { readLook, type LookChoice } from './looks';
import type { LookRepository } from './look-repository';

/**
 * Looks kept in this browser, one entry per account: the same rules as `cytube_looks` by hand. Anybody may
 * read anybody's (a viewer reads the host's), and `save` writes only the asker's own row.
 */
const STORAGE_KEY = 'debaser.cytube.looks.v1';

function readAll(): Record<string, unknown> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw === null ? {} : (JSON.parse(raw) as unknown);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function readChoice(value: unknown): LookChoice | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as { look?: unknown; showHostLook?: unknown };
  return { look: readLook(row.look), showHostLook: row.showHostLook !== false };
}

const repository: LookRepository = {
  async load(userId) {
    return readChoice(readAll()[userId]);
  },
  async save(by, choice) {
    if (typeof window === 'undefined') return;
    const row = { look: readLook(choice.look), showHostLook: choice.showHostLook };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [by]: row }));
    } catch {
      throw new Error('YOUR LOOK COULD NOT BE SAVED.');
    }
  },
};

export function getMockLookRepository(): LookRepository {
  return repository;
}
