import type { Metadata } from 'next';
import { Suspense } from 'react';
import RecommendationsPage from '../components/RecommendationsPage';
import SiteWindow from '../components/SiteWindow';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Recommendations',
  description: 'Queues of things from around the site, sent to people or posted for everyone.',
};

/**
 * RECOMMENDATIONS (SPEC-recommendations.md, Luke 2026-11-10): a module, off until ticked in MODULOS, whose address always
 * works. Open to visitors for the PUBLIC tab, with no names; sending needs an account. Reads `?open=<id>` (a notification's
 * link), so it sits inside a Suspense boundary.
 */
export default function RecommendationsRoute() {
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [RECOMMENDATIONS]" active="recommendations" tip="Things people recommend, to you and to everyone.">
      <h1 className="sr-only">DEBASER.SITE // RECOMMENDATIONS</h1>
      <Suspense fallback={null}>
        <RecommendationsPage />
      </Suspense>
    </SiteWindow>
  );
}
