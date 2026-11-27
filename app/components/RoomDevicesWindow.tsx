'use client';

import { useState } from 'react';
import type { DeviceMode } from '../lib/watch/own-device-modes';
import { FIELD, PLATE, PLATE_MAIN, PLATE_PRESSED, TITLE_BAR } from '../lib/ui/controls';
import { explain } from '../lib/ui/explain';
import PopoutWindow from './PopoutWindow';

/** One other device of yours in this room, as this device sees it. */
export type RoomDeviceRow = { deviceId: string; name: string; mode: DeviceMode | null; muted: boolean };

/**
 * The three ways another device of yours can go with this one, each its own key (Luke chose "Text keys only": font symbols,
 * nothing drawn). The wire between THIS and the other device says which way the following runs.
 */
const MODES: { mode: DeviceMode; label: string; wire: string }[] = [
  { mode: 'follows-me', label: 'FOLLOWS ME', wire: '══▶' },
  { mode: 'apart', label: 'APART', wire: '═╳═' },
  { mode: 'i-follow', label: 'I FOLLOW', wire: '◀══' },
];
const UNSET_WIRE = '◀═▶';

/** What the chosen way does, in one line, for the room as it is (your own, or someone else's). */
function modeLine(mode: DeviceMode | null, hosting: boolean, keeperHere: boolean): string {
  if (!hosting) {
    if (mode === 'follows-me') return 'IT TAKES YOUR SOUND. PLAY AND PAUSE FOLLOW THE HOST.';
    if (mode === 'i-follow') return 'YOU TAKE ITS SOUND. PLAY AND PAUSE FOLLOW THE HOST.';
    if (mode === 'apart') return 'NEITHER MOVES THE OTHER\'S SOUND. PLAY AND PAUSE FOLLOW THE HOST.';
    return 'NOTHING CHOSEN: THE SOUND FOLLOWS BOTH WAYS.';
  }
  if (mode === 'follows-me') return 'IT COPIES THIS DEVICE: PLAY, PAUSE, JUMPS AND SOUND.';
  if (mode === 'i-follow') return 'THIS DEVICE COPIES IT: PLAY, PAUSE, JUMPS AND SOUND.';
  if (mode === 'apart') return keeperHere ? 'THIS DEVICE KEEPS THE ROOM. IT PLAYS ON ITS OWN.' : 'IT KEEPS THE ROOM. THIS DEVICE PLAYS ON ITS OWN.';
  return 'NOTHING CHOSEN: THE ONE TOUCHED LAST LEADS; THE SOUND FOLLOWS BOTH WAYS.';
}

const NOTE = 'text-label text-ink';

/**
 * [ DEVICES ] (Luke, 2026-11-27; SPEC-room-devices.md): your other devices in this room, one row each, with how each goes with
 * this one and a MUTE that silences it from here. Choices are kept on both devices until changed; nothing is saved anywhere else.
 */
export default function RoomDevicesWindow({
  thisName,
  heldBy,
  rows,
  hosting,
  hostName,
  keepers,
  onMode,
  onMute,
  onRename,
  onUnholdSelf,
  onClose,
}: {
  thisName: string;
  /** This device was muted from DEVICES: by which device (null when by itself), else undefined. */
  heldBy: string | null | undefined;
  rows: RoomDeviceRow[];
  /** Your account hosts this room: the ways decide play and pause too, not only the sound. */
  hosting: boolean;
  hostName: string;
  /** For each device APART from this one, whether this device keeps the room. */
  keepers: Record<string, boolean>;
  onMode: (deviceId: string, mode: DeviceMode | null) => void;
  onMute: (deviceId: string, on: boolean) => void;
  onRename: (name: string) => void;
  onUnholdSelf: () => void;
  onClose: () => void;
}) {
  const [naming, setNaming] = useState<string | null>(null);

  return (
    <PopoutWindow title="DEVICES" onClose={onClose} status="Your own devices in this room" maxWidth="max-w-xl">
      <div className="flex flex-col gap-3" data-room-devices>
        <section aria-label="This device">
          <h3 className={TITLE_BAR}>THIS DEVICE</h3>
          {naming === null ? (
            <p className="mt-1 flex flex-wrap items-center gap-2">
              <span className="font-strong text-key text-ink" data-room-device-self>
                {thisName}
              </span>
              <button type="button" className={PLATE} onClick={() => setNaming(thisName)} {...explain('Gives this device a name of your own.', 'Your other devices show the new name in their DEVICES window.')} data-room-device-rename>
                [ RENAME ]
              </button>
            </p>
          ) : (
            <form
              className="mt-1 flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                onRename(naming);
                setNaming(null);
              }}
            >
              <label className="sr-only" htmlFor="room-device-name">
                This device&apos;s name
              </label>
              <input id="room-device-name" className={`${FIELD} w-56`} value={naming} maxLength={24} autoFocus onChange={(event) => setNaming(event.target.value)} />
              <button type="submit" className={PLATE_MAIN} {...explain('Keeps the new name for this device.', 'Left empty, it goes back to the name the browser suggests.')}>
                [ SAVE ]
              </button>
              <button type="button" className={PLATE} onClick={() => setNaming(null)} {...explain('Keeps the name as it was.')}>
                [ CANCEL ]
              </button>
            </form>
          )}
          {heldBy === undefined ? null : (
            <p className="mt-1 flex flex-wrap items-center gap-2">
              <span className="w-fit bg-bubble-pale px-1 text-label text-ink-bar" data-room-device-held>
                MUTED FROM {heldBy ?? 'THIS DEVICE'}
              </span>
              <button type="button" className={PLATE} onClick={onUnholdSelf} {...explain('Turns this device\'s sound back on.', 'It was muted from the DEVICES window; its speaker key does the same.')}>
                [ UNMUTE ]
              </button>
            </p>
          )}
        </section>

        <section aria-label="Your other devices here">
          <h3 className={TITLE_BAR}>YOUR OTHER DEVICES HERE</h3>
          {hosting ? null : <p className={`${NOTE} mt-1`}>IN {hostName.toUpperCase()}&apos;S ROOM EVERY DEVICE FOLLOWS THE HOST: THESE CHOOSE THE SOUND.</p>}
          {rows.length === 0 ? <p className={`${NOTE} mt-1`}>NONE HERE NOW.</p> : null}
          <ul>
            {rows.map((row) => {
              const lit = MODES.find((each) => each.mode === row.mode);
              return (
                <li key={row.deviceId} className="rule-pixel flex flex-col gap-1 py-2 first:pt-1" data-room-device={row.deviceId} data-room-device-mode={row.mode ?? 'unset'} data-room-device-muted={row.muted ? 'yes' : 'no'}>
                  <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-key" aria-label={`This device and ${row.name}: ${lit?.label ?? 'nothing chosen'}`}>
                    <span className="text-ink">THIS</span>
                    <span aria-hidden="true" className="whitespace-pre text-accent-ink">
                      {lit?.wire ?? UNSET_WIRE}
                    </span>
                    <span className="min-w-0 truncate font-strong text-ink">{row.name}</span>
                    {row.muted ? (
                      <span className="w-fit bg-bubble-pale px-1 text-label text-ink-bar" data-room-device-silenced>
                        ♪ OFF
                      </span>
                    ) : null}
                  </p>
                  <div className="flex flex-wrap items-center gap-1" role="group" aria-label={`How ${row.name} goes with this device`}>
                    {MODES.map((each) => {
                      const on = row.mode === each.mode;
                      return (
                        <button
                          key={each.mode}
                          type="button"
                          aria-pressed={on}
                          className={on ? PLATE_PRESSED : PLATE}
                          onClick={() => onMode(row.deviceId, on ? null : each.mode)}
                          {...explain(
                            on ? `Clears ${each.label}: back to nothing chosen.` : `Sets ${row.name} to ${each.label}.`,
                            each.mode === 'follows-me'
                              ? 'It copies this device; its own presses no longer move this one. Kept on both devices until you change it.'
                              : each.mode === 'i-follow'
                                ? 'This device copies it; this one\'s presses no longer move it. Kept on both devices until you change it.'
                                : 'Neither moves the other. In your own room, the device playing the room keeps it and the other plays on its own.',
                          )}
                          data-room-device-set={each.mode}
                        >
                          [ {each.label} ]
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      aria-pressed={row.muted}
                      className={row.muted ? PLATE_PRESSED : PLATE}
                      onClick={() => onMute(row.deviceId, !row.muted)}
                      {...explain(row.muted ? `Turns ${row.name}'s sound back on.` : `Silences ${row.name} from here.`, 'Only that device: it stays silent whatever the shared sound says, until MUTE is pressed again here or its own speaker key is.')}
                      data-room-device-mute
                    >
                      {row.muted ? '[ ♪ MUTED ]' : '[ MUTE ]'}
                    </button>
                  </div>
                  <p className={NOTE}>{modeLine(row.mode, hosting, keepers[row.deviceId] === true)}</p>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </PopoutWindow>
  );
}
