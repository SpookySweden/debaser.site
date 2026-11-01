import type { Metadata } from 'next';
import { Suspense } from 'react';
import SiteWindow from '../components/SiteWindow';
import WebSignInGate from '../components/WebSignInGate';
import WebStream from '../components/WebStream';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Web',
  description: 'One stream of media from around the web, newest first, with its source on every item.',
};

/**
 * WEB: a page, like the media catalogue (SPEC-web.md). It loads on the client from the WEB repository and
 * the search route. The stream reads its search from the address (`?q=&in=&type=`, so a search can be shared),
 * which needs a Suspense boundary around it.
 */
export default function WebPage() {
  return (
    <SiteWindow
      title="DEBASER_OS - v1.0 [WEB]"
      active="web"
      tip="Media from around the web, newest first. Pictures come from each source site; a player loads only when you press PLAY."
    >
      <h1 className="sr-only">DEBASER.SITE // WEB</h1>
      <WebSignInGate>
        <Suspense fallback={null}>
          <WebStream />
        </Suspense>
      </WebSignInGate>
    </SiteWindow>
  );
}
