import { readSavedLayouts, type SavedLayouts } from '../ui/window-layout';
import type { WindowLayoutRepository } from './repository';

/**
 * Layouts kept in this browser, one entry per account.
 *
 * The same shape of store as the other mocks: the site has to work before a project exists. It is honest
 * about its limit - a layout saved here does not follow the account to another machine.
 */

const STORAGE_KEY = 'debaser.windows.mock.v1';

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readAll(): Record<string, unknown> {
  if (!hasStorage()) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw === null ? {} : (JSON.parse(raw) as unknown);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const repository: WindowLayoutRepository = {
  async load(userId) {
    return readSavedLayouts(readAll()[userId]);
  },
  async save(userId, layouts: SavedLayouts) {
    if (!hasStorage()) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [userId]: layouts }));
    } catch {
      // A full or refused storage loses a layout, which is a window in its corner - not worth a fault.
    }
  },
};

export function getMockWindowLayoutRepository(): WindowLayoutRepository {
  return repository;
}
