'use client';

import { Fragment, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { inkOn, LABEL_COLOURS } from '../../lib/animate/colours';
import { BLEND_LABELS, deleteRow, dropRow, newRow, selectRow, setRow, toggleRow, tweakRow } from '../../lib/animate/layers';
import { depthOf, findNode, visibleRows } from '../../lib/animate/project';
import { useStudio } from '../../lib/animate/store';
import { isFigure, tagOf } from '../../lib/animate/tags';
import type { BlendMode, LayerNode, PlaneName, Project } from '../../lib/animate/types';
import { PLATE_MEDIUM, PLATE_PRESSED } from '../../lib/ui/controls';
import AnimateSlider from './AnimateSlider';

const SMALL_KEY = 'key inline-flex h-6 w-5 shrink-0 cursor-pointer items-center justify-center text-key leading-none';

/** A tag's chip: its colour and short mark. Dotted when it's only passed down from a folder. */
export function TagChip({ project, node }: { project: Project; node: LayerNode }) {
  const tag = tagOf(project, node);
  if (tag === null) return null;
  return (
    <span
      title={node.tagId === null ? `${tag.name} (FROM ITS FOLDER)` : tag.name}
      data-animate-chip={tag.id}
      className={`shrink-0 px-0.5 text-label leading-tight ${node.tagId === null ? 'opacity-70' : ''}`}
      style={{ backgroundColor: tag.colour, color: inkOn(tag.colour) }}
    >
      {tag.mark}
    </span>
  );
}

function Toggle({ on, label, letter, off, onPress }: { on: boolean; label: string; letter: string; off?: string; onPress: () => void }) {
  return (
    <button type="button" className={on ? `${SMALL_KEY} key-on` : SMALL_KEY} aria-pressed={on} aria-label={label} title={label} onClick={onPress}>
      {on ? letter : (off ?? '.')}
    </button>
  );
}

function Row({ project, node, active, dropMark, onGrab }: { project: Project; node: LayerNode; active: boolean; dropMark: 'above' | 'into' | null; onGrab: (event: ReactPointerEvent<HTMLElement>, id: string) => void }) {
  const depth = depthOf(project, node);
  return (
    <li
      data-animate-row={node.id}
      data-kind={node.kind}
      className={`flex items-center gap-1 border-b border-ink py-0.5 pr-1 text-key ${active ? 'bg-ink text-paper' : 'text-ink'} ${dropMark === 'above' ? 'border-t-thick border-t-bubble' : ''} ${dropMark === 'into' ? 'outline-2 outline-bubble' : ''}`}
      style={{ paddingLeft: 4 + depth * 12 }}
    >
      {node.label !== null && <span aria-hidden="true" className="h-4 w-1.5 shrink-0" style={{ backgroundColor: node.label }} />}
      {node.kind === 'folder' && <Toggle on={!node.collapsed} label={node.collapsed ? 'Open the folder' : 'Close the folder'} letter="-" off="+" onPress={() => toggleRow(node.id, 'collapsed')} />}
      <Toggle on={node.visible} label={`${node.visible ? 'Hide' : 'Show'} ${node.name}`} letter="V" onPress={() => toggleRow(node.id, 'visible')} />
      <Toggle on={node.locked} label={`${node.locked ? 'Unlock' : 'Lock'} ${node.name}`} letter="L" onPress={() => toggleRow(node.id, 'locked')} />
      <Toggle on={node.solo} label={`Solo ${node.name}`} letter="S" onPress={() => toggleRow(node.id, 'solo')} />
      <button
        type="button"
        aria-pressed={active}
        className="min-w-0 flex-1 cursor-grab touch-none truncate text-left"
        onPointerDown={(event) => onGrab(event, node.id)}
        onClick={(event) => {
          if (event.detail === 0) selectRow(node.id);
        }}
      >
        {node.kind === 'folder' ? `${node.name} /` : node.name}
      </button>
      <TagChip project={project} node={node} />
    </li>
  );
}

/** A Figure's two planes, under its row: pick one to draw on, and hide or lock each apart. */
function PlaneRows({ project, node, active }: { project: Project; node: LayerNode; active: boolean }) {
  const plane = useStudio((state) => state.plane);
  const depth = depthOf(project, node) + 1;
  return (
    <>
      {(['line', 'colour'] as PlaneName[]).map((name) => (
        <li key={name} data-animate-plane-row={name} className="flex items-center gap-1 border-b border-ink py-0.5 pr-1 text-key text-ink" style={{ paddingLeft: 4 + depth * 12 }}>
          <Toggle
            on={!node.planeHidden[name]}
            label={`${node.planeHidden[name] ? 'Show' : 'Hide'} the ${name} plane`}
            letter="V"
            onPress={() => setRow(node.id, { planeHidden: { ...node.planeHidden, [name]: !node.planeHidden[name] } }, 'PLANE')}
          />
          <Toggle
            on={node.planeLocked[name]}
            label={`${node.planeLocked[name] ? 'Unlock' : 'Lock'} the ${name} plane`}
            letter="L"
            onPress={() => setRow(node.id, { planeLocked: { ...node.planeLocked, [name]: !node.planeLocked[name] } }, 'PLANE')}
          />
          <button
            type="button"
            className={active && plane === name ? PLATE_PRESSED : PLATE_MEDIUM}
            aria-pressed={active && plane === name}
            data-animate-plane={name}
            onClick={() => {
              selectRow(node.id);
              useStudio.setState({ plane: name });
            }}
          >
            [ {name.toUpperCase()} ]
          </button>
        </li>
      ))}
    </>
  );
}

/** What's picked: its name, opacity, blend, label and tag. */
function Details({ project, node }: { project: Project; node: LayerNode }) {
  return (
    <div className="flex flex-col gap-1 p-1 text-key">
      <label className="flex flex-col gap-0.5">
        <span>NAME</span>
        <input
          value={node.name}
          maxLength={40}
          aria-label="Layer name"
          onChange={(event) => tweakRow(node.id, { name: event.target.value })}
          className="frame w-full bg-paper px-1 py-0.5 font-mono text-key text-ink outline-none focus:outline-2 focus:outline-dotted focus:outline-bubble"
        />
      </label>
      <AnimateSlider label="OPACITY" min={0} max={1} step={0.05} value={node.opacity} percent onChange={(value) => tweakRow(node.id, { opacity: value })} />
      <label className="flex items-center justify-between gap-2">
        <span>BLEND</span>
        <select
          value={node.blend}
          aria-label="Blend mode"
          onChange={(event) => setRow(node.id, { blend: event.target.value as BlendMode }, 'BLEND')}
          className="frame bg-paper px-1 py-0.5 font-mono text-key text-ink"
        >
          {(Object.keys(BLEND_LABELS) as BlendMode[]).map((mode) => (
            <option key={mode} value={mode}>
              {BLEND_LABELS[mode]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2">
        <span>TAG</span>
        <select
          value={node.tagId ?? ''}
          aria-label="Tag"
          data-animate-tag-select
          onChange={(event) => {
            const tagId = event.target.value === '' ? null : event.target.value;
            setRow(node.id, { tagId }, 'TAG');
            selectRow(node.id);
          }}
          className="frame min-w-0 flex-1 bg-paper px-1 py-0.5 font-mono text-key text-ink"
        >
          <option value="">{node.parent === null ? 'NONE' : 'FROM ITS FOLDER'}</option>
          {project.tags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </select>
      </label>
      <div role="group" aria-label="Colour label" className="flex flex-wrap items-center gap-1">
        <button type="button" className={SMALL_KEY} aria-label="No label" aria-pressed={node.label === null} onClick={() => setRow(node.id, { label: null }, 'LABEL')}>
          X
        </button>
        {LABEL_COLOURS.map((colour) => (
          <button
            key={colour}
            type="button"
            aria-label={`Label ${colour}`}
            aria-pressed={node.label === colour}
            className={`h-5 w-5 cursor-pointer border-line ${node.label === colour ? 'border-bubble' : 'border-ink'}`}
            style={{ backgroundColor: colour }}
            onClick={() => setRow(node.id, { label: colour }, 'LABEL')}
          />
        ))}
      </div>
      <button type="button" className={PLATE_MEDIUM} onClick={() => deleteRow(node.id)} title="ALT + DELETE">
        [ DELETE {node.kind === 'folder' ? 'FOLDER' : 'LAYER'} ]
      </button>
    </div>
  );
}

/** The layer list. Drag a name to reorder; drop on the middle of a folder to put it inside. */
export default function AnimateLayers() {
  const project = useStudio((state) => state.project);
  const layerId = useStudio((state) => state.layerId);
  const [drop, setDrop] = useState<{ id: string; mark: 'above' | 'into' } | null>(null);
  const rows = visibleRows(project);
  const active = findNode(project, layerId);

  const grab = (event: ReactPointerEvent<HTMLElement>, id: string) => {
    const start = { x: event.clientX, y: event.clientY };
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    let dragging = false;
    let aim: { id: string; mark: 'above' | 'into' } | null = null;
    const onMove = (move: PointerEvent) => {
      if (!dragging && Math.hypot(move.clientX - start.x, move.clientY - start.y) < 6) return;
      dragging = true;
      const under = document.elementFromPoint(move.clientX, move.clientY)?.closest<HTMLElement>('[data-animate-row]');
      if (under == null) {
        aim = null;
      } else {
        const box = under.getBoundingClientRect();
        const at = (move.clientY - box.top) / box.height;
        aim = { id: under.dataset.animateRow ?? '', mark: under.dataset.kind === 'folder' && at > 0.35 ? 'into' : 'above' };
      }
      setDrop(aim);
    };
    const onUp = (up: PointerEvent) => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      setDrop(null);
      if (!dragging) {
        selectRow(id);
        return;
      }
      if (up.type === 'pointercancel' || aim === null || aim.id === id) return;
      if (aim.mark === 'into') {
        dropRow(id, null, aim.id);
      } else {
        const onto = findNode(useStudio.getState().project, aim.id);
        dropRow(id, aim.id, onto?.parent ?? null);
      }
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  return (
    <aside aria-label="Layers" className="flex w-60 flex-col border-l-line border-ink bg-sun-pale text-key max-md:w-full max-md:border-l-0">
      <div className="flex flex-wrap items-center gap-1 p-1">
        <button type="button" className={PLATE_MEDIUM} onClick={() => newRow('layer')} title="SHIFT + N">
          [ + LAYER ]
        </button>
        <button type="button" className={PLATE_MEDIUM} onClick={() => newRow('folder')} title="SHIFT + G">
          [ + FOLDER ]
        </button>
      </div>
      <ul className="max-h-[50%] min-h-16 flex-1 overflow-y-auto border-y-line border-ink max-md:max-h-48">
        {rows.map((node) => (
          <Fragment key={node.id}>
            <Row project={project} node={node} active={node.id === layerId} dropMark={drop?.id === node.id ? drop.mark : null} onGrab={grab} />
            {node.kind === 'layer' && isFigure(project, node) && <PlaneRows project={project} node={node} active={node.id === layerId} />}
          </Fragment>
        ))}
      </ul>
      {active !== null && <div className="min-h-0 flex-1 overflow-y-auto"><Details project={project} node={active} /></div>}
    </aside>
  );
}
