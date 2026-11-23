'use client';

import { useEffect, useState } from 'react';
import { ENGINE_NAMES, askScreenHost, useScreenHost } from '../lib/screens/host-client';
import { DIRECT_WORDS, ROUTE_WORDS } from '../lib/screens/net-route';
import { askRdpWay, switchRdp, useRdpWay } from '../lib/screens/rdp-client';
import { relayStatus, saveRelayKey } from '../lib/screens/relay-client';
import { chooseRemoteSource,startDeviceBeacon, useOtherDevices, useRemoteSource, type RemoteSource } from '../lib/screens/devices';
import { PLATE_ON_BLACK, PLATE_ON_BLACK_PRESSED } from '../lib/ui/controls';
import { chooseScreen, useScreenView } from '../lib/watch/canvas-view';
import { subscribeToRemoteAsk, takeRemoteAsk } from '../lib/watch/main-room-play';
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
/**
 * The relay for anywhere (2026-11-22: a phone on mobile data got stuck connecting): whether Cloudflare's TURN relay
 * key is set on the PC that serves the site, and a form to set it. The key id and token are typed here by Luke once,
 * tried with Cloudflare, kept only in that PC's file, and never shown again.
 */
function RelayKey() {
  const [status, setStatus] = useState<{ set: boolean; ready: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const [keyId, setKeyId] = useState('');
  const [token, setToken] = useState('');
  const [saying, setSaying] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void relayStatus().then(setStatus);
  }, []);
  if (status === null) return null;
  const field = 'w-56 max-w-full border border-ink-bar bg-ink-plate px-1 font-mono text-label text-ink-bar';
  return (
    <span className="flex flex-col items-stretch gap-1 border-t border-ink-bar pt-1 font-mono text-label text-ink-bar" data-remote-relay={status.set ? 'on' : 'off'}>
      <button
        type="button"
        className={`${status.set ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK} text-left`}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        title="Cloudflare's relay carries the picture when two devices cannot reach each other directly, such as a phone on mobile data"
        data-remote-relay-key
      >
        {status.set ? '[ RELAY FOR MOBILE DATA: ON (CLOUDFLARE) ]' : '[ RELAY FOR MOBILE DATA: SET UP ]'}
      </button>
      {open ? (
        <form
          className="flex flex-col items-end gap-1"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            void saveRelayKey(keyId.trim(), token.trim()).then((trouble) => {
              setBusy(false);
              setToken('');
              if (trouble) setSaying(trouble);
              else {
                setSaying('SAVED ON THE SERVER: THE RELAY IS ON');
                setKeyId('');
                setStatus({ set: true, ready: true });
              }
            });
          }}
          data-remote-relay-form
        >
          <span>RELAY KEY :: FROM CLOUDFLARE (REALTIME, TURN), KEPT ON THE SERVER, NEVER SHOWN AGAIN</span>
          <label className="flex items-center gap-1">
            <span>KEY ID</span>
            <input className={field} value={keyId} onChange={(e) => setKeyId(e.target.value)} spellCheck={false} placeholder="32 letters and digits" data-remote-relay-id />
          </label>
          <label className="flex items-center gap-1">
            <span>API TOKEN</span>
            <input className={field} type="password" autoComplete="new-password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="the long token Cloudflare shows once" data-remote-relay-token />
          </label>
          <span className="flex items-center gap-1">
            {saying ? <span role="status">{saying}</span> : null}
            <button type="submit" className={PLATE_ON_BLACK} disabled={busy || !status.ready} title={status.ready ? undefined : 'The PC that serves the site has no place set for the key yet'} data-remote-relay-save>
              [ SAVE ON THE SERVER ]
            </button>
          </span>
        </form>
      ) : null}
    </span>
  );
}

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
  const host = useScreenHost('pc');
  const serverEngine = useScreenHost('server');
  const devices = useOtherDevices();
  const source = useRemoteSource();
  const onScreen = useScreenView(roomId, audio) === 'screen';
  const rdp = useRdpWay();
  const [choosing, setChoosing] = useState(false);
  useEffect(() => askScreenHost(), []);
  useEffect(() => askRdpWay(), []);
  useEffect(() => startDeviceBeacon(), []);

  // REMOTE pressed on the shelf (main-room-play.ts): the list opens here, as soon as something answers.
  useEffect(() => {
    const check = () => {
      if (takeRemoteAsk(roomId)) setChoosing(true);
    };
    check();
    return subscribeToRemoteAsk(check);
  }, [roomId]);

  const [switchTrouble, setSwitchTrouble] = useState('');
  const [switching, setSwitching] = useState(false);

  // Each choice says which way it goes (Luke, 2026-11-21: "make sure its clear when something is done over lan vs port
  // forwarding"). Our engine and other devices are reached on the home network only for now; the server's Remote
  // Desktop goes through the Cloudflare tunnel. The room's view then reads the real route from the connection.
  const homeOnly = DIRECT_WORDS;
  const rdpRoute = ROUTE_WORDS[rdp.route === 'direct' ? 'this-pc' : 'tunnel'];
  const choices: { label: string; tip: string; source: RemoteSource }[] = [
    ...(host.available
      ? [{ label: `THE PC :: OUR ENGINE, WATCH AND CONTROL :: ${homeOnly.label}`, tip: homeOnly.tip, source: { kind: 'engine', engine: 'pc' } as RemoteSource }]
      : []),
    // SERVER's own engine (Media Foundation, Intel's encoder), the low-latency way to the server (2026-11-22).
    ...(serverEngine.available
      ? [{ label: `THE SERVER :: OUR ENGINE, WATCH AND CONTROL :: ${homeOnly.label}`, tip: `${homeOnly.tip} Our engine on the server: much lower delay than Remote Desktop.`, source: { kind: 'engine', engine: 'server' } as RemoteSource }]
      : []),
    // A separate thing from our own engine, with its own switch (Luke: "make sure it is a toggle since it is a separate
    // thing to our tech"), and plainly the slower way in.
    ...(rdp.available && rdp.on
      ? [{ label: `THE SERVER :: WINDOWS REMOTE DESKTOP THROUGH GUACAMOLE, NOT OUR ENGINE (SLOWER) :: ${rdpRoute.label}`, tip: rdpRoute.tip, source: { kind: 'rdp' } as RemoteSource }]
      : []),
    ...devices.others.map((d) => ({ label: `${d.name} :: WATCH ONLY :: ${homeOnly.label}`, tip: homeOnly.tip, source: { kind: 'device', id: d.id, name: d.name } as RemoteSource })),
  ];
  // The server remote's switch is in the list whenever its gateway answers, so it can be switched on from here.
  const switchShown = rdp.available;
  if (choices.length === 0 && !switchShown && !onScreen) return null;

  const flipServer = async () => {
    setSwitching(true);
    setSwitchTrouble((await switchRdp(!rdp.on)) ?? '');
    setSwitching(false);
  };

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
    // Always the list, even with one device on (Luke, 2026-11-21: "I also want the device selection option to always
    // show even if it's just one device on").
    setChoosing((open) => !open);
  };
  const named = (s: RemoteSource) => (s.kind === 'engine' ? ENGINE_NAMES[s.engine] : s.kind === 'rdp' ? 'THE SERVER' : s.name);
  const keyOf = (s: RemoteSource) => (s.kind === 'device' ? s.id : s.kind === 'engine' && s.engine === 'server' ? 'engine-server' : s.kind);

  return (
    <span className="relative inline-block">
      <button
        type="button"
        className={`${onScreen || choosing ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK} ${className ?? ''}`}
        aria-pressed={onScreen}
        aria-expanded={choosing}
        aria-label={onScreen ? `Back to the room's picture (showing ${named(source)})` : 'Remote: show one of your devices'}
        title={onScreen ? 'Picture' : 'Remote'}
        onClick={onPress}
        data-screen-toggle={onScreen ? 'on' : 'off'}
      >
        [ REMOTE ]
      </button>
      {choosing && !onScreen ? (
        <span className="absolute right-0 top-full z-40 mt-1 flex w-max max-w-96 flex-col items-stretch gap-1 border border-ink-bar bg-ink-plate p-1" role="menu" data-remote-choices>
          {choices.map((choice) => (
            <button
              key={keyOf(choice.source)}
              type="button"
              role="menuitem"
              // Wrapped: in a small room one long line ran off the picture's left edge, the machine's name with it (2026-11-23).
              className={`${PLATE_ON_BLACK} h-auto text-left whitespace-normal`}
              onClick={() => show(choice.source)}
              title={choice.tip}
              data-remote-choice={keyOf(choice.source)}
            >
              {`[ ${choice.label} ]`}
            </button>
          ))}
          {switchShown ? (
            <span className="flex flex-wrap items-center gap-1 border-t border-ink-bar pt-1 font-mono text-label text-ink-bar">
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={rdp.on}
                disabled={switching}
                className={`${rdp.on ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK} text-left`}
                onClick={() => void flipServer()}
                title="The server remote is Windows Remote Desktop through Apache Guacamole on the PC: a separate thing from our own engine, with its own switch. Off, nothing reaches the server this way."
                data-remote-server-switch={rdp.on ? 'on' : 'off'}
              >
                {`[ SERVER REMOTE (WINDOWS REMOTE DESKTOP THROUGH GUACAMOLE): ${rdp.on ? 'ON' : 'OFF'} ]`}
              </button>
              {switchTrouble ? <span role="status">{switchTrouble}</span> : null}
            </span>
          ) : null}
          {/* How another device joins the list (nothing to install, the site open on it, signed in). Last and short, so a small room keeps the switch above in sight. */}
          <span className="max-w-full font-mono text-label text-ink-bar" data-remote-add-device>
            {devices.others.length === 0 ? 'ADD A DEVICE: OPEN DEBASER.SITE ON IT, SIGNED IN.' : 'MORE: OPEN DEBASER.SITE ON EACH, SIGNED IN.'}
          </span>
          <RelayKey />
        </span>
      ) : null}
    </span>
  );
}
