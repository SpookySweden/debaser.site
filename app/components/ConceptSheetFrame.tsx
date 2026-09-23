import type { ConceptSheet } from '../lib/concepts/sheets';
import CommentPopout from './CommentPopout';
import SheetImage from './SheetImage';

type ConceptSheetFrameProps = {
  sheet: ConceptSheet;
  index: number;
};

/**
 * One hand-drawn sheet presented as a Win95 window, with its comment control
 * sitting underneath the artwork. Clicking that control pops open the sheet's
 * forum thread instead of pushing comments into the page flow.
 */
export default function ConceptSheetFrame({ sheet, index }: ConceptSheetFrameProps) {
  return (
    <article className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-sun-pale">
      <div className="flex items-center justify-between bg-ena px-2 py-1 text-xs font-bold text-white">
        <span>{sheet.title}</span>
        <span>F{index + 1}</span>
      </div>

      <div className="bg-white p-2">
        <SheetImage src={sheet.src} alt={sheet.caption} width={sheet.width} height={sheet.height} />
      </div>

      <div className="mt-2 bg-ice-pale p-2 text-[10px] font-bold text-black">
        CAPTION: {sheet.caption}
      </div>

      {/* Comment control sits directly under the artwork */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-sun-pale p-2">
        <span className="text-[10px] font-bold text-black">
          ARCHIVE FILE: {sheet.src}
        </span>
        <CommentPopout anchor={sheet.anchor} />
      </div>
    </article>
  );
}
