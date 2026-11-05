import type { Metadata } from 'next';
import { Suspense } from 'react';
import SiteWindow from '../components/SiteWindow';
import TagStation from '../components/TagStation';
import TagStationGate from '../components/TagStationGate';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Tag Station',
  description: "A map of the words on this site's media: pick a word, an item or a link, and wander out from it.",
};

/**
 * TAG STATION (SPEC-tag-station.md): a map of the words on MEDIA's saved items. Signed-in people only, like MEDIA. It loads on
 * the client from /api/tag-station/graph and keeps its whole state in the address, which needs a Suspense boundary around it.
 */
export default function TagStationPage() {
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [TAG STATION]" active="tagstation" tip="A map of the words on this site's media.">
      <h1 className="sr-only">DEBASER.SITE // TAG STATION</h1>
      <TagStationGate>
        <Suspense fallback={null}>
          <TagStation />
        </Suspense>
      </TagStationGate>
    </SiteWindow>
  );
}
