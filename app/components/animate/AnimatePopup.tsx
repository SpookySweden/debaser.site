'use client';

import { useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { toggleFull, toggleMenu } from '../../lib/animate/actions';
import { inkOn } from '../../lib/animate/colours';
import { getEngine } from '../../lib/animate/engine';
import { newRow } from '../../lib/animate/layers';
import { toggleSmarts } from '../../lib/animate/smart';
import { updateSettings, useStudio } from '../../lib/animate/store';
import { setOnion } from '../../lib/animate/timeline';
import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE } from '../../lib/animate/brushes';
import { Stepper, TileGrid, useTileColumns, type TileItem } from './AnimateTiles';

const close = () => useStudio.setState({ popup: null });

function press(item: TileItem): void {
  updateSettings({ hintSeen: true });
  close();
  item.run();
}

function Colours() {
  const colour = useStudio((state) => state.colour);
  const palette = useStudio((state) => state.project.palette);
  return (
    <div role="group" aria-label="Colours" className="grid grid-cols-8 gap-1">
      {palette.map((swatch) => (
        <button
          key={swatch.name}
          type="button"
          aria-label={swatch.name}
          aria-pressed={colour === swatch.colour}
          title={swatch.name}
          className="flex h-9 w-9 cursor-pointer items-center justify-center border-line border-ink text-key"
          style={{ backgroundColor: swatch.colour, color: inkOn(swatch.colour) }}
          onClick={() => {
            useStudio.setState({ colour: swatch.colour });
            close();
          }}
        >
          {colour === swatch.colour ? 'x' : ''}
        </button>
      ))}
    </div>
  );
}

const STEP = 0.1;
const nearest = (value: number) => Math.round(value * 100) / 100;

/** The brush in hand: its size, how solid it is and how steady. Only for a tool that has a brush. */
function BrushSteps() {
  const tool = useStudio((state) => state.tool);
  const brushes = useStudio((state) => state.brushes);
  const engine = getEngine();
  const brush = engine.brushForTool(tool);
  if (brush === null) return null;
  const { size, opacity, stabiliser } = brushes[brush];
  return (
    <div className="flex flex-col gap-1">
      <Stepper
        label="SIZE"
        value={String(Math.round(size))}
        canLess={size > MIN_BRUSH_SIZE}
        canMore={size < MAX_BRUSH_SIZE}
        less={() => engine.setBrushSize(brush, Math.max(MIN_BRUSH_SIZE, Math.min(size - 1, size / 1.25)))}
        more={() => engine.setBrushSize(brush, Math.min(MAX_BRUSH_SIZE, Math.max(size + 1, size * 1.25)))}
      />
      <Stepper
        label="OPACITY"
        value={`${Math.round(opacity * 100)}%`}
        canLess={opacity > 0.1}
        canMore={opacity < 1}
        less={() => engine.setBrushValue(brush, { opacity: nearest(Math.max(0.1, opacity - STEP)) })}
        more={() => engine.setBrushValue(brush, { opacity: nearest(Math.min(1, opacity + STEP)) })}
      />
      <Stepper
        label="STEADY"
        value={`${Math.round(stabiliser * 100)}%`}
        canLess={stabiliser > 0}
        canMore={stabiliser < 1}
        less={() => engine.setBrushValue(brush, { stabiliser: nearest(Math.max(0, stabiliser - STEP)) })}
        more={() => engine.setBrushValue(brush, { stabiliser: nearest(Math.min(1, stabiliser + STEP)) })}
      />
    </div>
  );
}

/** The tool pop-up: at the pen, a block of big words, one press to pick, and it closes itself. Pressing anywhere else just closes it. */
export default function AnimatePopup() {
  const popup = useStudio((state) => state.popup);
  const uiScale = useStudio((state) => state.settings.uiScale);
  const leftHanded = useStudio((state) => state.settings.leftHanded);
  const full = useStudio((state) => state.settings.full);
  const tool = useStudio((state) => state.tool);
  const onionOn = useStudio((state) => state.project.onion.on);
  const smartOn = useStudio((state) => state.smartOn);
  const canUndo = useStudio((state) => state.canUndo);
  const canRedo = useStudio((state) => state.canRedo);
  const showLayers = useStudio((state) => state.settings.showLayers);
  const columns = useTileColumns(4);
  const box = useRef<HTMLDivElement>(null);

  // Kept fully on the sheet, however near an edge the pen was; and scrolled inside itself if the sheet is smaller than it is.
  useLayoutEffect(() => {
    const el = box.current;
    if (el === null || popup === null) return;
    const parent = el.parentElement?.getBoundingClientRect();
    if (parent === undefined) return;
    const rect = el.getBoundingClientRect();
    const wantX = leftHanded ? popup.x - rect.width - 12 : popup.x + 12;
    const x = Math.max(4, Math.min(parent.width - rect.width - 4, wantX));
    const y = Math.max(4, Math.min(parent.height - rect.height - 4, popup.y - 12));
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.style.visibility = 'visible';
    // The keyboard starts on the tool in hand. A pen just presses what it wants.
    (el.querySelector<HTMLButtonElement>('button[aria-pressed="true"]') ?? el.querySelector('button'))?.focus({ preventScroll: true });
  }, [popup, leftHanded, uiScale, columns]);

  if (popup === null) return null;
  const engine = getEngine();
  const pick = (id: typeof tool, label: string): TileItem => ({ label, on: tool === id, run: () => engine.setTool(id) });
  const tools: TileItem[] = [
    pick('ink', 'INK'),
    pick('pencil', 'PENCIL'),
    pick('flat', 'FLAT'),
    pick('eraser', 'ERASER'),
    pick('fill', 'BUCKET'),
    pick('fillbrush', 'FILL BRUSH'),
    pick('filleraser', 'FILL ERASER'),
    pick('pick', 'PICK COLOUR'),
    pick('lasso', 'LASSO'),
    pick('rect', 'BOX'),
    pick('shift', 'TRACE'),
    pick('hand', 'HAND'),
  ];
  const actions: TileItem[] = [
    { label: 'UNDO', disabled: !canUndo, run: () => engine.undo() },
    { label: 'REDO', disabled: !canRedo, run: () => engine.redo() },
    { label: 'NEW LAYER', run: () => newRow('layer') },
    { label: onionOn ? 'ONION OFF' : 'ONION ON', run: () => setOnion(!onionOn) },
    { label: smartOn ? 'SMART OFF' : 'SMART ON', run: toggleSmarts },
    { label: 'LAYERS', on: showLayers, run: () => updateSettings({ showLayers: !showLayers }) },
    // In full screen this is the way back for a pen with no keyboard to hand.
    { label: full ? 'LEAVE FULL' : 'FULL SCREEN', run: toggleFull },
    { label: 'MENU', run: toggleMenu },
    { label: 'COLOURS', run: () => useStudio.setState({ panel: 'palette' }) },
  ];

  // Arrows walk the block, for a person on the keyboard.
  const walk = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key];
    if (by === undefined) return;
    event.preventDefault();
    const keys = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const at = keys.indexOf(document.activeElement as HTMLButtonElement);
    keys[Math.max(0, Math.min(keys.length - 1, at + by))]?.focus();
  };

  return (
    <div className="absolute inset-0 z-30 overflow-hidden" data-animate-popup-layer>
      <button type="button" aria-label="Close the tools" tabIndex={-1} className="absolute inset-0 h-full w-full cursor-default" onPointerDown={close} />
      <div ref={box} role="dialog" aria-label="Tools" data-animate-popup onKeyDown={walk} className="absolute left-0 top-0 overflow-auto frame bg-paper text-ink" style={{ visibility: 'hidden', maxWidth: 'calc(100% - 8px)', maxHeight: 'calc(100% - 8px)' }}>
        <div className="flex flex-col gap-2 p-2" style={{ zoom: uiScale }}>
          <TileGrid items={tools} columns={columns} onPress={press} />
          <div className="border-t-line border-ink pt-2">
            <TileGrid items={actions} columns={columns} onPress={press} />
          </div>
          <div className="flex flex-wrap items-start justify-between gap-3 border-t-line border-ink pt-2">
            <Colours />
            <BrushSteps />
          </div>
        </div>
      </div>
    </div>
  );
}
