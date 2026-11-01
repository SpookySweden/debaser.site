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
    <article id={sheet.id} className="frame scroll-mt-2 bg-sun-pale">
      <div className="title-line text-accent-ink">
        <span>{sheet.title}</span>
        <span>F{index + 1}</span>
      </div>

      <div className="bg-paper p-2">
        <SheetImage src={sheet.src} alt={sheet.caption} width={sheet.width} height={sheet.height} />
      </div>

      {/* The caption and the comment control, directly under the artwork. The `CAPTION:` prefix and the
          `ARCHIVE FILE:` path went with SPEC-efficiency.md: the words are plainly the caption, and a file
          path is nothing a reader acts on. */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2">
        <span className="text-label font-bold text-ink">{sheet.caption}</span>
        <CommentPopout anchor={sheet.anchor} />
      </div>
    </article>
  );
}
