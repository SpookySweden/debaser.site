import type { Metadata } from 'next';
import DocView from '../../components/DocView';
import SiteWindow from '../../components/SiteWindow';
import { isDocId } from '../../lib/docs/rules';

type DocPageProps = {
  params: Promise<{ id: string }>;
};

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Docs',
  // A document may be private, so its title is never put in the page's own head.
  description: 'A shared document, written together live.',
};

/** One document. The writing is a shared Yjs document, read and joined on the client (../../components/DocView.tsx). */
export default async function DocPage({ params }: DocPageProps) {
  const { id } = await params;
  const address = decodeURIComponent(id);

  return (
    <SiteWindow title="DEBASER_OS - v1.0 [DOCS]">
      <h1 className="sr-only">DEBASER.SITE // DOCS</h1>
      {isDocId(address) ? (
        <DocView target={{ id: address }} />
      ) : (
        <p className="p-3 text-label font-bold text-ink">NO DOCUMENT HERE.</p>
      )}
    </SiteWindow>
  );
}
