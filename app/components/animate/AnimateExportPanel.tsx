'use client';

import { useState } from 'react';
import { exportSize, startExport, stopExport, type ExportKind } from '../../lib/animate/export';
import { useStudio } from '../../lib/animate/store';
import { PLATE_MEDIUM, PLATE_PRESSED } from '../../lib/ui/controls';
import { AnimatePanelFrame } from './AnimatePanels';

const SCALES = [
  { scale: 1, label: '100%' },
  { scale: 0.5, label: '50%' },
  { scale: 0.25, label: '25%' },
];

/** Exports. Built in this browser and saved where the person says. */
export default function AnimateExportPanel() {
  const project = useStudio((state) => state.project);
  const [scale, setScale] = useState(0.5);
  const [rangeOnly, setRangeOnly] = useState(project.range !== null);
  const [transparent, setTransparent] = useState(false);
  const progress = useStudio((state) => state.exportProgress);
  const { w, h } = exportSize(project, scale);
  const run = (kind: ExportKind) => void startExport(kind, { scale, rangeOnly, transparent });

  return (
    <AnimatePanelFrame title="EXPORT">
      <div className="flex flex-col gap-2">
        <div role="group" aria-label="Size" className="flex flex-wrap items-center gap-1">
          <span>SIZE</span>
          {SCALES.map((item) => (
            <button key={item.scale} type="button" className={scale === item.scale ? PLATE_PRESSED : PLATE_MEDIUM} aria-pressed={scale === item.scale} onClick={() => setScale(item.scale)}>
              [ {item.label} ]
            </button>
          ))}
          <span>
            {w} x {h}
          </span>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={rangeOnly} disabled={project.range === null} onChange={(event) => setRangeOnly(event.target.checked)} />
          ONLY THE IN/OUT RANGE
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={transparent} onChange={(event) => setTransparent(event.target.checked)} />
          PNG WITH NO PAPER
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={PLATE_MEDIUM} disabled={progress !== null} onClick={() => run('gif')}>
            [ GIF ]
          </button>
          <button type="button" className={PLATE_MEDIUM} disabled={progress !== null} onClick={() => run('png')}>
            [ PNG FRAMES ]
          </button>
          <button type="button" className={PLATE_MEDIUM} disabled={progress !== null} onClick={() => run('mp4')}>
            [ MP4 ]
          </button>
          <button type="button" className={PLATE_MEDIUM} disabled={progress !== null} onClick={() => run('webm')}>
            [ WEBM ]
          </button>
          {progress !== null && (
            <>
              <span role="status">{progress}</span>
              <button type="button" className={PLATE_MEDIUM} onClick={stopExport}>
                [ STOP ]
              </button>
            </>
          )}
        </div>
      </div>
    </AnimatePanelFrame>
  );
}
