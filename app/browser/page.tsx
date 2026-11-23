import type { Metadata } from 'next';
import SeeingMachine from '../components/seeing/SeeingMachine';
import SiteWindow from '../components/SiteWindow';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - BROWSER',
  description: 'The DEBASER seeing machine: pages from elsewhere, looked at through lenses.',
  robots: { index: false, follow: false },
};

/**
 * BROWSER, the DEBASER SEEING MACHINE (SPEC-seeing-machine.md, Luke 2026-11-23): tabs, an address box and lenses, for people with an
 * account. Phase 1: the shell and a built-in test page; nothing is fetched. The address looked at travels after the `#`, so it never
 * reaches a server in a page's address.
 */
export default function BrowserPage() {
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [BROWSER]" active="browser" tip="Pages from elsewhere, through lenses." fill>
      <SeeingMachine />
    </SiteWindow>
  );
}
