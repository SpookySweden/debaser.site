import type { Metadata } from 'next';
import CommentPopout from '../components/CommentPopout';
import ConceptSheetFrame from '../components/ConceptSheetFrame';
import SiteNav from '../components/SiteNav';
import { CONCEPT_SHEETS } from '../lib/concepts/sheets';
import { FORUM_ANCHORS } from '../lib/forum/anchors';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Concept Archive',
  description: 'Concept art and design sheets from the Debaser archive.',
};

export default function Concepts() {
  return (
    <main className="min-h-screen bg-[#008080] p-4 font-mono select-none flex items-center justify-center">
      <div className="w-[95vw] h-[92vh] bg-[#c0c0c0] border-t-2 border-l-2 border-white border-r-2 border-b-2 border-black flex flex-col shadow-2xl rounded-none">

        {/* Title Bar */}
        <div className="bg-[#000080] text-white px-3 py-1 flex justify-between items-center font-bold text-sm">
          <span>DEBASER_OS - v1.0 [CONCEPT ARCHIVE]</span>
          <div className="flex gap-1">
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">_</button>
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">□</button>
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">×</button>
          </div>
        </div>

        {/* Taskbar Navigation */}
        <SiteNav active="concepts" />

        {/* Content Body - Concept Art Gallery */}
        <div className="flex-1 bg-white border-inset border-2 border-gray-600 m-2 p-6 overflow-y-auto text-black">
          <h1 className="text-3xl font-bold mb-4">DEBASER.SITE // CONCEPT ARCHIVE</h1>
          <p className="text-sm mb-2 leading-relaxed">
            Visual development assets for the serialized comic book world. Every sheet in this archive is hand-drawn
            on a Kamvas tablet, filed in the project assets folder, and served straight from the repo.
          </p>
          <p className="text-[10px] font-bold mb-4">
            CLICK THE [ COMMENT ] CONTROL UNDER A SHEET TO POP OPEN AN ENCASED WINDOW HOLDING ITS FORUM THREAD.
          </p>

          {/* Sheets: each window carries its own comment pop-out underneath the artwork */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {CONCEPT_SHEETS.map((sheet, index) => (
              <ConceptSheetFrame key={sheet.id} sheet={sheet} index={index} />
            ))}
          </div>

          {/* Sheet Index */}
          <div className="border border-black p-4 bg-[#f0f0f0] mt-6">
            <p className="text-xs font-bold mb-2">SHEET INDEX:</p>
            <ul className="space-y-1">
              {CONCEPT_SHEETS.map((sheet, index) => (
                <li
                  key={sheet.id}
                  className="flex flex-wrap items-center justify-between gap-2 border border-gray-500 bg-white p-2"
                >
                  <span className="text-[10px] font-bold">
                    {index + 1}. {sheet.title} :: {sheet.src}
                  </span>
                  <CommentPopout anchor={sheet.anchor} compact />
                </li>
              ))}
            </ul>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-gray-400 pt-2">
              <span className="text-[10px] font-bold">ARCHIVE HOUSEKEEPING / SHEET REQUESTS:</span>
              <CommentPopout anchor={FORUM_ANCHORS.conceptsSheetIndex} compact />
            </div>
          </div>
        </div>

        {/* Status Bar */}
        <div className="px-3 py-1 text-xs bg-[#c0c0c0] border-t border-white flex justify-between text-black">
          <span>Status: Concept Archive Active</span>
          <span>UTF-8</span>
        </div>

      </div>
    </main>
  );
}
