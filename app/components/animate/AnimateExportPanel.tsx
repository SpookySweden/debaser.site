'use client';

import { useRef, useState } from 'react';
import { exportGif, exportPngSequence, exportSize, saveExport } from '../../lib/animate/export';
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
  const [progress, setProgress] = useState<string | null>(null);
  const cancelled = useRef(false);
  const { w, h } = exportSize(project, scale);

  const run = async (kind: 'gif' | 'png') => {
    cancelled.current = false;
    setProgress('STARTING...');
    try {
      const settings = {
        scale,
        rangeOnly,
        transparent,
        cancelled: () => cancelled.current,
        onProgress: (done: number, total: number) => setProgress(`${kind === 'gif' ? 'GIF' : 'PNG'} ${done} / ${total}`),
      };
      const blob = kind === 'gif' ? await exportGif(settings) : await exportPngSequence(settings);
      if (blob !== null) {
        const saved = kind === 'gif' ? await saveExport(blob, '.gif', 'GIF') : await saveExport(blob, '.png-frames.zip', 'PNG frames');
        useStudio.setState({ notice: { text: saved ? 'EXPORTED' : 'NOT SAVED', fault: false } });
      }
    } catch {
      useStudio.setState({ notice: { text: 'THE EXPORT FAILED', fault: true } });
    }
    setProgress(null);
  };

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
          <button type="button" className={PLATE_MEDIUM} disabled={progress !== null} onClick={() => void run('gif')}>
            [ GIF ]
          </button>
          <button type="button" className={PLATE_MEDIUM} disabled={progress !== null} onClick={() => void run('png')}>
            [ PNG FRAMES ]
          </button>
          {progress !== null && (
            <>
              <span role="status">{progress}</span>
              <button
                type="button"
                className={PLATE_MEDIUM}
                onClick={() => {
                  cancelled.current = true;
                }}
              >
                [ STOP ]
              </button>
            </>
          )}
        </div>
      </div>
    </AnimatePanelFrame>
  );
}
