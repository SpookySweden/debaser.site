'use client';

import { tagKey } from './tag-vocabulary';

/**
 * Chosen tag colours, remembered per canonical tag key.
 *
 * The colour picker writes here, so a tag keeps the colour someone gave it on
 * every later post - and rows filed before the picker existed still pick the
 * colour up, because it is looked up by tag key rather than stored on the post.
 */
const STORAGE_KEY = 'debaser.forum.tag-colours.v1';

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

let cache: Record<string, string> | null = null;

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/** Every remembered colour, keyed by canonical tag key. */
export function readTagColours(): Record<string, string> {
  if (cache !== null) return cache;
  if (!hasStorage()) return {};

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null || raw.length === 0) {
      cache = {};
      return cache;
    }

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      cache = {};
      return cache;
    }

    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && HEX_PATTERN.test(value)) clean[key] = value;
    }

    cache = clean;
    return cache;
  } catch {
    cache = {};
    return cache;
  }
}

/** Stores the colour picked for a tag. */
export function rememberTagColour(label: string, colour: string): void {
  const key = tagKey(label);
  if (key.length === 0 || !HEX_PATTERN.test(colour)) return;

  const next = { ...readTagColours(), [key]: colour };
  cache = next;

  if (!hasStorage()) return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage disabled: the colour still applies for this session.
  }
}

/** The colour picked for a tag, if one was ever chosen. */
export function tagColourFor(label: string): string | undefined {
  return readTagColours()[tagKey(label)];
}
