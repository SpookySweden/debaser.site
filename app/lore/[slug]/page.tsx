import type { Metadata } from 'next';
import LorePageView from '../../components/LorePageView';
import ProjectSectionNav from '../../components/ProjectSectionNav';
import SiteWindow from '../../components/SiteWindow';
import { titleFromSlug } from '../../lib/lore/pages';

type LorePageProps = {
  params: Promise<{ slug: string }>;
};

/**
 * The tab and the address bar can say what the page is before the store has been asked: the title
 * is read off the slug, which is the same title the page was filed under.
 */
export async function generateMetadata({ params }: LorePageProps): Promise<Metadata> {
  const { slug } = await params;
  const name = titleFromSlug(decodeURIComponent(slug));

  return {
    title: `DEBASER.SITE - Lore :: ${name}`,
    description: `${name}: a lore page of the debaser world, written together as it is typed.`,
  };
}

/**
 * One lore page.
 *
 * The shell is static and the page itself is not: the writing is a shared document, so it is read
 * and joined on the client (see ../components/LorePageView.tsx). A visitor who is not signed in
 * still gets the writing - it is the last copy somebody filed, drawn as plain text - because a
 * world's lore is worth reading before you have an account.
 */
export default async function LorePage({ params }: LorePageProps) {
  const { slug } = await params;
  const address = decodeURIComponent(slug);

  return (
    <SiteWindow title="DEBASER_OS - v1.0 [PROJECTS / DEBASER / LORE]" status="Lore Page Active">
      <h1 className="text-xl font-bold mb-2">DEBASER.SITE // LORE</h1>
      <p className="text-[10px] font-bold mb-4">A PAGE IS ITS OWN ADDRESS: /lore/{address}</p>

      <ProjectSectionNav current="lore" />

      <LorePageView slug={address} />
    </SiteWindow>
  );
}
