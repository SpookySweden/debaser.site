'use client';

import { useRef } from 'react';
import { inkOn, readPalette } from '../../lib/animate/colours';
import { getEngine } from '../../lib/animate/engine';
import { saveBlobAs } from '../../lib/animate/project-file';
import { useStudio } from '../../lib/animate/store';
import { PLATE_MEDIUM } from '../../lib/ui/controls';
import { AnimatePanelFrame } from './AnimatePanels';

/** Any colour at all, the palette, and carrying a palette between projects as a file. The pop-up has the swatches; this is the rest. */
export default function AnimatePalettePanel() {
  const colour = useStudio((state) => state.colour);
  const palette = useStudio((state) => state.project.palette);
  const file = useRef<HTMLInputElement>(null);
  const has = palette.some((swatch) => swatch.colour === colour);
  const engine = getEngine();
  return (
    <AnimatePanelFrame title="COLOURS">
      <label className="mb-2 flex items-center gap-2 text-title">
        <span>ANY COLOUR</span>
        <input
          type="color"
          aria-label="Colour"
          value={colour}
          onChange={(event) => useStudio.setState({ colour: event.target.value })}
          className="h-10 w-16 cursor-pointer border-line border-ink bg-paper p-0"
        />
      </label>
      <div role="group" aria-label="Palette" className="mb-2 grid grid-cols-8 gap-1">
        {palette.map((swatch) => (
          <button
            key={swatch.name}
            type="button"
            aria-label={swatch.name}
            aria-pressed={colour === swatch.colour}
            title={swatch.name}
            className="flex h-9 w-9 cursor-pointer items-center justify-center border-line border-ink text-key"
            style={{ backgroundColor: swatch.colour, color: inkOn(swatch.colour) }}
            onClick={() => useStudio.setState({ colour: swatch.colour })}
          >
            {colour === swatch.colour ? 'x' : ''}
          </button>
        ))}
      </div>
      <div role="group" aria-label="Palette keys" className="flex flex-wrap gap-x-1">
        <button
          type="button"
          className={PLATE_MEDIUM}
          disabled={has}
          aria-label="Keep this colour in the palette"
          onClick={() => engine.edit('PALETTE', (project) => ({ ...project, palette: [...project.palette, { name: colour.toUpperCase(), colour }] }))}
        >
          [ KEEP IT ]
        </button>
        <button
          type="button"
          className={PLATE_MEDIUM}
          disabled={!has}
          aria-label="Take this colour out of the palette"
          onClick={() => engine.edit('PALETTE', (project) => ({ ...project, palette: project.palette.filter((swatch) => swatch.colour !== colour) }))}
        >
          [ DROP IT ]
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
    </AnimatePanelFrame>
  );
}
