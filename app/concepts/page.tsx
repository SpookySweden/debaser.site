import type { Metadata } from 'next';
import Image from 'next/image';
import AssetCommentBox from '../components/AssetCommentBox';
import ConceptArtWindow from '../components/ConceptArtWindow';
import SiteNav from '../components/SiteNav';
import { FORUM_ANCHORS } from '../lib/forum/anchors';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Concept Archive',
  description: 'Concept art and design sheets from the Debaser archive.',
};

type ConceptSheet = {
  id: string;
  asset: string;
  caption: string;
};

const CONCEPT_SHEETS: ConceptSheet[] = [
  {
    id: 'SHEET_01',
    asset: '/assets/placeholders/concept-sheet-01.png',
    caption: '[Concept Sheet Placeholder 01]',
  },
  {
    id: 'SHEET_02',
    asset: '/assets/placeholders/concept-sheet-02.png',
    caption: '[Concept Sheet Placeholder 02]',
  },
  {
    id: 'SHEET_03',
    asset: '/assets/placeholders/concept-sheet-03.png',
    caption: '[Concept Sheet Placeholder 03]',
  },
];

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
          <p className="text-sm mb-4 leading-relaxed">
            Visual development assets for the serialized comic book world. Every sheet in this archive is hand-drawn
            on a Kamvas tablet and filed here as production reference for characters, environments, and props.
          </p>

          {/* Main Viewer Window */}
          <ConceptArtWindow />

          {/* Comment box: comments on this asset open its own forum thread */}
          <AssetCommentBox
            anchor={FORUM_ANCHORS.conceptsViewer}
            note="Notes left on the concept viewer generate a thread on the forum board."
          />

          {/* Sheet Index */}
          <div className="border border-black p-4 bg-[#f0f0f0] mt-6">
            <p className="text-xs font-bold mb-2">SHEET INDEX:</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {CONCEPT_SHEETS.map((sheet) => (
                <div key={sheet.id} className="bg-white border border-gray-600 p-2">
                  <Image
                    src={sheet.asset}
                    alt={`${sheet.id} placeholder`}
                    width={160}
                    height={120}
                    className="w-full h-auto"
                  />
                  <div className="bg-gray-200 p-1 mt-2 text-xs">{sheet.caption}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Comment box on a text box (the sheet index) */}
          <AssetCommentBox
            anchor={FORUM_ANCHORS.conceptsSheetIndex}
            note="Use this box for sheet requests and archive housekeeping notes."
          />
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
