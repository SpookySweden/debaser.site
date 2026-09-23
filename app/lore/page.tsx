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
    <SiteWindow title="DEBASER_OS - v1.0 [PROJECTS / DEBASER / LORE]" status="Lore Shelf Active">
      <h1 className="text-xl font-bold mb-4">DEBASER.SITE // LORE</h1>
      <p className="text-sm mb-2 leading-relaxed">{section?.note}</p>

      <ProjectSectionNav current="lore" />

      <LoreDirectory />

      <p className="mt-4 text-[10px] font-bold text-gray-700">
        A PAGE IS WRITTEN, NOT DRAWN: EVERY SHEET IN THIS ARCHIVE IS HAND-DRAWN, AND EVERY PAGE HERE
        IS TYPED. THE TWO SIT SIDE BY SIDE UNDER THE PROJECT FOR THAT REASON.
      </p>
    </SiteWindow>
  );
}
