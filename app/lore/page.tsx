import type { Metadata } from 'next';
import LoreDirectory from '../components/LoreDirectory';
import ProjectSectionNav from '../components/ProjectSectionNav';
import SiteWindow from '../components/SiteWindow';
import { projectSection } from '../lib/projects/debaser';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Lore',
  description: 'The lore pages of the debaser world, written together by whoever has one open.',
};

/**
 * The lore shelf.
 *
 * The pages themselves are in the store, not in this file: a page is opened and written by
 * whoever is at the keyboard, so the shelf lists what the site actually holds rather than what
 * the code happens to mention (which is the opposite of how the notes shelf works - see
 * app/lib/projects/notes.ts - and deliberately so: a note is about the archive, a lore page is
 * about the world).
 */
export default function LorePage() {
  const section = projectSection('lore');

  return (
    <SiteWindow
      title="DEBASER_OS - v1.0 [PROJECTS / DEBASER / LORE]"
      tip={section?.note}
    >
      <h1 className="sr-only">DEBASER.SITE // LORE</h1>

      <ProjectSectionNav current="lore" />

      <LoreDirectory />

    </SiteWindow>
  );
}
