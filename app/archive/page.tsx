import type { Metadata } from 'next';
import { Suspense } from 'react';
import SiteWindow from '../components/SiteWindow';
import WebSignInGate from '../components/WebSignInGate';
import WebStream from '../components/WebStream';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Archive',
  description: 'One stream of media from around the web, newest first, with its source on every item; a search also finds the files this site holds.',
};

/**
 * ARCHIVE: a page, like the media catalogue (SPEC-web.md). Called WEB, at /web, until Luke renamed it on
 * 2026-11-03; WEB is still its name in the code (`app/lib/web/`, the components, the checks), and /web
 * redirects here (next.config.ts). It loads on the client from the WEB repository and the search route. The
 * stream reads its search from the address (`?q=&in=&type=`, so a search can be shared), which needs a
 * Suspense boundary around it.
 */
export default function WebPage() {
  return (
    <SiteWindow
      title="DEBASER_OS - v1.0 [ARCHIVE]"
      active="web"
      tip="Media from around the web, newest first; a search also finds the files this site holds. Pictures come from each source; a player loads only when you press PLAY."
    >
      <h1 className="sr-only">DEBASER.SITE // ARCHIVE</h1>
      <WebSignInGate>
        <Suspense fallback={null}>
          <WebStream />
        </Suspense>
      </WebSignInGate>
    </SiteWindow>
  );
}
