'use client';

import { useEffect, useState } from 'react';
import { askScreenHost, useScreenHost } from '../lib/screens/host-client';
import { chooseRemoteSource, startDeviceBeacon, useOtherDevices, useRemoteSource, type RemoteSource } from '../lib/screens/devices';
import { PLATE_ON_BLACK, PLATE_ON_BLACK_PRESSED } from '../lib/ui/controls';
import { chooseScreen, useScreenView } from '../lib/watch/canvas-view';
import { setVisualiserOn } from '../lib/watch/visualiser';

/**
 * The `[ REMOTE ]` key (SPEC-screens.md, phase 3; it read `[ SCREEN ]` until Luke renamed it, 2026-11-21), beside
 * the visualiser and canvas keys in a room's screen corner:
 * this viewer's own screen switched to their PC's screen and back. Words only: no mark, no art slot.
 *
 * Only the owner ever sees it, in any room they are in: when the PC's screen engine answers, or when another of the
 * owner's devices has the site open (Luke, 2026-11-21: "a selection option of which signed in device to stream from
 * when you click remote"). With more than one to choose from, pressing it lists them: THE PC (through its engine:
 * watch and control) and each other device (watch only; somebody there presses SHARE). Like VIS and CANVAS it is
 * each viewer's own choice: nothing is synced, and the room's queue and players carry on untouched underneath.
 */
export default function ScreenToggle({
  roomId,
  audio,
  className,
}: {
  roomId: string;
  /** As the canvas key's: what kind of thing plays, which the room's own screen choice is kept by. */
  audio: boolean;
  className?: string;
}) {
  const host = useScreenHost();
  const devices = useOtherDevices();
  const source = useRemoteSource();
  const onScreen = useScreenView(roomId, audio) === 'screen';
  const [choosing, setChoosing] = useState(false);
  useEffect(() => askScreenHost(), []);
  useEffect(() => startDeviceBeacon(), []);

  const choices: { label: string; source: RemoteSource }[] = [
    ...(host.available ? [{ label: 'THE PC :: WATCH AND CONTROL', source: { kind: 'engine' } as RemoteSource }] : []),
    ...devices.others.map((d) => ({ label: `${d.name} :: WATCH ONLY`, source: { kind: 'device', id: d.id, name: d.name } as RemoteSource })),
  ];
  if (choices.length === 0 && !onScreen) return null;

  const show = (next: RemoteSource) => {
    setChoosing(false);
    chooseRemoteSource(next);
    // The visualiser would lie over the PC's screen, so choosing the screen puts it away (as the canvas key does).
    setVisualiserOn(roomId, false);
    chooseScreen(roomId, 'screen', audio);
  };
  const onPress = () => {
    if (onScreen) {
      setChoosing(false);
      chooseScreen(roomId, 'picture', audio);
      return;
    }
    if (choices.length === 1) show(choices[0].source);
    else setChoosing((open) => !open);
  };
  const named = (s: RemoteSource) => (s.kind === 'engine' ? 'THE PC' : s.name);

  return (
    <span className="relative inline-block">
      <button
        type="button"
        className={`${onScreen || choosing ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK} ${className ?? ''}`}
        aria-pressed={onScreen}
        aria-expanded={choices.length > 1 ? choosing : undefined}
        aria-label={onScreen ? `Back to the room's picture (showing ${named(source)})` : 'Remote: show one of your devices'}
        title={onScreen ? 'Picture' : 'Remote'}
        onClick={onPress}
        data-screen-toggle={onScreen ? 'on' : 'off'}
      >
        [ REMOTE ]
      </button>
      {choosing && !onScreen ? (
        <span className="absolute right-0 top-full z-40 mt-1 flex w-max max-w-[80vw] flex-col items-stretch gap-1 border border-ink-bar bg-ink-plate p-1" role="menu" data-remote-choices>
          {choices.map((choice) => (
            <button
              key={choice.source.kind === 'engine' ? 'engine' : choice.source.id}
              type="button"
              role="menuitem"
              className={`${PLATE_ON_BLACK} text-left`}
              onClick={() => show(choice.source)}
              data-remote-choice={choice.source.kind === 'engine' ? 'engine' : choice.source.id}
            >
              {`[ ${choice.label} ]`}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}
