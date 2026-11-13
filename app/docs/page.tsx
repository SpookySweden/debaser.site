import type { Metadata } from 'next';
import { Suspense } from 'react';
import DocsBrowser from '../components/DocsBrowser';
import SiteWindow from '../components/SiteWindow';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Docs',
  description: 'Shared documents, written together live, in folders.',
};

/** DOCS (SPEC-live-docs.md): the file browser. The folder rides the address (`?folder=`), read on the client. */
export default function DocsPage() {
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [DOCS]">
      <h1 className="sr-only">DEBASER.SITE // DOCS</h1>
      <Suspense fallback={<p className="p-3 text-label font-bold text-ink">READING...</p>}>
        <DocsBrowser />
      </Suspense>
    </SiteWindow>
  );
}
