'use client';

/**
 * NEW FIGURE: a card per preset, each with a small still picture of it, its name and a one-line joke.
 *
 * **Two presses, like everything that starts something here.** Tapping a card only picks it (it inverts); the button
 * at the foot - which names the pick, "START WITH GUY" - is what replaces the bench. A stray tap on a card can
 * therefore never throw a figure away, and the foot says out loud that UNDO brings the old one back.
 *
 * Drawn over the workbench (absolutely positioned, so nothing behind it moves). ESC, CANCEL or a press on the dim
 * edge closes it. ESC is caught before the customiser hears it, so it closes the picker and not the whole window.
 *
 * Each picture is its own small canvas: the same primitives, the same lambert light, a three-quarter flat camera.
 * They exist only while the picker is open, so the workbench pays for them only while they are being looked at.
 */
import { OrthographicCamera } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import { placementOf } from '../lib/character/figure';
import { unitGeometry } from '../lib/character/geometry';
import { MODEL_INK, MODEL_VOID } from '../lib/character/palette';
import { buildDefaultFigure, FLOOR_Y, RIG_PRESET_IDS, RIG_PRESETS, type RigPresetId } from '../lib/character/rig';
import { jointFrames } from '../lib/character/skeleton';
import { DEFAULT_LIGHT, useCharacterStore } from '../lib/character/store';
import { TITLE_BAR_INACTIVE } from '../lib/ui/controls';

/** The picture's frame: from the floor to just above the tallest crown (GUY), a little wider than the widest preset. */
const PREVIEW_HEIGHT = 2.6;
const PREVIEW_WIDTH = 2.1;
const PREVIEW_CENTRE_Y = FLOOR_Y + PREVIEW_HEIGHT / 2 - 0.08;
/** A three-quarter view, turned this far round from the front, so the pictures show some depth. */
const PREVIEW_TURN = 0.55;

export default function CharacterPresetPicker() {
  const open = useCharacterStore((state) => state.presetPickerOpen);
  return open ? <Picker /> : null;
}

function Picker() {
  const current = useCharacterStore((state) => state.presetId);
  const setPresetPicker = useCharacterStore((state) => state.setPresetPicker);
  const applyPreset = useCharacterStore((state) => state.applyPreset);
  const [picked, setPicked] = useState<RigPresetId | null>(null);
  const close = () => setPresetPicker(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Caught on the way down, before the customiser's own ESC handler - which would close the whole window.
      event.stopPropagation();
      useCharacterStore.getState().setPresetPicker(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <div
      className="absolute inset-0 z-20 flex items-start justify-center bg-ink/60 p-2 sm:p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        role="dialog"
        aria-label="New figure"
        className="w-full max-w-4xl rounded-none border-2 border-ink bg-sun-pale"
      >
        <div className={`${TITLE_BAR_INACTIVE} w-full`}>
          <span>NEW FIGURE - PICK ONE TO START FROM</span>
          <button type="button" onClick={close} aria-label="Close the figure picker" className="px-1 font-bold max-sm:min-h-11">
            [ × ]
          </button>
        </div>

        <ul className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3 lg:grid-cols-4">
          {RIG_PRESET_IDS.map((id) => {
            const on = picked === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => setPicked(id)}
                  aria-pressed={on}
                  className={`flex w-full cursor-pointer flex-col rounded-none border-2 border-ink text-left ${
                    on ? 'bg-ena text-ink-bar' : 'bg-sun-pale text-ink hover:bg-ice'
                  }`}
                >
                  <span className="block h-32 w-full border-b-2 border-ink sm:h-36" aria-hidden>
                    <PresetPreview id={id} />
                  </span>
                  <span className="px-2 pt-1 text-[14px] font-bold">
                    {RIG_PRESETS[id].label}
                    {id === current ? <span className="ml-1 text-[13px] font-normal">(ON THE BENCH)</span> : null}
                  </span>
                  <span className="min-h-[2.5rem] px-2 pb-2 text-[13px] leading-snug">{RIG_PRESETS[id].note}</span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* Stuck to the foot of the scroll box, so on a phone the START button is in reach right after tapping a card. */}
        <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t-2 border-ink bg-sun-pale p-2">
          <button
            type="button"
            disabled={picked === null}
            onClick={() => {
              if (picked === null) return;
              applyPreset(picked);
              close();
            }}
            className="cursor-pointer rounded-none border-2 border-ink bg-ena px-3 py-2 text-[14px] font-bold text-ink-bar disabled:cursor-not-allowed disabled:bg-sun-pale disabled:text-ink max-sm:min-h-11"
          >
            {picked === null ? '[ PICK A FIGURE ABOVE ]' : `[ START WITH ${RIG_PRESETS[picked].label} ]`}
          </button>
          <button
            type="button"
            onClick={close}
            className="cursor-pointer rounded-none border-2 border-ink bg-sun-pale px-3 py-2 text-[14px] font-bold text-ink hover:bg-ice max-sm:min-h-11"
          >
            [ CANCEL ]
          </button>
          <span className="text-[13px] text-ink">REPLACES THE FIGURE ON THE BENCH. UNDO BRINGS IT BACK.</span>
        </div>
      </section>
    </div>
  );
}

/** One preset, still, in a small three-quarter view. Nothing in it can be pressed: the card is the button. */
function PresetPreview({ id }: { id: RigPresetId }) {
  const figure = useMemo(() => buildDefaultFigure(id), [id]);
  const frames = useMemo(() => jointFrames(figure.skeleton), [figure]);
  const light = DEFAULT_LIGHT;
  const distance = 12;

  return (
    <Canvas frameloop="always" gl={{ antialias: false }} dpr={1} style={{ pointerEvents: 'none' }}>
      <color attach="background" args={[MODEL_VOID]} />
      <FittedPreviewCamera />
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[
          distance * Math.sin(light.azimuth) * Math.cos(light.elevation),
          distance * Math.sin(light.elevation),
          distance * Math.cos(light.azimuth) * Math.cos(light.elevation),
        ]}
        intensity={1.6}
      />
      {figure.shapes.map((shape) => {
        const placement = placementOf(figure, shape, frames);
        const q = placement.rotation;
        return (
          <mesh
            key={shape.id}
            geometry={unitGeometry(shape.kind)}
            position={[placement.position.x, placement.position.y, placement.position.z]}
            quaternion={[q.x, q.y, q.z, q.w]}
            scale={[shape.size.x, shape.size.y, shape.size.z]}
          >
            <meshLambertMaterial color={shape.colour ?? MODEL_INK} />
          </mesh>
        );
      })}
    </Canvas>
  );
}

function FittedPreviewCamera() {
  const size = useThree((state) => state.size);
  const zoom = Math.max(10, Math.min(size.height / PREVIEW_HEIGHT, size.width / PREVIEW_WIDTH));

  return (
    <OrthographicCamera
      makeDefault
      position={[10 * Math.sin(PREVIEW_TURN), PREVIEW_CENTRE_Y, 10 * Math.cos(PREVIEW_TURN)]}
      rotation={[0, PREVIEW_TURN, 0]}
      zoom={zoom}
      near={-20}
      far={40}
    />
  );
}
