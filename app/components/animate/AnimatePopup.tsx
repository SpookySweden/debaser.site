'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { inkOn } from '../../lib/animate/colours';
import { getEngine } from '../../lib/animate/engine';
import { newRow } from '../../lib/animate/layers';
import { toggleSmarts } from '../../lib/animate/smart';
import { updateSettings, useStudio, type ToolId } from '../../lib/animate/store';
import { setOnion } from '../../lib/animate/timeline';

type Item = { label: string; run: () => void; on?: boolean; stay?: boolean };

const WORD = 'key cursor-pointer whitespace-nowrap px-2 py-1.5 text-center text-heading leading-tight';
const WORD_ON = `${WORD} key-fill key-on [--key-fill:var(--color-ink)] text-paper`;

function toolItems(tool: ToolId): Item[] {
  const engine = getEngine();
  const pick = (id: ToolId, label: string): Item => ({ label, on: tool === id, run: () => engine.setTool(id) });
  return [
    pick('ink', 'INK'),
    pick('pencil', 'PENCIL'),
    pick('flat', 'FLAT'),
    pick('eraser', 'ERASER'),
    pick('fill', 'BUCKET'),
    pick('fillbrush', 'FILL BRUSH'),
    pick('filleraser', 'FILL ERASER'),
    pick('lasso', 'LASSO'),
    pick('rect', 'BOX'),
    pick('shift', 'TRACE'),
    pick('pick', 'PICK COLOUR'),
    pick('hand', 'HAND'),
  ];
}

function actionItems(onionOn: boolean, smartOn: boolean): Item[] {
  const engine = getEngine();
  return [
    { label: 'UNDO', run: () => engine.undo() },
    { label: 'REDO', run: () => engine.redo() },
    { label: 'NEW LAYER', run: () => newRow('layer') },
    { label: onionOn ? 'ONION OFF' : 'ONION ON', run: () => setOnion(!onionOn) },
    { label: smartOn ? 'SMART OFF' : 'SMART ON', run: toggleSmarts },
  ];
}

const close = () => useStudio.setState({ popup: null });

function press(item: Item): void {
  updateSettings({ hintSeen: true });
  item.run();
  if (item.stay !== true) close();
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

function SizeKeys() {
  const tool = useStudio((state) => state.tool);
  const brushes = useStudio((state) => state.brushes);
  const engine = getEngine();
  const brush = engine.brushForTool(tool);
  if (brush === null) return null;
  const size = brushes[brush].size;
  const step = (factor: number) => engine.setBrushSize(brush, factor > 1 ? Math.max(size + 1, size * factor) : Math.min(size - 1, size * factor));
  return (
    <div className="flex items-center justify-center gap-2 text-heading">
      <button type="button" className={WORD} aria-label="Brush smaller" onClick={() => step(1 / 1.25)}>
        [ - ]
      </button>
      <span aria-live="polite">SIZE {Math.round(size)}</span>
      <button type="button" className={WORD} aria-label="Brush bigger" onClick={() => step(1.25)}>
        [ + ]
      </button>
    </div>
  );
}

function Word({ item }: { item: Item }) {
  return (
    <button type="button" className={item.on === true ? WORD_ON : WORD} aria-pressed={item.on === true} onClick={() => press(item)}>
      {item.label}
    </button>
  );
}

/** A: one column of big words, reading down from the pen. */
function ListBody({ tools, actions }: { tools: Item[]; actions: Item[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col">
        {tools.map((item) => (
          <Word key={item.label} item={item} />
        ))}
      </div>
      <div className="grid grid-cols-2 border-t-line border-ink pt-1">
        {actions.map((item) => (
          <Word key={item.label} item={item} />
        ))}
      </div>
      <SizeKeys />
      <Colours />
    </div>
  );
}

/** B: a wide block of tiles, everything at a glance with no reading down. */
function GridBody({ tools, actions }: { tools: Item[]; actions: Item[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-4 gap-1">
        {tools.map((item) => (
          <Word key={item.label} item={item} />
        ))}
      </div>
      <div className="grid grid-cols-5 gap-1 border-t-line border-ink pt-1">
        {actions.map((item) => (
          <Word key={item.label} item={item} />
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Colours />
        <SizeKeys />
      </div>
    </div>
  );
}

const RING_RADIUS = 170;

/** C: eight words in a ring round the pen, each a short move away in its own direction; the rest behind MORE. */
function RingBody({ tools, actions }: { tools: Item[]; actions: Item[] }) {
  const [more, setMore] = useState(false);
  if (more) return <GridBody tools={tools} actions={actions} />;
  const ring = [tools[0], tools[1], tools[2], tools[3], tools[4], tools[7], tools[10], actions[0]];
  return (
    <div className="relative" style={{ width: RING_RADIUS * 2 + 170, height: RING_RADIUS * 2 + 70 }}>
      {ring.map((item, i) => {
        const angle = -Math.PI / 2 + (i / ring.length) * Math.PI * 2;
        return (
          <div
            key={item.label}
            className="absolute -translate-x-1/2 -translate-y-1/2 bg-paper"
            style={{ left: `calc(50% + ${Math.round(Math.cos(angle) * RING_RADIUS)}px)`, top: `calc(50% + ${Math.round(Math.sin(angle) * (RING_RADIUS - 25))}px)` }}
          >
            <Word item={item} />
          </div>
        );
      })}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-paper">
        <button type="button" className={WORD} onClick={() => setMore(true)}>
          [ MORE ]
        </button>
      </div>
    </div>
  );
}

/** The tool pop-up: at the pen, big words, one press to pick, and it closes itself. Pressing anywhere else just closes it. */
export default function AnimatePopup() {
  const popup = useStudio((state) => state.popup);
  const layout = useStudio((state) => state.settings.layout);
  const uiScale = useStudio((state) => state.settings.uiScale);
  const tool = useStudio((state) => state.tool);
  const onionOn = useStudio((state) => state.project.onion.on);
  const smartOn = useStudio((state) => state.smartOn);
  const box = useRef<HTMLDivElement>(null);

  // Kept fully on the sheet, however near an edge the pen was.
  useLayoutEffect(() => {
    const el = box.current;
    if (el === null || popup === null) return;
    const parent = el.parentElement?.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    if (parent === undefined) return;
    const centred = layout === 'c';
    const wantX = centred ? popup.x - rect.width / 2 : popup.x + 12;
    const wantY = centred ? popup.y - rect.height / 2 : popup.y - 12;
    const x = Math.max(4, Math.min(parent.width - rect.width - 4, wantX));
    const y = Math.max(4, Math.min(parent.height - rect.height - 4, wantY));
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.style.visibility = 'visible';
  }, [popup, layout, uiScale]);

  if (popup === null) return null;
  const tools = toolItems(tool);
  const actions = actionItems(onionOn, smartOn);
  return (
    <div className="absolute inset-0 z-30 overflow-hidden" data-animate-popup-layer>
      <button type="button" aria-label="Close the tools" tabIndex={-1} className="absolute inset-0 h-full w-full cursor-default" onPointerDown={close} />
      <div
        ref={box}
        role="dialog"
        aria-label="Tools"
        data-animate-popup
        className={layout === 'c' ? 'absolute left-0 top-0 text-ink' : 'absolute left-0 top-0 frame bg-paper p-2 text-ink'}
        style={{ visibility: 'hidden', zoom: uiScale }}
      >
        {layout === 'a' && <ListBody tools={tools} actions={actions} />}
        {layout === 'b' && <GridBody tools={tools} actions={actions} />}
        {layout === 'c' && <RingBody tools={tools} actions={actions} />}
      </div>
    </div>
  );
}
