import type { Metadata } from 'next';
import ComicStudio from '../../components/comic/ComicStudio';
import SiteWindow from '../../components/SiteWindow';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Comic studio',
  description: 'Where the comic is put together.',
  robots: { index: false },
};

/** Luke's studio (SPEC-comic.md): the house account only. Not on the top bar; `[ STUDIO ]` on /comic leads here. */
export default function ComicStudioRoute() {
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [COMIC STUDIO]" active="comic" tip="Where the comic is put together.">
      <h1 className="sr-only">DEBASER.SITE // COMIC // STUDIO</h1>
      <ComicStudio />
    </SiteWindow>
  );
}
