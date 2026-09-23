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
    <SiteWindow title="DEBASER_OS - v1.0 [CONCEPT ARCHIVE]" status="Concept Archive Active">
    <h1 className="text-xl font-bold mb-4">DEBASER.SITE // CONCEPT ARCHIVE</h1>
    <p className="text-sm mb-2 leading-relaxed">
      Visual development for the serialized comic book world. Every sheet is hand-drawn on a Kamvas tablet.
    </p>
    <p className="text-[10px] font-bold mb-4">
      CLICK THE [ COMMENT ] CONTROL UNDER A SHEET TO POP OPEN AN ENCASED WINDOW HOLDING ITS FORUM THREAD.
    </p>

    <ProjectSectionNav current="concepts" />

    {/* Sheets: each window carries its own comment pop-out underneath the artwork */}
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {CONCEPT_SHEETS.map((sheet, index) => (
        <ConceptSheetFrame key={sheet.id} sheet={sheet} index={index} />
      ))}
    </div>

    {/* Sheet Index */}
    <div className="border border-black p-4 bg-ice-pale mt-6">
      <p className="text-xs font-bold mb-2">SHEET INDEX:</p>
      <ul className="space-y-1">
        {CONCEPT_SHEETS.map((sheet, index) => (
          <li
            key={sheet.id}
            className="flex flex-wrap items-center justify-between gap-2 border border-ink bg-paper p-2"
          >
            <span className="text-[10px] font-bold">
              {index + 1}. {sheet.title} :: {sheet.src}
            </span>
            <CommentPopout anchor={sheet.anchor} compact />
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-ink pt-2">
        <span className="text-[10px] font-bold">ARCHIVE HOUSEKEEPING / SHEET REQUESTS:</span>
        <CommentPopout anchor={FORUM_ANCHORS.conceptsSheetIndex} compact />
      </div>
    </div>
    </SiteWindow>
  );
}
