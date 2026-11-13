import type { Metadata } from 'next';
import DocView from '../../components/DocView';
import ProjectSectionNav from '../../components/ProjectSectionNav';
import SiteWindow from '../../components/SiteWindow';
import HistoryNote from '../../components/HistoryNote';
import { titleFromSlug } from '../../lib/docs/rules';

type LorePageProps = {
  params: Promise<{ slug: string }>;
};

/** The tab can say what the page is before the store has been asked: the title is read off the slug. */
export async function generateMetadata({ params }: LorePageProps): Promise<Metadata> {
  const { slug } = await params;
  const name = titleFromSlug(decodeURIComponent(slug));

  return {
    title: `DEBASER.SITE - Lore :: ${name}`,
    description: `${name}: a lore page of the debaser world, written together as it is typed.`,
  };
}

/**
 * One lore page. Lore pages are documents in DOCS' LORE folder now (SPEC-live-docs.md): this address and
 * DOCS > LORE open the same document, with the same live editor, carets, pointers and comments.
 */
export default async function LorePage({ params }: LorePageProps) {
  const { slug } = await params;
  const address = decodeURIComponent(slug);

  return (
    <SiteWindow title="DEBASER_OS - v1.0 [PROJECTS / DEBASER / LORE]">
      <h1 className="sr-only">DEBASER.SITE // LORE</h1>

      <ProjectSectionNav current="lore" />

      <DocView target={{ slug: address }} />
      {/* FOR YOU's private history (SPEC-recommender.md): a lore page read, by its title. */}
      <HistoryNote kind="lore" refName={address} title={titleFromSlug(address)} words={address.split('-').filter((word) => word.length > 3)} />
    </SiteWindow>
  );
}
