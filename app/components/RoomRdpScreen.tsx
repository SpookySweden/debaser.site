'use client';

import { useEffect, useRef, useState } from 'react';
import { GUAC_STATE, KEYSYM_ESCAPE, loadGuacamole, type GuacClient } from '../lib/screens/guacamole';
import { keysymOf } from '../lib/screens/keysyms';
import { chooseRemoteSource } from '../lib/screens/devices';
import { useScreenHost } from '../lib/screens/host-client';
import { leaveKeys, takeKeys, type KeyTaker } from '../lib/screens/key-gate';
import { ROUTE_WORDS, type NetRoute } from '../lib/screens/net-route';
import { askRdpPass, doorIsOpen, readRdpWayNow, saveServerSignIn, switchRdp } from '../lib/screens/rdp-client';
import { PLATE_ON_BLACK, PLATE_ON_BLACK_PRESSED } from '../lib/ui/controls';
import { explain } from '../lib/ui/explain';

/** Holding Esc this long lets go of the server, as with the PC's engine (control.ts, LET_GO_HOLD_MS). */
const LET_GO_HOLD_MS = 1000;
/** A resize is told to the server once the room has stopped changing size. */
const RESIZE_SETTLE_MS = 300;
/** Where this browser remembers the FIT THE SERVER TO THIS VIEW switch. */
const FIT_KEY = 'debaser.screens.rdp.fit.v1';

type State = 'starting' | 'off' | 'setup' | 'locked' | 'connecting' | 'showing' | 'ended';

/**
 * The server's sign-in (Luke, 2026-11-21: he could not edit the settings file himself, and Claude never types his
 * passwords). Typed here once, sent to the site, passed to the PC's rdp.env, and never kept or shown again: the
 * fields start empty every time, and an empty field leaves that line as it was.
 */
function ServerSignIn({ onSaved, onClose }: { onSaved: () => void; onClose: (() => void) | null }) {
  const [host, setHost] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [saying, setSaying] = useState('');
  const [busy, setBusy] = useState(false);
  const field = 'w-56 max-w-full border border-ink-bar bg-ink-plate px-1 font-mono text-label text-ink-bar';
  return (
    <form
      className="flex max-w-full flex-col items-end gap-1 bg-ink-plate p-1 font-mono"
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void saveServerSignIn({ host: host.trim(), user: user.trim(), password }).then((trouble) => {
          setBusy(false);
          setPassword('');
          if (trouble) setSaying(trouble);
          else {
            setSaying('SAVED ON THE PC');
            onSaved();
          }
        });
      }}
      data-room-rdp-signin
    >
      <span>SERVER SIGN-IN :: SAVED IN rdp.env ON THE PC, NEVER SHOWN AGAIN</span>
      <label className="flex items-center gap-1">
        <span>ADDRESS</span>
        <input className={field} value={host} onChange={(e) => setHost(e.target.value)} placeholder="its name or 192.168.0.x" spellCheck={false} data-room-rdp-signin-host />
      </label>
      <label className="flex items-center gap-1">
        <span>USER</span>
        <input className={field} value={user} onChange={(e) => setUser(e.target.value)} placeholder="leave empty to keep" spellCheck={false} data-room-rdp-signin-user />
      </label>
      <label className="flex items-center gap-1">
        <span>PASSWORD</span>
        <input className={field} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="the account's password, not a PIN" data-room-rdp-signin-password />
      </label>
      <span className="flex items-center gap-1">
        {saying ? <span role="status">{saying}</span> : null}
        {onClose ? (
          <button type="button" className={PLATE_ON_BLACK} onClick={onClose} {...explain('Closes the server sign-in form without saving anything.', 'What you typed is dropped; the sign-in already on the PC stays as it was.')}>
            [ CLOSE ]
          </button>
        ) : null}
        <button type="submit" className={PLATE_ON_BLACK} disabled={busy} data-room-rdp-signin-save {...explain('Sends the server\'s address and Windows sign-in to the PC, which keeps them in its rdp.env file, then connects again.', 'So the PC can open the server by Remote Desktop. An empty field leaves that line as it was; the password is never kept here or shown again.')}>
          [ SAVE ON THE PC ]
        </button>
      </span>
    </form>
  );
}

/** Guacamole's status numbers, in words. */
function troubleWords(code: number, message: string | undefined): string {
  const said = (message ?? '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 200);
  if (code === 769 || code === 771) return 'THE SERVER REFUSED THE WINDOWS SIGN-IN IN rdp.env ON THE PC';
  if (code === 519 || code === 514 || code === 520) return `THE SERVER COULD NOT BE REACHED${said ? `: ${said}` : ''}`;
  return said || 'THE REMOTE DESKTOP CONNECTION ENDED';
}

/**
 * REMOTE showing the server through Windows Remote Desktop (SPEC-screens.md, "The server: Remote Desktop"; Luke
 * 2026-11-21: no spare keyboard and mouse for the server, "I need to control it now with this feature seamlessly").
 *
 * Nothing is asked on the server and nothing is installed there: the PC's guacd speaks Remote Desktop to it, and
 * Guacamole's browser client draws it here. Control is on from the start: the mouse and keys go to the server; hold
 * Esc for a second, or press RELEASE, to let go, and click the picture to take it back. The server's desktop starts at
 * the size of this device's own screen, drawn whole (never cropped or stretched); FIT THE SERVER TO THIS VIEW, a
 * separate switch, makes it the view's size and has it follow the view.
 *
 * It is plainly marked as the slower way in: the way-in switch reads REMOTE DESKTOP, beside OUR ENGINE, which is not
 * on the server yet (it needs the engine's AMD/Intel encoder path).
 */
export default function RoomRdpScreen() {
  const box = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const serverEngine = useScreenHost('server');
  const [state, setState] = useState<State>('starting');
  const [why, setWhy] = useState('');
  const [tries, setTries] = useState(0);
  const [engaged, setEngaged] = useState(true);
  const [escHolding, setEscHolding] = useState(false);
  const engagedRef = useRef(true);
  const clientRef = useRef<GuacClient | null>(null);
  const held = useRef(new Map<string, number>());
  const [route, setRoute] = useState<NetRoute | null>(null);
  const [door, setDoor] = useState<string | null>(null);
  const [switchWhy, setSwitchWhy] = useState('');
  const [signInOpen, setSignInOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  // Off, the switch to turn it on must be in sight; not named yet, the form is.
  const optionsShown = optionsOpen || state === 'off' || state === 'setup';
  const [fitView, setFitView] = useState(false);

  const again = () => {
    setWhy('');
    setState('starting');
    setTries((n) => n + 1);
  };

  // The unlocking window says when it is done; the view then connects.
  useEffect(() => {
    const heard = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.data === 'debaser-rdp-unlocked') again();
    };
    window.addEventListener('message', heard);
    return () => window.removeEventListener('message', heard);
  }, []);

  const unlock = () => {
    if (door === null) return;
    window.open(door, 'debaser-rdp-unlock', 'popup,width=520,height=680');
  };

  const flipRemote = async (on: boolean) => {
    const trouble = await switchRdp(on);
    setSwitchWhy(trouble ?? '');
    if (trouble === null) {
      if (on) again();
      else {
        clientRef.current?.disconnect();
        setWhy('THE SERVER REMOTE IS SWITCHED OFF');
        setState('off');
      }
    }
  };
  const fitViewRef = useRef(false);
  const resizeServer = useRef<() => void>(() => undefined);

  // The FIT switch is remembered in this browser only.
  useEffect(() => {
    let kept = false;
    try {
      kept = window.localStorage.getItem(FIT_KEY) === '1';
    } catch {
      /* no storage */
    }
    if (!kept) return;
    fitViewRef.current = true;
    resizeServer.current();
    // Read once from this browser's storage after the first draw (the server and a first visit both start with it off).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFitView(true);
  }, []);

  const toggleFit = () => {
    const next = !fitViewRef.current;
    fitViewRef.current = next;
    setFitView(next);
    try {
      window.localStorage.setItem(FIT_KEY, next ? '1' : '0');
    } catch {
      /* no storage */
    }
    resizeServer.current();
  };

  /** Lets go of every key the server thinks is down. */
  const letGoOfKeys = () => {
    const client = clientRef.current;
    for (const keysym of held.current.values()) client?.sendKeyEvent(0, keysym);
    held.current.clear();
  };

  const engage = (on: boolean) => {
    engagedRef.current = on;
    setEngaged(on);
    if (!on) letGoOfKeys();
    if (on) box.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    let over = false;
    let client: GuacClient | null = null;
    let settle: ReturnType<typeof setTimeout> | null = null;
    let escTimer: ReturnType<typeof setTimeout> | null = null;
    const area = box.current;
    const place = holder.current;
    if (area === null || place === null) return;
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    // Normally the server's desktop is the size of this device's own screen, drawn whole in the view; with FIT on it
    // is the size of the view itself (Luke, for the PC: "render normally to start with, not cropped either, and have
    // the display resolution fit be a separate switch").
    const sizeNow = () => {
      const fitted = fitViewRef.current;
      return {
        width: Math.max(320, Math.round((fitted ? area.clientWidth : window.screen.width) * dpr)),
        height: Math.max(240, Math.round((fitted ? area.clientHeight : window.screen.height) * dpr)),
        dpi: Math.round(96 * dpr),
      };
    };
    resizeServer.current = () => {
      const size = sizeNow();
      client?.sendSize(size.width, size.height);
    };
    const fit = () => {
      if (client === null) return;
      const display = client.getDisplay();
      const w = display.getWidth();
      const h = display.getHeight();
      if (w > 0 && h > 0) display.scale(Math.min(area.clientWidth / w, area.clientHeight / h));
    };

    // The keys: the site's first listener (key-gate.ts), so an Esc meant for the server never closes a window here.
    const taker: KeyTaker = (event, down) => {
      if (!engagedRef.current || client === null) return;
      // Typing somewhere else on the page (the room's chat, a search) stays on the page.
      const focused = document.activeElement;
      if (focused !== null && focused !== document.body && !area.contains(focused)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        if (down && !event.repeat && escTimer === null) {
          setEscHolding(true);
          escTimer = setTimeout(() => {
            escTimer = null;
            setEscHolding(false);
            engage(false);
          }, LET_GO_HOLD_MS);
        } else if (!down && escTimer !== null) {
          // A short press is the server's Esc.
          clearTimeout(escTimer);
          escTimer = null;
          setEscHolding(false);
          client.sendKeyEvent(1, KEYSYM_ESCAPE);
          client.sendKeyEvent(0, KEYSYM_ESCAPE);
        }
        return;
      }
      const code = event.code || event.key;
      if (down) {
        const keysym = held.current.get(code) ?? keysymOf(event);
        if (keysym === null) return;
        held.current.set(code, keysym);
        client.sendKeyEvent(1, keysym);
      } else {
        const keysym = held.current.get(code);
        if (keysym === undefined) return;
        held.current.delete(code);
        client.sendKeyEvent(0, keysym);
      }
    };
    takeKeys(taker);
    const onBlur = () => letGoOfKeys();
    window.addEventListener('blur', onBlur);

    const watcher = new ResizeObserver(() => {
      fit();
      // Only a fitted server follows the view; otherwise its desktop stays the size of this screen, drawn smaller.
      if (!fitViewRef.current) return;
      if (settle !== null) clearTimeout(settle);
      settle = setTimeout(() => resizeServer.current(), RESIZE_SETTLE_MS);
    });
    watcher.observe(area);

    void (async () => {
      // Switched on? Which way does it go? Over the internet, the extra lock (Cloudflare Access) must let us in first.
      const now = await readRdpWayNow();
      if (over) return;
      setRoute(now.route === 'direct' ? 'this-pc' : 'tunnel');
      setDoor(now.door);
      if (!now.available) {
        setWhy("THE PC'S REMOTE DESKTOP GATEWAY IS NOT ANSWERING");
        setState('ended');
        return;
      }
      if (!now.on) {
        setWhy('THE SERVER REMOTE IS SWITCHED OFF');
        setState('off');
        return;
      }
      // No server named yet: the SERVER SIGN-IN form, before anything else.
      if (!now.serverSet) {
        setState('setup');
        return;
      }
      if (now.route === 'tunnel') {
        if (!now.locked) {
          setWhy('THE EXTRA LOCK (CLOUDFLARE ACCESS) IS NOT SET UP YET, SO THE SERVER IS NOT OPENED OVER THE INTERNET');
          setState('ended');
          return;
        }
        if (now.door !== null && !(await doorIsOpen(now.door))) {
          if (!over) setState('locked');
          return;
        }
      }
      const [Guac, got] = await Promise.all([loadGuacamole(), askRdpPass(sizeNow())]);
      if (over) return;
      if ('why' in got) {
        setWhy(got.why);
        setState('ended');
        return;
      }
      setState('connecting');
      const tunnel = new Guac.WebSocketTunnel(got.socket);
      client = new Guac.Client(tunnel);
      clientRef.current = client;
      const display = client.getDisplay();
      const element = display.getElement();
      place.replaceChildren(element);
      display.onresize = () => fit();
      const mouse = new Guac.Mouse(element);
      mouse.onEach(['mousedown', 'mouseup', 'mousemove'], (event) => {
        if (client === null) return;
        if (!engagedRef.current) {
          if (event.state.left || event.state.right || event.state.middle) engage(true);
          else return;
        }
        client.sendMouseState(event.state, true);
      });
      const ended = (words: string) => {
        if (over) return;
        setWhy(words);
        setState('ended');
      };
      tunnel.onerror = (status) => ended(troubleWords(status.code, status.message));
      client.onerror = (status) => ended(troubleWords(status.code, status.message));
      client.onstatechange = (next) => {
        if (next === GUAC_STATE.CONNECTED) {
          setState('showing');
          fit();
          area.focus({ preventScroll: true });
        } else if (next === GUAC_STATE.DISCONNECTED) {
          setState((was) => {
            if (was !== 'ended') setWhy((w) => w || 'THE REMOTE DESKTOP CONNECTION ENDED');
            return 'ended';
          });
        }
      };
      client.connect(`pass=${encodeURIComponent(got.pass)}`);
    })();

    return () => {
      over = true;
      leaveKeys(taker);
      window.removeEventListener('blur', onBlur);
      watcher.disconnect();
      if (settle !== null) clearTimeout(settle);
      if (escTimer !== null) clearTimeout(escTimer);
      letGoOfKeys();
      client?.disconnect();
      clientRef.current = null;
      place.replaceChildren();
    };
    // `engage` only touches refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tries]);

  const says =
    state === 'starting'
      ? 'ASKING THE PC FOR THE WAY IN'
      : state === 'setup'
        ? 'THE SERVER IS NOT NAMED YET: ITS ADDRESS AND WINDOWS SIGN-IN GO IN THE FORM ABOVE'
        : state === 'locked'
        ? 'LOCKED: THE EXTRA LOCK (CLOUDFLARE ACCESS) WANTS A ONE-TIME CODE SENT TO YOUR EMAIL'
        : state === 'connecting'
          ? 'CONNECTING TO THE SERVER BY WINDOWS REMOTE DESKTOP'
          : state === 'showing'
            ? 'THE SERVER :: WINDOWS REMOTE DESKTOP THROUGH GUACAMOLE, NOT OUR ENGINE (SLOWER)'
            : why || 'ENDED';
  const routeWords = route ? ROUTE_WORDS[route] : null;

  return (
    <div className="absolute inset-0 z-10 bg-ink-plate text-label text-ink-bar" data-room-screen data-room-rdp-screen={state}>
      <div
        ref={box}
        tabIndex={0}
        aria-label="The server's screen, by Remote Desktop"
        className={`absolute inset-0 flex items-center justify-center overflow-hidden outline-none ${engaged && state === 'showing' ? 'cursor-none' : ''}`}
      >
        <div ref={holder} data-room-rdp-display />
      </div>
      {/* Kept short, so a small room's picture stays clickable: the way in always in sight, the rest behind OPTIONS,
          which opens by itself when the remote is off or the server is not named yet. */}
      <div className="absolute right-1 top-8 z-30 flex flex-col items-end gap-1 max-sm:top-14">
        <div className="flex max-w-full flex-wrap items-center justify-end gap-1 bg-ink-plate px-1 font-mono">
          <span>WAY IN</span>
          <button
            type="button"
            className={PLATE_ON_BLACK_PRESSED}
            aria-pressed="true"
            title="Windows' own Remote Desktop, turned into a picture by Apache Guacamole on the PC: a separate thing from our engine, and slower"
            data-room-rdp-way="rdp"
            {...explain('The way in you are using now: Windows\' own Remote Desktop, through Guacamole on the PC. Pressing it does nothing.', 'The slower way in, kept for when our engine is not running on the server.')}
          >
            [ WINDOWS REMOTE DESKTOP (GUACAMOLE) ]
          </button>
          <button
            type="button"
            className={PLATE_ON_BLACK}
            aria-pressed="false"
            disabled={!serverEngine.available}
            onClick={() => chooseRemoteSource({ kind: 'engine', engine: 'server' })}
            title={serverEngine.available ? 'Our own engine on the server: much lower delay than Remote Desktop' : "Our engine isn't running on the server right now"}
            data-room-rdp-way="engine"
            {...explain(serverEngine.available ? 'Switches this screen to the site\'s own engine on the server.' : 'Our engine is not running on the server right now, so this key is off.', 'Our engine has much lower delay than Remote Desktop.')}
          >
            {serverEngine.available ? '[ OUR ENGINE ]' : '[ OUR ENGINE: NOT RUNNING ON THE SERVER ]'}
          </button>
          <button type="button" className={optionsShown ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK} aria-expanded={optionsShown} onClick={() => setOptionsOpen((open) => !open)} data-room-rdp-options {...explain(optionsShown ? 'Hides the remote\'s options.' : 'Shows the remote\'s options: its on and off switch, fitting the server to this view, and the server sign-in.', 'Kept out of the way so a small room picture stays clickable. It opens by itself when the remote is off or the server is not named yet.')}>
            [ OPTIONS ]
          </button>
        </div>
        {optionsShown ? (
          <div className="flex max-w-full flex-wrap items-center justify-end gap-1 bg-ink-plate px-1 font-mono" data-room-rdp-options-panel>
            <button
              type="button"
              className={state === 'off' ? PLATE_ON_BLACK : PLATE_ON_BLACK_PRESSED}
              aria-pressed={state !== 'off'}
              onClick={() => void flipRemote(state === 'off')}
              title="The server remote's own switch, on the PC: off, nothing reaches the server this way"
              data-room-rdp-switch={state === 'off' ? 'off' : 'on'}
            {...explain(state === 'off' ? 'Switches the server remote on at the PC, then connects.' : 'Switches the server remote off at the PC and disconnects.', 'It is the PC\'s own switch: while it is off, nothing reaches the server this way.')}
            >
              {state === 'off' ? '[ SERVER REMOTE: OFF ]' : '[ SERVER REMOTE: ON ]'}
            </button>
            {state === 'showing' ? (
              <button
                type="button"
                className={fitView ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK}
                aria-pressed={fitView}
                onClick={toggleFit}
                title={fitView ? "The server's desktop follows this view's size" : "The server's desktop is this screen's size, drawn whole"}
                data-room-rdp-fit={fitView ? 'on' : 'off'}
            {...explain(fitView ? 'Stops fitting: the server\'s desktop goes back to this device\'s screen size, drawn whole.' : 'Makes the server\'s desktop the size of this view, and has it follow the view as it changes.', 'So nothing is drawn smaller than it is. Remembered in this browser only.')}
              >
                [ FIT THE SERVER TO THIS VIEW ]
              </button>
            ) : null}
            {state !== 'setup' && state !== 'off' ? (
              <button type="button" className={signInOpen ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK} aria-expanded={signInOpen} onClick={() => setSignInOpen((open) => !open)} data-room-rdp-signin-key {...explain(signInOpen ? 'Closes the server sign-in form.' : 'Opens the form for the server\'s address and Windows sign-in.', 'For when the server moved or its password changed.')}>
                [ SERVER SIGN-IN ]
              </button>
            ) : null}
            {switchWhy ? <span role="status">{switchWhy}</span> : null}
          </div>
        ) : null}
        {state === 'setup' || signInOpen ? (
          <ServerSignIn
            onSaved={() => {
              setSignInOpen(false);
              setOptionsOpen(false);
              again();
            }}
            onClose={state === 'setup' ? null : () => setSignInOpen(false)}
          />
        ) : null}
        {routeWords ? (
          <span className="w-fit bg-ink-plate px-1 font-mono" title={routeWords.tip} data-room-rdp-route={route ?? ''}>
            {routeWords.label}
          </span>
        ) : null}
        {state !== 'showing' ? (
          <div className="flex max-w-full flex-wrap items-center justify-end gap-1 bg-ink-plate px-1 font-mono" role="status">
            <span data-room-rdp-says>{says}</span>
            {state === 'locked' ? (
              <button type="button" className={PLATE_ON_BLACK} onClick={unlock} title="Opens Cloudflare's own page in a small window: type your email, then the code it sends" data-room-rdp-unlock {...explain('Opens Cloudflare\'s own page in a small window: type your email, then the code it sends you.', 'Over the internet the server has an extra lock. Once it lets you in, this screen connects by itself.')}>
                [ UNLOCK WITH AN EMAIL CODE ]
              </button>
            ) : null}
            {state === 'ended' || state === 'locked' ? (
              <button type="button" className={PLATE_ON_BLACK} onClick={again} data-room-rdp-again {...explain('Asks the PC for the way in again and reconnects.', 'The connection ended or was locked; this starts it over.')}>
                [ TRY AGAIN ]
              </button>
            ) : null}
          </div>
        ) : (
          <div className="flex max-w-full flex-wrap items-center justify-end gap-1 bg-ink-plate px-1 font-mono" role="status" data-room-rdp-control={engaged ? 'on' : 'off'}>
            <span>{engaged ? (escHolding ? 'KEEP HOLDING ESC TO LET GO' : 'CONTROL ON · HOLD ESC TO LET GO') : 'CONTROL OFF · CLICK THE PICTURE'}</span>
            <button type="button" className={PLATE_ON_BLACK} onClick={() => engage(!engaged)} data-room-rdp-release {...explain(engaged ? 'Gives back control: your keyboard and mouse stop working on the server.' : 'Takes control of the server: your keyboard and mouse work on it.', 'Holding Esc for a second also lets go, and clicking the picture takes control again.')}>
              {engaged ? '[ RELEASE ]' : '[ TAKE CONTROL ]'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
