import { MOCK_WEB_ITEMS } from '../web/mock-web-repository';
import type { WebItem } from '../web/types';
import type { TagStationRepository } from './repository';
import type { StationRow } from './types';

/**
 * Invented words over MEDIA's mock items, plus some link-only items, for building and checking TAG STATION without a
 * backend. Each line is one item's words; four neighbourhoods that overlap a little, so the map has shape.
 */
const WORDS: readonly (readonly string[])[] = [
  ['ambient', 'field recordings', 'drone', 'melancholy', '1990s'],
  ['ambient', 'field recordings', 'nature', 'calm'],
  ['ambient', 'drone', 'calm', 'tape', '1980s'],
  ['ambient', 'dub', 'bristol', 'field recordings', '1990s'],
  ['dub', 'bristol', 'reggae', 'bass', '1990s'],
  ['dub', 'reggae', 'bass', 'vocals', '1970s'],
  ['dub', 'hip hop', 'bass', 'bristol', 'vocals'],
  ['hip-hop', 'vocals', 'bass', '1990s'],
  ['hiphop', 'lo-fi', 'instrumental', 'tape'],
  ['lo fi', 'instrumental', 'calm', 'tape'],
  ['lofi', 'piano', 'melancholy', 'instrumental'],
  ['piano', 'classical', 'melancholy', '19th century'],
  ['piano', 'classical', 'romantic', '19th century'],
  ['classical', 'romantic', 'strings', '19th century', 'vocals'],
  ['animation', 'short film', 'comedy', '1920s', 'silent'],
  ['animation', 'short film', 'silent', '1930s'],
  ['animation', 'science fiction', 'comedy', 'robots'],
  ['animation', 'sci-fi', 'robots', 'space', '2000s'],
  ['science fiction', 'space', 'radio drama', '1950s'],
  ['science fiction', 'radio drama', 'space', 'adventure'],
  ['radio drama', 'adventure', 'comedy', '1940s'],
  ['audiobook', 'adventure', 'historical fiction', '19th century'],
  ['audiobook', 'historical fiction', 'poetry', 'melancholy'],
  ['audiobook', 'poetry', 'romantic', '19th century'],
  ['linux', 'open source', 'tutorial', 'software'],
  ['linux', 'open source', 'software', 'technology news'],
  ['linux', 'open-source', 'technology news', 'podcast'],
  ['tech news', 'podcast', 'software', '2020s'],
  ['podcast', 'technology news', 'interview', '2020s'],
  ['tutorial', 'blender', '3d animation', 'software'],
  ['blender', '3d animation', 'open source', 'short film'],
  ['blender', '3d animation', 'animation', 'short film', '2020s'],
  ['typography', 'graphic design', 'modernist', '1970s'],
  ['typography', 'graphic design', 'corporate identity', '1970s'],
  ['graphic design', 'corporate identity', 'modernist', 'government'],
  ['corporate identity', 'government', 'typography', '1960s'],
  ['government', 'public information film', 'short film', '1950s'],
  ['public information film', 'government', 'trains', '1940s'],
  ['trains', 'field recordings', 'nature', 'documentary'],
  ['trains', 'documentary', 'short film', '1930s'],
];

const LINK_ONLY = 'https://archive.org/details/librivoxaudio';
const KINDS: readonly WebItem['kind'][] = ['audio', 'video', 'image', 'text'];

/** MEDIA's mock items first (they have real pictures and players), then invented link-only rows for the rest. */
export const MOCK_STATION_ROWS: readonly StationRow[] = WORDS.map((claudeWords, index) => {
  const borrowed = MOCK_WEB_ITEMS[index];
  if (borrowed !== undefined) return { item: { ...borrowed, tags: index % 5 === 0 ? ['mock platform tag'] : undefined }, claudeWords };
  const externalId = `mock-station-${String(index).padStart(2, '0')}`;
  const year = 1950 + (index * 7) % 75;
  return {
    item: {
      id: `internet_archive:${externalId}`,
      platform: 'internet_archive',
      externalId,
      kind: KINDS[index % KINDS.length],
      url: LINK_ONLY,
      canonicalUrl: LINK_ONLY,
      title: `MOCK STATION ITEM ${index}: ${claudeWords[0]}`,
      creator: `Mock Creator ${index % 6}`,
      publishedAt: `${year}-01-01T00:00:00.000Z`,
      fetchedAt: '2026-10-31T12:00:00.000Z',
    },
    claudeWords,
  };
});

/** Search results nobody saved: words only, and no address, as `web_seen_items` holds them. */
const MOCK_SEEN_ROWS: readonly StationRow[] = [
  ['dub', 'bass', 'bristol'],
  ['linux', 'software', 'tutorial'],
  ['animation', 'comedy', 'short film'],
].map((claudeWords, index) => ({
  item: { id: `youtube:mockseen${index}`, platform: 'youtube', externalId: `mockseen${index}`, kind: 'video', url: '', canonicalUrl: '', title: `MOCK SEEN RESULT ${index}: ${claudeWords[0]}`, publishedAt: '2026-10-01T00:00:00.000Z', fetchedAt: '' },
  claudeWords,
  seenOnly: true,
}));

const MOCK: TagStationRepository = {
  source: 'mock',
  async rows() {
    return [...MOCK_STATION_ROWS, ...MOCK_SEEN_ROWS];
  },
  async limitReached() {
    return false;
  },
};

export function getMockTagRepository(): TagStationRepository {
  return MOCK;
}
