import type { Metadata } from 'next';
import CommentPopout from '../components/CommentPopout';
import ConceptSheetFrame from '../components/ConceptSheetFrame';
import ProjectSectionNav from '../components/ProjectSectionNav';
import SiteWindow from '../components/SiteWindow';
import { CONCEPT_SHEETS } from '../lib/concepts/sheets';
import { FORUM_ANCHORS } from '../lib/forum/anchors';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Concept Archive',
  description: 'Concept art and design sheets from the Debaser archive.',
};

export default function Concepts() {
  return (
    <SiteWindow
      title="DEBASER_OS - v1.0 [CONCEPT ARCHIVE]"
      tip="Visual development for the serialized comic book world. Every sheet is hand-drawn on a Kamvas tablet. The [ COMMENT ] key under a sheet opens its forum thread in a window."
    >
    <h1 className="sr-only">DEBASER.SITE // CONCEPT ARCHIVE</h1>

    <ProjectSectionNav current="concepts" />

    {/* Sheets: each window carries its own comment pop-out underneath the artwork */}
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {CONCEPT_SHEETS.map((sheet, index) => (
        <ConceptSheetFrame key={sheet.id} sheet={sheet} index={index} />
      ))}
    </div>

    {/* Sheet Index */}
    <div className="mt-6">
      <p className="text-key font-bold mb-2">SHEET INDEX:</p>
      <ul className="space-y-1">
        {CONCEPT_SHEETS.map((sheet, index) => (
          <li key={sheet.id} className="text-label font-bold">
            <a href={`#${sheet.id}`} className="underline hover:bg-pointed max-sm:inline-flex max-sm:min-h-tap max-sm:items-center">
              {index + 1}. {sheet.title}
            </a>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-ink pt-2">
        <span className="text-label font-bold">ARCHIVE HOUSEKEEPING / SHEET REQUESTS:</span>
        <CommentPopout anchor={FORUM_ANCHORS.conceptsSheetIndex} compact />
      </div>
    </div>
    </SiteWindow>
  );
}
