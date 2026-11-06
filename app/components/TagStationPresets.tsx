'use client';

import { useCallback, useEffect, useState } from 'react';
import { cleanPresetName, getPresetStore, MAX_PRESET_NAME, MAX_PRESETS, presetSettings, withPreset, type Preset } from '../lib/tag-station/presets';
import type { Recipe } from '../lib/tag-station/recipe';
import { FIELD_TIGHT } from '../lib/ui/controls';
import { STATION_KEY, STATION_KEY_ON } from './TagStationParts';

/**
 * `[ PRESETS ]` (SPEC-discover.md): the page's filters are how your algorithm is applied, saved under a name, with one active, which MEDIA's DISCOVER
 * filter reads. Save, pick, rename, delete. Deleting takes two presses. Saved to the account, so they follow you between devices.
 */
export default function TagStationPresets({ recipe, onPick }: { recipe: Recipe; onPick: (next: Recipe) => void }) {
  const [open, setOpen] = useState(false);
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [fault, setFault] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setPresets(await getPresetStore().list());
  }, []);

  useEffect(() => {
    if (!open || presets !== null) return;
    void getPresetStore()
      .list()
      .then(setPresets)
      .catch((problem: unknown) => setFault(problem instanceof Error ? problem.message : 'Your presets could not be read.'));
  }, [open, presets]);

  const attempt = async (work: () => Promise<void>) => {
    setFault(null);
    try {
      await work();
      await refresh();
    } catch (problem) {
      setFault(problem instanceof Error ? problem.message : 'That could not be saved. Try again.');
    }
  };

  const save = () => {
    const clean = cleanPresetName(name);
    if (clean === null) return;
    void attempt(async () => {
      await getPresetStore().add(clean, presetSettings(recipe));
      setName('');
    });
  };

  return (
    <div className="flex flex-col gap-1" data-presets>
      <div>
        <button type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)} className={open ? STATION_KEY_ON : STATION_KEY}>
          {open ? 'PRESETS' : '[ PRESETS ]'}
        </button>
      </div>
      {open ? (
        <div className="flex flex-col gap-1">
          {fault !== null ? <p className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">{fault}</p> : null}
          {presets === null && fault === null ? <p className="text-label text-ink">LOADING...</p> : null}
          {presets !== null && presets.length === 0 ? <p className="text-label text-ink">NONE SAVED.</p> : null}
          <ul aria-label="Saved presets" className="flex flex-col gap-1">
            {(presets ?? []).map((preset) => (
              <li key={preset.id} className="flex flex-wrap items-center gap-1">
                {renaming?.id === preset.id ? (
                  <>
                    <label className="inline-flex items-center gap-1 text-label font-bold text-ink-quiet">
                      NEW NAME
                      <input type="text" value={renaming.name} maxLength={MAX_PRESET_NAME} onChange={(event) => setRenaming({ id: preset.id, name: event.target.value })} className={`${FIELD_TIGHT} min-h-tap`} />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const clean = cleanPresetName(renaming.name);
                        if (clean === null) return;
                        void attempt(async () => {
                          await getPresetStore().rename(preset.id, clean);
                          setRenaming(null);
                        });
                      }}
                      className={STATION_KEY}
                    >
                      [ SAVE NAME ]
                    </button>
                    <button type="button" onClick={() => setRenaming(null)} className={STATION_KEY}>
                      [ KEEP IT ]
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      aria-pressed={preset.active}
                      aria-label={preset.active ? `${preset.name}, the active preset. Press to stop using it.` : `Use ${preset.name}`}
                      onClick={() =>
                        void attempt(async () => {
                          await getPresetStore().activate(preset.active ? null : preset.id);
                          if (!preset.active) onPick(withPreset(recipe, preset.settings));
                        })
                      }
                      className={preset.active ? STATION_KEY_ON : STATION_KEY}
                    >
                      {preset.active ? `${preset.name} · ON` : `[ ${preset.name} ]`}
                    </button>
                    <button type="button" aria-label={`Rename ${preset.name}`} onClick={() => setRenaming({ id: preset.id, name: preset.name })} className={STATION_KEY}>
                      [ RENAME ]
                    </button>
                    {deleting === preset.id ? (
                      <button
                        type="button"
                        aria-label={`Really delete ${preset.name}`}
                        onClick={() =>
                          void attempt(async () => {
                            await getPresetStore().remove(preset.id);
                            setDeleting(null);
                          })
                        }
                        onBlur={() => setDeleting(null)}
                        className={STATION_KEY_ON}
                      >
                        REALLY DELETE?
                      </button>
                    ) : (
                      <button type="button" aria-label={`Delete ${preset.name}`} onClick={() => setDeleting(preset.id)} className={STATION_KEY}>
                        [ DELETE ]
                      </button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
          {presets !== null && presets.length < MAX_PRESETS ? (
            <form
              className="flex flex-wrap items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                save();
              }}
            >
              <label className="flex min-w-0 flex-1 basis-48 items-center gap-1 text-label font-bold text-ink-quiet">
                SAVE THESE AS
                <input type="text" value={name} maxLength={MAX_PRESET_NAME} onChange={(event) => setName(event.target.value)} className={`${FIELD_TIGHT} min-h-tap min-w-0 flex-1`} />
              </label>
              <button type="submit" disabled={cleanPresetName(name) === null} className={STATION_KEY}>
                [ SAVE ]
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
