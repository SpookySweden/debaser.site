'use client';

import { useRef, useState } from 'react';
import { TAG_COLOURS, inkOn } from '../../lib/animate/colours';
import { getEngine } from '../../lib/animate/engine';
import { BLEND_LABELS, applyTag } from '../../lib/animate/layers';
import { findNode } from '../../lib/animate/project';
import { saveBlobAs } from '../../lib/animate/project-file';
import { useStudio } from '../../lib/animate/store';
import { blankBehaviours, exportTagPreset, readTagPreset } from '../../lib/animate/tags';
import type { BehaviourSet, BlendMode, Tag } from '../../lib/animate/types';
import { PLATE_MEDIUM, PLATE_PRESSED } from '../../lib/ui/controls';
import { AnimatePanelFrame } from './AnimatePanels';
import AnimateSlider from './AnimateSlider';

const TEXT_FIELD = 'frame min-w-0 bg-paper px-1 py-0.5 font-mono text-key text-ink outline-none focus:outline-2 focus:outline-dotted focus:outline-bubble';

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={on} onChange={(event) => onChange(event.target.checked)} data-animate-behaviour={label} />
      {label}
    </label>
  );
}

function change(id: string, patch: Partial<Tag>): void {
  getEngine().edit('TAG', (project) => ({ ...project, tags: project.tags.map((tag) => (tag.id === id ? { ...tag, ...patch } : tag)) }));
}

function changeBehaviours(tag: Tag, patch: Partial<BehaviourSet>): void {
  change(tag.id, { behaviours: { ...tag.behaviours, ...patch } });
}

/** One tag's whole bundle: every behaviour has its own switch and setting. */
function TagEditor({ tag }: { tag: Tag }) {
  const b = tag.behaviours;
  const set = (patch: Partial<BehaviourSet>) => changeBehaviours(tag, patch);
  const defaults = b.layerDefaults;
  return (
    <div className="flex flex-col gap-1.5" data-animate-tag-editor={tag.id}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">
          NAME
          <input aria-label="Tag name" value={tag.name} maxLength={24} className={`${TEXT_FIELD} w-32`} onChange={(event) => change(tag.id, { name: event.target.value.toUpperCase() })} />
        </label>
        <label className="flex items-center gap-1">
          MARK
          <input aria-label="Tag mark" value={tag.mark} maxLength={4} className={`${TEXT_FIELD} w-16`} onChange={(event) => change(tag.id, { mark: event.target.value.toUpperCase() })} />
        </label>
        <label className="flex items-center gap-1">
          COLOUR
          <input type="color" aria-label="Tag colour" value={tag.colour} className="h-8 w-12 cursor-pointer border-line border-ink bg-paper p-0" onChange={(event) => change(tag.id, { colour: event.target.value })} />
        </label>
      </div>

      <h4 className="text-accent-ink">COLOUR UNDER LINES</h4>
      <Switch label="PAINT BEHIND LINES" on={b.paintBehindLines} onChange={(on) => set({ paintBehindLines: on })} />
      <Switch label="STAY INSIDE LINES" on={b.stayInsideLines} onChange={(on) => set({ stayInsideLines: on })} />
      <Switch label="CLOSE GAPS" on={b.closeGaps.on} onChange={(on) => set({ closeGaps: { ...b.closeGaps, on } })} />
      {b.closeGaps.on && <AnimateSlider label="GAP SIZE" min={1} max={40} step={1} value={b.closeGaps.maxGapPx} unit=" PX" onChange={(maxGapPx) => set({ closeGaps: { ...b.closeGaps, maxGapPx } })} />}
      <Switch label="SHOW CLOSURES" on={b.showClosures} onChange={(on) => set({ showClosures: on })} />
      <Switch label="TUCK UNDER" on={b.tuckUnder} onChange={(on) => set({ tuckUnder: on })} />
      <Switch label="PROTECT LINES" on={b.protectLines} onChange={(on) => set({ protectLines: on })} />
      <Switch label="CLIP TO LAYER BELOW" on={b.clipToLayerBelow} onChange={(on) => set({ clipToLayerBelow: on })} />
      <Switch label="CARRY COLOUR FORWARD" on={b.carryColourForward} onChange={(on) => set({ carryColourForward: on })} />

      <h4 className="text-accent-ink">FILLS AND RENDERS</h4>
      <Switch label="IS FILL REFERENCE" on={b.isFillReference} onChange={(on) => set({ isFillReference: on })} />
      <Switch label="IGNORED BY FILLS" on={b.ignoredByFills} onChange={(on) => set({ ignoredByFills: on })} />
      <Switch label="SKIP ON EXPORT" on={b.skipOnExport} onChange={(on) => set({ skipOnExport: on })} />

      <h4 className="text-accent-ink">ON THE SHEET</h4>
      <Switch label="ONION SKIN" on={b.onionSkin.on} onChange={(on) => set({ onionSkin: { ...b.onionSkin, on } })} />
      {b.onionSkin.on && (
        <div role="group" aria-label="Onion for this tag" className="flex items-center gap-1">
          <button type="button" className={b.onionSkin.mode === 'tint' ? PLATE_PRESSED : PLATE_MEDIUM} aria-pressed={b.onionSkin.mode === 'tint'} onClick={() => set({ onionSkin: { ...b.onionSkin, mode: 'tint' } })}>
            [ TINT ]
          </button>
          <button type="button" className={b.onionSkin.mode === 'outline' ? PLATE_PRESSED : PLATE_MEDIUM} aria-pressed={b.onionSkin.mode === 'outline'} onClick={() => set({ onionSkin: { ...b.onionSkin, mode: 'outline' } })}>
            [ OUTLINE ]
          </button>
        </div>
      )}
      <Switch label="DIM WHEN INACTIVE" on={b.dimWhenInactive.on} onChange={(on) => set({ dimWhenInactive: { ...b.dimWhenInactive, on } })} />
      {b.dimWhenInactive.on && (
        <div className="flex items-center gap-2">
          <Switch label="TINT WHILE DIMMED" on={b.dimWhenInactive.tint !== null} onChange={(on) => set({ dimWhenInactive: { ...b.dimWhenInactive, tint: on ? (b.dimWhenInactive.tint ?? tag.colour) : null } })} />
          {b.dimWhenInactive.tint !== null && (
            <input type="color" aria-label="Dim tint" value={b.dimWhenInactive.tint} className="h-8 w-12 cursor-pointer border-line border-ink bg-paper p-0" onChange={(event) => set({ dimWhenInactive: { ...b.dimWhenInactive, tint: event.target.value } })} />
          )}
        </div>
      )}
      <Switch label="HOLD FOR WHOLE SHOT" on={b.holdWholeShot} onChange={(on) => set({ holdWholeShot: on })} />
      <Switch label="AUTO-NEW DRAWING" on={b.autoNewDrawing} onChange={(on) => set({ autoNewDrawing: on })} />
      <Switch label="ALWAYS ON TOP" on={b.alwaysOnTop} onChange={(on) => set({ alwaysOnTop: on })} />

      <h4 className="text-accent-ink">A NEW LAYER STARTS WITH</h4>
      <label className="flex items-center justify-between gap-2">
        BLEND
        <select
          aria-label="Starting blend"
          value={defaults.blend}
          onChange={(event) => set({ layerDefaults: { ...defaults, blend: event.target.value as BlendMode } })}
          className="frame bg-paper px-1 py-0.5 font-mono text-key text-ink"
        >
          {(Object.keys(BLEND_LABELS) as BlendMode[]).map((mode) => (
            <option key={mode} value={mode}>
              {BLEND_LABELS[mode]}
            </option>
          ))}
        </select>
      </label>
      <AnimateSlider label="OPACITY" min={0} max={1} step={0.05} value={defaults.opacity} percent onChange={(opacity) => set({ layerDefaults: { ...defaults, opacity } })} />
      <Switch label="ITS OWN STEADINESS" on={defaults.stabiliser !== null} onChange={(on) => set({ layerDefaults: { ...defaults, stabiliser: on ? 0.5 : null } })} />
      {defaults.stabiliser !== null && <AnimateSlider label="STEADY" min={0} max={1} step={0.05} value={defaults.stabiliser} percent onChange={(stabiliser) => set({ layerDefaults: { ...defaults, stabiliser } })} />}
      <Switch label="STARTS LOCKED" on={b.startLocked} onChange={(on) => set({ startLocked: on })} />
    </div>
  );
}

/** The tag editor: every tag, its switch, and its behaviours. Tags save with the project and travel as a small file. */
export default function AnimateTagPanel() {
  const tags = useStudio((state) => state.project.tags);
  const layerId = useStudio((state) => state.layerId);
  const gap = useStudio((state) => state.settings.defaultGap);
  const node = useStudio((state) => findNode(state.project, state.layerId));
  const [openId, setOpenId] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const engine = getEngine();
  const open = tags.find((tag) => tag.id === openId) ?? null;

  const makeTag = (from: Tag | null) => {
    let id = '';
    engine.edit('NEW TAG', (project) => {
      id = `t_${project.nextId}`;
      const count = project.tags.length + 1;
      const behaviours = from === null ? { ...blankBehaviours(), closeGaps: { on: false, maxGapPx: gap } } : from.behaviours;
      const tag: Tag = { id, name: from === null ? `TAG ${count}` : `${from.name} 2`.slice(0, 24), colour: from?.colour ?? TAG_COLOURS.ink, mark: from?.mark ?? `T${count}`, builtin: false, on: true, behaviours };
      return { ...project, nextId: project.nextId + 1, tags: [...project.tags, tag] };
    });
    setOpenId(id);
  };

  return (
    <AnimatePanelFrame title="TAGS" wide>
      <div className="mb-2 flex flex-wrap gap-1">
        <button type="button" className={PLATE_MEDIUM} onClick={() => makeTag(null)}>
          [ NEW TAG ]
        </button>
        <button
          type="button"
          className={PLATE_MEDIUM}
          onClick={() => void saveBlobAs(new Blob([exportTagPreset(tags.filter((tag) => !tag.builtin || tag.id === openId))], { type: 'application/json' }), 'animate-tags.json', 'Tag preset', ['.json'])}
        >
          [ SAVE TAGS ]
        </button>
        <button type="button" className={PLATE_MEDIUM} onClick={() => file.current?.click()}>
          [ LOAD TAGS ]
        </button>
        <input
          ref={file}
          id="animate-tag-file"
          type="file"
          accept=".json"
          className="sr-only"
          tabIndex={-1}
          aria-label="Tag preset file"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            event.target.value = '';
            if (chosen === undefined) return;
            void chosen.text().then((text) => {
              const read = readTagPreset(text);
              if (read.length === 0) {
                engine.notify('THAT IS NOT A TAG FILE', true);
                return;
              }
              engine.edit('LOAD TAGS', (project) => {
                let next = project.nextId;
                const added = read.map((tag) => {
                  next += 1;
                  return { ...tag, id: `t_${next}` };
                });
                return { ...project, nextId: next + 1, tags: [...project.tags, ...added] };
              });
              engine.notify(`LOADED ${read.length} ${read.length === 1 ? 'TAG' : 'TAGS'}`);
            });
          }}
        />
      </div>

      <ul className="mb-3 flex flex-col gap-1">
        {tags.map((tag, index) => (
          <li key={tag.id} className="flex flex-wrap items-center gap-1 border-b border-ink pb-1" data-animate-tag-row={tag.id}>
            <span className="px-0.5 text-label" style={{ backgroundColor: tag.colour, color: inkOn(tag.colour) }}>
              {tag.mark}
            </span>
            <span className="min-w-24 flex-1 truncate" title={tag.name}>{tag.name}</span>
            {index < 9 && <span title="A new layer with this tag">CTRL + {index + 1}</span>}
            <button type="button" className={tag.on ? PLATE_PRESSED : PLATE_MEDIUM} aria-pressed={tag.on} aria-label={`${tag.name} smarts ${tag.on ? 'on' : 'off'}`} onClick={() => change(tag.id, { on: !tag.on })}>
              [ {tag.on ? 'ON' : 'OFF'} ]
            </button>
            <button type="button" className={openId === tag.id ? PLATE_PRESSED : PLATE_MEDIUM} aria-pressed={openId === tag.id} aria-label={`Edit ${tag.name}`} onClick={() => setOpenId(openId === tag.id ? null : tag.id)}>
              [ EDIT ]
            </button>
            <button type="button" className={PLATE_MEDIUM} aria-label={`Copy ${tag.name}`} onClick={() => makeTag(tag)}>
              [ COPY ]
            </button>
            {!tag.builtin && (
              <button
                type="button"
                className={PLATE_MEDIUM}
                aria-label={`Delete ${tag.name}`}
                onClick={() => {
                  engine.edit('DELETE TAG', (project) => ({
                    ...project,
                    tags: project.tags.filter((t) => t.id !== tag.id),
                    nodes: project.nodes.map((n) => (n.tagId === tag.id ? { ...n, tagId: null } : n)),
                  }));
                  if (openId === tag.id) setOpenId(null);
                }}
              >
                [ DELETE ]
              </button>
            )}
            {node !== null && (
              <button type="button" className={node.tagId === tag.id ? PLATE_PRESSED : PLATE_MEDIUM} aria-pressed={node.tagId === tag.id} aria-label={`Put ${tag.name} on ${node.name}`} onClick={() => applyTag(layerId, node.tagId === tag.id ? null : tag.id)}>
                [ PUT ON ]
              </button>
            )}
          </li>
        ))}
      </ul>

      {open !== null && <TagEditor tag={open} />}
    </AnimatePanelFrame>
  );
}
