import type { Metadata } from 'next';
import { Suspense } from 'react';
import SiteWindow from '../components/SiteWindow';
import TagStation from '../components/TagStation';
import TagStationGate from '../components/TagStationGate';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Discover',
  description: "A map of the words on this site's media: pick a word, an item or a link, and wander out from it.",
};

/**
 * DISCOVER, called TAG STATION at /tag-station until Luke renamed it on 2026-11-05 (SPEC-discover.md), and it keeps that name in the
 * code, as WEB and CYTUBE do (SPEC-tag-station.md): a map of the words on MEDIA's saved items. Signed-in people only, like MEDIA. It loads on
 * the client from /api/tag-station/graph and keeps its whole state in the address, which needs a Suspense boundary around it.
 */
export default function DiscoverPage() {
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [DISCOVER]" active="tagstation" tip="A map of the words on this site's media.">
      <h1 className="sr-only">DEBASER.SITE // DISCOVER</h1>
      <TagStationGate>
        <Suspense fallback={null}>
          <TagStation />
        </Suspense>
      </TagStationGate>
    </SiteWindow>
  );
}
