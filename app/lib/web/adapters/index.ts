import type { StreamPlatform } from '../types';
import { internetArchiveAdapter } from './internet-archive';
import { openverseAdapter } from './openverse';
import { peertubeAdapter } from './peertube';
import { podcastAdapter } from './podcast';
import { youtubeAdapter } from './youtube';
import type { WebAdapter } from './types';

/** One adapter per platform. Adding a platform: `.claude/skills/add-web-adapter/SKILL.md`. */
export const WEB_ADAPTERS: Record<StreamPlatform, WebAdapter> = {
  internet_archive: internetArchiveAdapter,
  peertube: peertubeAdapter,
  openverse: openverseAdapter,
  podcast: podcastAdapter,
  youtube: youtubeAdapter,
};
