'use client';

import { useEffect, useState } from 'react';
import { normaliseLanguage } from './language';
import type { ArchiveSubtitleFile } from './subtitles';
import { webSessionHeaders } from './web-session';

/**
 * The page's side of Archive subtitles (SPEC-subtitles.md): it asks only our own route (`/api/web/subtitles`),
 * never archive.org, and checks every answer before it is drawn or played.
 */

/** An Archive item's subtitles as the route answers: the audio's language and each played video's subtitle files. */
export type ArchiveSubtitleList = { language: string | null; videos: Record<string, ArchiveSubtitleFile[]> };

/** The item and file of an Archive download address (`https://archive.org/download/<id>/<path>`), or null. */
export function archiveFileOf(url: string | null | undefined): { id: string; path: string } | null {
  if (typeof url !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'archive.org') return null;
  const parts = parsed.pathname.split('/').slice(1);
  if (parts[0] !== 'download' || parts.length < 3) return null;
  try {
    return { id: decodeURIComponent(parts[1]), path: parts.slice(2).map(decodeURIComponent).join('/') };
  } catch {
    return null;
  }
}

function readList(body: unknown): ArchiveSubtitleList | null {
  if (!body || typeof body !== 'object') return null;
  const { language, videos } = body as { language?: unknown; videos?: unknown };
  if (!videos || typeof videos !== 'object') return null;
  const clean: Record<string, ArchiveSubtitleFile[]> = {};
  for (const [path, files] of Object.entries(videos as Record<string, unknown>)) {
    if (!Array.isArray(files)) continue;
    clean[path] = files.flatMap((raw) => {
      const file = raw as Partial<ArchiveSubtitleFile>;
      if (typeof file.file !== 'string' || !/\.(vtt|srt)$/i.test(file.file) || typeof file.stem !== 'string') return [];
      return [{ file: file.file, stem: file.stem, language: normaliseLanguage(file.language ?? undefined), auto: file.auto === true }];
    });
  }
  return { language: normaliseLanguage(typeof language === 'string' ? language : undefined), videos: clean };
}

/** Lists by item, asked once per page load (the server keeps the Archive's answer a day). Null: none to be had. */
const lists = new Map<string, ArchiveSubtitleList | null>();
const asking = new Map<string, Promise<ArchiveSubtitleList | null>>();

/** An Archive item's subtitles; null when it has none or they could not be read. */
export function fetchArchiveSubtitles(id: string): Promise<ArchiveSubtitleList | null> {
  if (lists.has(id)) return Promise.resolve(lists.get(id) ?? null);
  const pending = asking.get(id);
  if (pending !== undefined) return pending;
  const ask = (async () => {
    const headers = await webSessionHeaders();
    if (headers === null) return null;
    try {
      const response = await fetch(`/api/web/subtitles?ia=${encodeURIComponent(id)}`, { headers });
      const list = response.ok ? readList(await response.json().catch(() => null)) : null;
      // Kept for the page load only when the answer is final (a list, or no such item); a refusal for too many
      // asks or a platform that did not answer is asked again by the next row or play.
      if (response.ok || response.status === 404) lists.set(id, list);
      return list;
    } catch {
      return null;
    } finally {
      asking.delete(id);
    }
  })();
  asking.set(id, ask);
  return ask;
}

/** `fetchArchiveSubtitles` for a component: undefined while asking. */
export function useArchiveSubtitles(id: string | null): ArchiveSubtitleList | null | undefined {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (id === null || lists.has(id)) return;
    let live = true;
    void fetchArchiveSubtitles(id).then(() => {
      if (live) setTick((tick) => tick + 1);
    });
    return () => {
      live = false;
    };
  }, [id]);
  if (id === null) return null;
  return lists.has(id) ? (lists.get(id) ?? null) : undefined;
}

/**
 * One subtitle file as text the player can load (a `blob:` address of the WebVTT our route passed through), or
 * null. Asked only when a viewer switches it on; held only by that page, for as long as it plays.
 */
export async function fetchSubtitleVtt(id: string, file: string): Promise<string | null> {
  const headers = await webSessionHeaders();
  if (headers === null) return null;
  try {
    const response = await fetch(`/api/web/subtitles?ia=${encodeURIComponent(id)}&file=${encodeURIComponent(file)}`, { headers });
    if (!response.ok) return null;
    const text = await response.text();
    if (!text.startsWith('WEBVTT')) return null;
    return URL.createObjectURL(new Blob([text], { type: 'text/vtt' }));
  } catch {
    return null;
  }
}
