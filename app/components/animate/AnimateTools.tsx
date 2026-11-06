'use client';

import { useRef } from 'react';
import { BRUSH_LABELS, MAX_BRUSH_SIZE, MIN_BRUSH_SIZE } from '../../lib/animate/brushes';
import { inkOn, readPalette } from '../../lib/animate/colours';
import { getEngine } from '../../lib/animate/engine';
import { saveBlobAs } from '../../lib/animate/project-file';
import { makeSmart } from '../../lib/animate/smart';
import { useStudio, type ToolId } from '../../lib/animate/store';
import { PLATE_MEDIUM, PLATE_PRESSED } from '../../lib/ui/controls';
import AnimateSlider from './AnimateSlider';

type ToolKey = { tool: ToolId; label: string; key: string };

const TOOL_KEYS: ToolKey[] = [
  { tool: 'pencil', label: BRUSH_LABELS.pencil, key: 'P' },
  { tool: 'ink', label: BRUSH_LABELS.ink, key: 'I' },
  { tool: 'flat', label: BRUSH_LABELS.flat, key: 'F' },
  { tool: 'eraser', label: BRUSH_LABELS.eraser, key: 'E' },
  { tool: 'fill', label: BRUSH_LABELS.fill, key: 'G' },
  { tool: 'fillbrush', label: BRUSH_LABELS.fillbrush, key: 'Y' },
  { tool: 'filleraser', label: BRUSH_LABELS.filleraser, key: 'SHIFT + Y' },
  { tool: 'lasso', label: 'LASSO', key: 'W' },
  { tool: 'rect', label: 'BOX SELECT', key: 'SHIFT + W' },
  { tool: 'pick', label: 'PICK COLOUR', key: 'K' },
  { tool: 'hand', label: 'HAND', key: 'H' },
];

/** Keep the current colour, drop it, and carry a palette between projects as a file. */
function PaletteKeys() {
  const colour = useStudio((state) => state.colour);
  const palette = useStudio((state) => state.project.palette);
  const file = useRef<HTMLInputElement>(null);
  const has = palette.some((swatch) => swatch.colour === colour);
  const engine = getEngine();
  return (
    <div role="group" aria-label="Palette keys" className="flex flex-wrap gap-x-1">
      <button
        type="button"
        className={PLATE_MEDIUM}
        disabled={has}
        aria-label="Keep this colour in the palette"
        onClick={() => engine.edit('PALETTE', (project) => ({ ...project, palette: [...project.palette, { name: colour.toUpperCase(), colour }] }))}
      >
        [ + ]
      </button>
      <button
        type="button"
        className={PLATE_MEDIUM}
        disabled={!has}
        aria-label="Take this colour out of the palette"
        onClick={() => engine.edit('PALETTE', (project) => ({ ...project, palette: project.palette.filter((swatch) => swatch.colour !== colour) }))}
      >
        [ - ]
      </button>
      <button
        type="button"
        className={PLATE_MEDIUM}
        aria-label="Save the palette as a file"
        onClick={() => void saveBlobAs(new Blob([JSON.stringify({ animatePalette: 1, swatches: palette }, null, 2)], { type: 'application/json' }), 'palette.json', 'Palette', ['.json'])}
      >
        [ SAVE ]
      </button>
      <button type="button" className={PLATE_MEDIUM} aria-label="Load a palette file" onClick={() => file.current?.click()}>
        [ LOAD ]
      </button>
      <input
        ref={file}
        type="file"
        accept=".json"
        className="sr-only"
        tabIndex={-1}
        aria-label="Palette file"
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          event.target.value = '';
          if (chosen === undefined) return;
          void chosen.text().then((text) => {
            const swatches = readPalette(text);
            if (swatches === null) engine.notify('THAT IS NOT A PALETTE FILE', true);
            else engine.edit('PALETTE', (project) => ({ ...project, palette: swatches }));
          });
        }}
      />
    </div>
  );
}

/** The tools, the brush's settings and the palette. Words, not pictures: the site draws no icons. */
export default function AnimateTools() {
  const tool = useStudio((state) => state.tool);
  const colour = useStudio((state) => state.colour);
  const palette = useStudio((state) => state.project.palette);
  const brushes = useStudio((state) => state.brushes);
  const hasSelection = useStudio((state) => state.hasSelection);
  const engine = getEngine();
  const brush = engine.brushForTool(tool);
  const settings = brush === null ? null : brushes[brush];

  return (
    <div className="flex w-44 flex-col gap-2 border-r-line border-ink bg-sun-pale p-2 text-key max-md:w-full max-md:flex-row max-md:flex-wrap">
      <div role="group" aria-label="Tools" className="flex flex-col items-start gap-0.5 max-md:flex-row max-md:flex-wrap">
        {TOOL_KEYS.map((item) => (
          <button
            key={item.tool}
            type="button"
            aria-pressed={tool === item.tool}
            title={item.key}
            className={tool === item.tool ? PLATE_PRESSED : PLATE_MEDIUM}
            onClick={() => engine.setTool(item.tool)}
          >
            [ {item.label} ]
          </button>
        ))}
      </div>

      {hasSelection && (
        <button type="button" className={PLATE_MEDIUM} onClick={() => void makeSmart()} title="SHIFT + Q" data-animate-make-smart>
          [ MAKE SMART ]
        </button>
      )}

      {brush !== null && settings !== null && (
        <div className="flex flex-col gap-1 max-md:flex-row max-md:flex-wrap">
          <AnimateSlider label="SIZE" min={MIN_BRUSH_SIZE} max={MAX_BRUSH_SIZE} step={1} value={settings.size} curve onChange={(value) => engine.setBrushSize(brush, value)} />
          <AnimateSlider label="OPACITY" min={0.05} max={1} step={0.05} value={settings.opacity} percent onChange={(value) => engine.setBrushValue(brush, { opacity: value })} />
          <AnimateSlider label="STEADY" min={0} max={1} step={0.05} value={settings.stabiliser} percent onChange={(value) => engine.setBrushValue(brush, { stabiliser: value })} />
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2">
          <span>COLOUR</span>
          <input
            type="color"
            aria-label="Colour"
            value={colour}
            onChange={(event) => useStudio.setState({ colour: event.target.value })}
            className="h-8 w-12 cursor-pointer border-line border-ink bg-paper p-0"
          />
        </label>
        <div role="group" aria-label="Palette" className="grid grid-cols-4 gap-1 max-md:grid-cols-8">
          {palette.map((swatch) => (
            <button
              key={swatch.name}
              type="button"
              aria-label={swatch.name}
              aria-pressed={colour === swatch.colour}
              title={swatch.name}
              className="flex h-8 w-8 cursor-pointer items-center justify-center border-line border-ink text-label"
              style={{ backgroundColor: swatch.colour, color: inkOn(swatch.colour) }}
              onClick={() => useStudio.setState({ colour: swatch.colour })}
            >
              {colour === swatch.colour ? 'x' : ''}
            </button>
          ))}
        </div>
        <PaletteKeys />
      </div>
    </div>
  );
}
