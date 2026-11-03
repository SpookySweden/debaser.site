'use client';

import type { ReactNode } from 'react';
import type { WatchQueueEntry } from '../lib/watch/types';
import { detectLanguage, type LanguageTag } from '../lib/web/language';
import { burnedInSubtitles, seriesAudioLanguage } from '../lib/web/subtitles';
import { archiveFileOf, useArchiveSubtitles, type ArchiveSubtitleList } from '../lib/web/subtitles-client';
import AudioSubsFlags from './AudioSubsFlags';
import LanguageFlag from './LanguageFlag';

/**
 * The stream queue's languages (SPEC-subtitles.md): a row's AUDIO / SUBS flags, a series block's audio flag, and an
 * episode's own flag where it differs from its block's. An Archive video's are read from the item (our route,
 * the server's day-long copy of the Archive's answer); everything else from its title.
 */

/** The subtitle languages an Archive list gives one played file (`en`, `ja:auto`). */
function languagesFor(list: ArchiveSubtitleList | null | undefined, path: string | null): string[] {
  if (!list) return [];
  const files = path === null ? Object.values(list.videos).flat() : (list.videos[path] ?? []);
  return [...new Set(files.flatMap((file) => (file.language === null ? [] : [file.auto ? `${file.language}:auto` : file.language])))];
}

/** One queue row's languages. */
export function EntryLanguageFlags({ entry, title, className }: { entry: WatchQueueEntry; title: string; className?: string }) {
  const archive = archiveFileOf(entry.link?.url);
  const list = useArchiveSubtitles(archive?.id ?? null);
  const audio = list?.language ?? detectLanguage(title);
  return <AudioSubsFlags audio={audio} subs={languagesFor(list, archive?.path ?? null)} burnedIn={burnedInSubtitles(title)} className={className} />;
}

/** A series block's languages: the Archive item's, else the playlist's (its title, else most episodes agreeing). */
export function useSeriesAudio(entries: readonly WatchQueueEntry[], title: string, titleOf: (entry: WatchQueueEntry) => string): { audio: LanguageTag | null; subs: string[] } {
  const archive = archiveFileOf(entries[0]?.link?.url);
  const list = useArchiveSubtitles(archive?.id ?? null);
  if (archive !== null && list?.language) return { audio: list.language, subs: languagesFor(list, null) };
  return { audio: seriesAudioLanguage(title, entries.map(titleOf), detectLanguage), subs: languagesFor(list, null) };
}

export function SeriesLanguageFlags({ entries, title, titleOf, className }: { entries: readonly WatchQueueEntry[]; title: string; titleOf: (entry: WatchQueueEntry) => string; className?: string }) {
  const { audio, subs } = useSeriesAudio(entries, title, titleOf);
  return <AudioSubsFlags audio={audio} subs={subs} className={className} />;
}

/** A block's episodes, drawn with the block's audio language worked out once for all of them. */
export function WithSeriesAudio({ entries, title, titleOf, children }: { entries: readonly WatchQueueEntry[]; title: string; titleOf: (entry: WatchQueueEntry) => string; children: (audio: LanguageTag | null) => ReactNode }) {
  return children(useSeriesAudio(entries, title, titleOf).audio);
}

/** An episode's own audio flag, only where it differs from its block's (an Archive item is one language). */
export function EpisodeLanguageFlag({ entry, title, blockAudio, className }: { entry: WatchQueueEntry; title: string; blockAudio: LanguageTag | null; className?: string }) {
  if (archiveFileOf(entry.link?.url) !== null) return null;
  const own = detectLanguage(title);
  if (own === null || own === blockAudio) return null;
  return <LanguageFlag tag={own} className={className} />;
}
