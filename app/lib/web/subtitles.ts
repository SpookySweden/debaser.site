import { isCountryCode } from '../profile/countries';
import { languageFlag, normaliseLanguage, type LanguageFlag, type LanguageTag } from './language';

/**
 * Subtitles: which languages a video can be watched with, and which one it starts on (SPEC-subtitles.md,
 * Luke's answers 2026-11-03). The audio's language is `contentLanguage`'s (language.ts); this is the rest.
 *
 * **Where a list comes from.** The Internet Archive's subtitle files (`*.<lang>.vtt` / `*.<lang>.srt`, `.asr.`
 * = machine-made), read from the item's file list on the server; the players' own lists in the stream room
 * (YouTube's captions module, Vimeo's text tracks, a stream's subtitle tracks). Subtitles burned into the
 * picture are read from the title and description (`burnedInSubtitles`): they can be named, never changed.
 *
 * **Nothing is stored.** A list is read where it is drawn; Archive subtitle text passes through our server to
 * the viewer's player and is never kept (CLAUDE.md, ARCHIVE, Luke's OK in the spec).
 *
 * Pure: no React, no fetching, so the server's route and the browser's players share it.
 */

/** One subtitle language a video can be watched with. `id` is the player's own name for it. */
export type SubtitleTrack = {
  id: string;
  /** The site's tag (`en`, `pt-BR`), or null when the player's name for it can't be read. */
  language: LanguageTag | null;
  /** What the player calls it; shown when the language can't be read. */
  label: string;
  /** Machine-made (YouTube's automatic captions, the Archive's `.asr.` files): listed after the rest, marked AUTO. */
  auto: boolean;
};

/**
 * The flag a subtitle language wears. As `languageFlag`, except English is flagged too (subtitles in English
 * are the useful part): the tag's region when it names one (`en-US` -> US), else Great Britain.
 */
export function subtitleFlag(tag: LanguageTag | null | undefined): LanguageFlag | null {
  if (tag === null || tag === undefined || tag.length === 0) return null;
  const [language, region] = tag.split('-');
  if (language !== 'en') return languageFlag(tag);
  return { language, country: region !== undefined && isCountryCode(region) ? region : 'GB', name: 'ENGLISH' };
}

/** A track's name in the pop-up: its language in English capitals, else the player's own label. */
export function subtitleName(track: Pick<SubtitleTrack, 'language' | 'label'>): string {
  if (track.language !== null) return subtitleFlag(track.language)?.name ?? track.label.toUpperCase();
  return track.label.trim().toUpperCase() || 'SUBTITLES';
}

/** Human-made first, then AUTO; each half by name. The player's own order breaks ties. */
export function orderSubtitles<T extends SubtitleTrack>(tracks: readonly T[]): T[] {
  return tracks
    .map((track, index) => ({ track, index }))
    .sort((a, b) => Number(a.track.auto) - Number(b.track.auto) || subtitleName(a.track).localeCompare(subtitleName(b.track)) || a.index - b.index)
    .map(({ track }) => track);
}

function isEnglish(tag: LanguageTag | null): boolean {
  return tag !== null && tag.split('-')[0] === 'en';
}

/**
 * The language a video is spoken in, as best known: a machine-made track's language when there is one (the
 * platform heard the audio), else what the title and description read as.
 */
export function audioLanguage(tracks: readonly SubtitleTrack[], fromText: LanguageTag | null): LanguageTag | null {
  return tracks.find((track) => track.auto && track.language !== null)?.language ?? fromText;
}

/**
 * The track a video starts on (Luke, 2026-11-03): English when the audio isn't English and English subtitles
 * exist, human-made before AUTO; otherwise none. Unknown audio starts with none: no subtitles beats a wrong guess.
 */
export function defaultSubtitle(tracks: readonly SubtitleTrack[], audio: LanguageTag | null): string | null {
  if (audio === null || isEnglish(audio)) return null;
  const english = tracks.filter((track) => isEnglish(track.language));
  return (english.find((track) => !track.auto) ?? english[0])?.id ?? null;
}

/** A pick as it carries on to the next episode of a series: by language and AUTO, since each video names its tracks its own way. */
export type SubtitleChoice = { kind: 'off' } | { kind: 'track'; language: LanguageTag | null; label: string; auto: boolean };

export function choiceOf(track: SubtitleTrack | null): SubtitleChoice {
  return track === null ? { kind: 'off' } : { kind: 'track', language: track.language, label: track.label, auto: track.auto };
}

/** The track on another video that matches a carried pick: `null` for OFF, `undefined` when it has no such track. */
export function trackForChoice(tracks: readonly SubtitleTrack[], choice: SubtitleChoice): string | null | undefined {
  if (choice.kind === 'off') return null;
  const { language, label, auto } = choice;
  const same = (track: SubtitleTrack) => (language !== null ? track.language === language : track.label === label);
  return (tracks.find((track) => same(track) && track.auto === auto) ?? tracks.find(same))?.id;
}

/**
 * A series' audio language when its platform doesn't say (a YouTube playlist): its own title, else the language
 * more than half its episodes' titles read as.
 */
export function seriesAudioLanguage(title: string, episodeTitles: readonly string[], read: (text: string) => LanguageTag | null): LanguageTag | null {
  const own = read(title);
  if (own !== null) return own;
  const votes = new Map<string, number>();
  for (const episode of episodeTitles) {
    const language = read(episode);
    if (language !== null) votes.set(language, (votes.get(language) ?? 0) + 1);
  }
  const [best] = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  return best !== undefined && best[1] * 2 > episodeTitles.length ? best[0] : null;
}

/* ------------------------------------------------------------------ subtitles in the picture */

/** Words that name a language next to "sub" ("eng sub", "sub ita", "spanish subtitles"). */
const SUB_LANGUAGE_WORDS: Record<string, string> = {
  eng: 'en', english: 'en', en: 'en', esp: 'es', español: 'es', espanol: 'es', spanish: 'es', ita: 'it', italiano: 'it',
  italian: 'it', fr: 'fr', french: 'fr', français: 'fr', francais: 'fr', ger: 'de', german: 'de', deutsch: 'de',
  pt: 'pt', por: 'pt', portuguese: 'pt', ptbr: 'pt-BR', 'pt-br': 'pt-BR', indo: 'id', indonesia: 'id', ara: 'ar',
  arabic: 'ar', chinese: 'zh', chi: 'zh', jap: 'ja', japanese: 'ja', kor: 'ko', korean: 'ko', rus: 'ru', russian: 'ru',
  tur: 'tr', turkish: 'tr', pl: 'pl', polish: 'pl', viet: 'vi', vietsub: 'vi',
};
/** Longest first, each followed by a word's end where used, so "subtitled" is never read as "sub" + "titled". */
const SUB_WORD = '(?:subtitulados|subtitulado|subtitulada|subtítulos|subtitulos|subtitles|subtitled|subtitle|subbed|subs|sub)';
/** Words that mean subtitles in one language whatever surrounds them. */
const ALONE: readonly [RegExp, string][] = [
  [/\bvostfr\b/u, 'fr'],
  [/\blegendad[oa]s?\b/u, 'pt'],
  [/\bsubtitulad[oa]s?\b/u, 'es'],
  [/\bomu\b/u, 'de'],
  [/\buntertitel(?:n)?\b/u, 'de'],
  [/\bnapisy\b/u, 'pl'],
  [/\bvietsub\b/u, 'vi'],
  [/\bengsub\b/u, 'en'],
];
const NONE = new RegExp(`\\b(?:no|without|sin|sem|sans|ohne|raw)\\s+${SUB_WORD}\\b`, 'u');

/**
 * Subtitles in the picture, read from a title and description (the spec's word list): `eng sub`, `english
 * subtitles`, `subbed` -> English; `VOSTFR` -> French; `legendado` -> Portuguese; `subtitulado`, `sub español`
 * -> Spanish; `OmU`, `Untertitel` -> German; `sub ita` -> Italian; `napisy` -> Polish. Null when nothing says so,
 * or the text says there are none ("no subs", "raw").
 */
export function burnedInSubtitles(text: string | null | undefined): LanguageTag | null {
  if (text === null || text === undefined) return null;
  const sample = text.slice(0, 600).toLowerCase();
  if (NONE.test(sample)) return null;
  const words = '([\\p{L}-]+)';
  // "<language> sub(s/titles)" and "sub(s/titles) <language>" (the language written next to the word).
  for (const pattern of [new RegExp(`${words}[\\s._-]*${SUB_WORD}\\b`, 'gu'), new RegExp(`\\b${SUB_WORD}\\b[\\s._:-]*(?:in\\s+|en\\s+|em\\s+)?${words}`, 'gu')]) {
    for (const match of sample.matchAll(pattern)) {
      const said = SUB_LANGUAGE_WORDS[match[1]] ?? normaliseLanguage(match[1].length > 3 ? match[1] : '');
      if (said) return said;
    }
  }
  for (const [pattern, language] of ALONE) if (pattern.test(sample)) return language;
  if (/\b(?:subbed|subtitled)\b/u.test(sample)) return 'en';
  return null;
}

/* ------------------------------------------------------------------ the Internet Archive's subtitle files */

/** The longest subtitle file passed through (a feature film's .srt is ~100 KB). */
export const SUBTITLE_MAX_BYTES = 512 * 1024;

/** A subtitle file in an Archive item: which video it belongs to (`stem`), its language, machine-made or not. */
export type ArchiveSubtitleFile = { file: string; stem: string; language: LanguageTag | null; auto: boolean };

/**
 * An Archive file name as a subtitle file, or null when it isn't one: `Episode 1.en.vtt` -> English for
 * `Episode 1`; `Episode 1.asr.srt` -> AUTO in the item's own language; `Episode 1.srt` -> unknown language.
 */
export function archiveSubtitleFile(name: string, itemLanguage: LanguageTag | null): ArchiveSubtitleFile | null {
  const match = /^(.+)\.(vtt|srt)$/i.exec(name);
  if (match === null) return null;
  const parts = match[1].split('.');
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  if (last.toLowerCase() === 'asr') return { file: name, stem: parts.slice(0, -1).join('.'), language: itemLanguage, auto: true };
  // A language as the last part ("en", "eng", "pt-BR", "English"); "01" or "final" is part of the name.
  const language = last.length >= 2 && last.length <= 12 && /^[A-Za-z_-]+$/.test(last) ? normaliseLanguage(last) : null;
  if (language !== null) return { file: name, stem: parts.slice(0, -1).join('.'), language, auto: false };
  return { file: name, stem: match[1], language: null, auto: false };
}

/** A file's path without its ending: `Disc 1/Episode 02.mp4` -> `Disc 1/Episode 02`. */
function withoutEnding(path: string): string {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  return dot > slash + 1 ? path.slice(0, dot) : path;
}

/**
 * Which of an item's subtitle files go with one video: those named after it, or after the upload it was made
 * from (`Episode 1.mkv`'s copy `Episode 1.mp4` shares `Episode 1.en.srt`). An item with one video owns them all.
 */
export function subtitlesForVideo(files: readonly ArchiveSubtitleFile[], video: { name: string; original?: string | null }, onlyVideo: boolean): ArchiveSubtitleFile[] {
  if (onlyVideo) return [...files];
  const names = [video.name, video.original].filter((name): name is string => typeof name === 'string' && name.length > 0);
  const stems = new Set(names.flatMap((name) => [name, withoutEnding(name)]));
  return files.filter((file) => stems.has(file.stem));
}

/* ------------------------------------------------------------------ SRT -> WebVTT */

/**
 * Subtitle text as WebVTT, which a `<track>` reads. SRT becomes VTT (a header, `,` -> `.` in the times, cue
 * numbers dropped); a VTT file is passed on. Null when it is neither. Cue text is left as text: the browser's
 * track renderer never runs it as HTML.
 */
export function toWebVtt(text: string): string | null {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (/^WEBVTT(?:[ \t\n]|$)/.test(clean)) return clean;
  const time = /^(\d{1,2}:)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}:)?(\d{1,2}):(\d{2})[,.](\d{1,3})(.*)$/;
  const stamp = (hours: string | undefined, minutes: string, seconds: string, millis: string) =>
    `${(hours ?? '00:').padStart(3, '0')}${minutes.padStart(2, '0')}:${seconds}.${millis.padEnd(3, '0')}`;
  const cues: string[] = [];
  for (const block of clean.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((line, index) => index > 0 || line.trim().length > 0);
    const at = lines.findIndex((line) => time.test(line.trim()));
    if (at === -1 || at > 1) continue;
    const parts = time.exec(lines[at].trim());
    if (parts === null) continue;
    const body = lines.slice(at + 1).join('\n').replace(/-->/g, '->').trimEnd();
    if (body.length === 0) continue;
    cues.push(`${stamp(parts[1], parts[2], parts[3], parts[4])} --> ${stamp(parts[5], parts[6], parts[7], parts[8])}\n${body}`);
  }
  return cues.length === 0 ? null : `WEBVTT\n\n${cues.join('\n\n')}\n`;
}
