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
import { explain } from '../../lib/ui/explain';

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
          {...explain(`Takes up the colour ${swatch.name.toLowerCase()} and closes the pop-up.`, 'For changing colour without leaving the sheet.')}
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
const LEAST_OPACITY = 0.05;
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
        lessWords={{ what: 'Makes the brush a step smaller.', why: 'The pop-up stays open, so you can press it again.' }}
        moreWords={{ what: 'Makes the brush a step bigger.', why: 'The pop-up stays open, so you can press it again.' }}
      />
      <Stepper
        label="OPACITY"
        value={`${Math.round(opacity * 100)}%`}
        canLess={opacity > LEAST_OPACITY}
        canMore={opacity < 1}
        less={() => engine.setBrushValue(brush, { opacity: opacity <= STEP ? LEAST_OPACITY : nearest(Math.max(STEP, opacity - STEP)) })}
        more={() => engine.setBrushValue(brush, { opacity: opacity < STEP ? STEP : nearest(Math.min(1, opacity + STEP)) })}
        lessWords={{ what: 'Makes the brush more see-through by one step.', why: 'For building colour up in thin layers.' }}
        moreWords={{ what: 'Makes the brush more solid by one step.', why: 'At full it covers what is under it.' }}
      />
      <Stepper
        label="STEADY"
        value={`${Math.round(stabiliser * 100)}%`}
        canLess={stabiliser > 0}
        canMore={stabiliser < 1}
        less={() => engine.setBrushValue(brush, { stabiliser: nearest(Math.max(0, stabiliser - STEP)) })}
        more={() => engine.setBrushValue(brush, { stabiliser: nearest(Math.min(1, stabiliser + STEP)) })}
        lessWords={{ what: 'Lowers the steadying of your line by one step.', why: 'The line follows your hand more closely.' }}
        moreWords={{ what: 'Raises the steadying of your line by one step.', why: 'It smooths out a shaky hand.' }}
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
  const pick = (id: typeof tool, label: string, does: string, why: string): TileItem => ({ label, on: tool === id, run: () => engine.setTool(id), words: { what: does, why: why } });
  const tools: TileItem[] = [
    pick('ink', 'INK', 'Takes up the ink brush, a smooth line that thins and thickens with the pen.', 'For clean lines.'),
    pick('pencil', 'PENCIL', 'Takes up the pencil, a grainy line.', 'For rough drawing and sketching.'),
    pick('flat', 'FLAT', 'Takes up the flat colour brush, which paints a wide, even stroke.', 'On a figure layer it paints on the colour plane, apart from the lines.'),
    pick('eraser', 'ERASER', 'Takes up the eraser, which rubs out what you draw over.', 'For taking out part of a drawing.'),
    pick('fill', 'BUCKET', 'Takes up the bucket: one press colours the area you press.', 'For filling a shape you have drawn round.'),
    pick('fillbrush', 'FILL BRUSH', 'Takes up the fill brush: every area your stroke crosses is coloured.', 'For filling many small areas in one go.'),
    pick('filleraser', 'FILL ERASER', 'Takes up the fill eraser: every area your stroke crosses loses its colour.', 'For emptying many areas in one go.'),
    pick('pick', 'PICK COLOUR', 'Takes up the colour picker: press the drawing to take its colour.', 'For matching a colour already used.'),
    pick('lasso', 'LASSO', 'Takes up the lasso: draw round part of a drawing to select it.', 'What is selected can be moved, sized or turned.'),
    pick('rect', 'BOX', 'Takes up the box select: drag a box round part of a drawing to select it.', 'What is selected can be moved, sized or turned.'),
    pick('shift', 'TRACE', 'Takes up Shift and Trace: move a neighbouring drawing on screen to draw over it.', 'That drawing itself is not changed.'),
    pick('hand', 'HAND', 'Takes up the hand, for dragging the sheet around the window.', 'The drawing is not moved on the sheet.'),
  ];
  const actions: TileItem[] = [
    { label: 'UNDO', disabled: !canUndo, run: () => engine.undo(), words: { what: 'Takes back your last change.', why: 'Greyed out while there is nothing to take back.' } },
    { label: 'REDO', disabled: !canRedo, run: () => engine.redo(), words: { what: 'Puts back the change you last took back.', why: 'Greyed out until something has been undone.' } },
    { label: 'NEW LAYER', run: () => newRow('layer'), words: { what: 'Adds a new empty layer and picks it.', why: 'For drawing something apart from what is already there.' } },
    { label: 'ONION', on: onionOn, run: () => setOnion(!onionOn), words: { what: onionOn ? 'Turns onion skin off.' : 'Turns onion skin on: the drawings either side show faintly.', why: 'For lining a drawing up with its neighbours.' } },
    { label: 'SMART', on: smartOn, run: toggleSmarts, words: { what: smartOn ? 'Turns the smarts off, so strokes land exactly as drawn.' : 'Turns the smarts back on for the layers whose tags have them.', why: 'Smarts are what keep colour inside and under the lines.' } },
    { label: 'LAYERS', on: showLayers, run: () => updateSettings({ showLayers: !showLayers }), words: { what: showLayers ? 'Hides the layer list.' : 'Shows the layer list.', why: 'For more room to draw, or for working with layers.' } },
    // In full screen this is the way back for a pen with no keyboard to hand.
    { label: full ? 'LEAVE FULL' : 'FULL SCREEN', run: toggleFull, words: { what: full ? 'Leaves full screen and brings the keys back.' : 'Goes full screen: just the sheet and the timeline.', why: 'This pop-up still opens there, so a pen can get back.' } },
    { label: 'MENU', run: toggleMenu, words: { what: 'Opens the menu of everything the studio can do, with its keys.', why: 'For anything that is not in this pop-up.' } },
    { label: 'COLOURS', run: () => useStudio.setState({ panel: 'palette' }), words: { what: 'Opens the colours panel, with every colour and the palette.', why: 'For a colour that is not among these squares.' } },
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
