/**
 * Letting the sound graph hear this tab (Luke, 2026-11-16: "both and the button to allow it, if not initially allowed, is
 * small and to the right inside the black of the bar at the bottom"). The page cannot hear a YouTube, Vimeo or Twitch
 * player: their sound never reaches the page's own code. The browser can share the tab's sound with the page if the reader
 * says so, through its own "share this tab" prompt (`getDisplayMedia`). That is all this does:
 *
 * - asked only on the reader's press of `[ HEAR ]`, never by itself; once a visit (a reload ends the browser's share, and
 *   the key is back);
 * - the audio goes to the graph's analyser and nowhere else; the picture the browser insists on sharing with it is
 *   stopped at once and never looked at;
 * - nothing is recorded, kept or sent: the sound is measured in the page while the graph draws, and that is all;
 * - the browser's own "sharing this tab" strip stays up while it is allowed, and its STOP ends it (the key comes back).
 *
 * Chrome and Edge share a tab's sound; Firefox and Safari share no sound at all, so there the key is never shown.
 */

export type TabListen = 'unasked' | 'asking' | 'allowed' | 'refused' | 'unsupported';

type State = { status: TabListen; stream: MediaStream | null };

let state: State = { status: canHearTab() ? 'unasked' : 'unsupported', stream: null };
const listeners = new Set<() => void>();

function set(next: State): void {
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeToTabListen(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function tabListenState(): TabListen {
  return state.status;
}

export function tabListenServerState(): TabListen {
  return 'unsupported';
}

/** The tab's sound while the reader allows it, or null. */
export function tabSound(): MediaStream | null {
  return state.status === 'allowed' ? state.stream : null;
}

/** Whether this browser can share a tab's sound: Chromium's (Chrome, Edge), which alone carry `userAgentData`. */
export function canHearTab(): boolean {
  if (typeof navigator === 'undefined') return false;
  const devices = navigator.mediaDevices as (MediaDevices & { getDisplayMedia?: unknown }) | undefined;
  return typeof devices?.getDisplayMedia === 'function' && 'userAgentData' in navigator;
}

/**
 * The browser's prompt, on a press. Chrome offers this tab first (`preferCurrentTab`) with "also share tab audio" on;
 * the reader picks it and presses Share. A share with no sound (the box unticked, another window picked) is let go and
 * counted as refused, so the key stays.
 */
export async function askToHearTab(): Promise<void> {
  if (!canHearTab() || state.status === 'asking' || state.status === 'allowed') return;
  set({ status: 'asking', stream: null });
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { suppressLocalAudioPlayback: false } as MediaTrackConstraints,
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      systemAudio: 'exclude',
      surfaceSwitching: 'exclude',
    } as DisplayMediaStreamOptions);
  } catch {
    set({ status: 'refused', stream: null });
    return;
  }
  // The picture is never wanted: stopped at once.
  for (const track of stream.getVideoTracks()) track.stop();
  const audio = stream.getAudioTracks();
  if (audio.length === 0) {
    set({ status: 'refused', stream: null });
    return;
  }
  const sound = new MediaStream(audio);
  // The browser's STOP, or the tab's share ending any other way: the key comes back.
  audio[0].addEventListener('ended', () => {
    if (state.stream === sound) set({ status: 'unasked', stream: null });
  });
  set({ status: 'allowed', stream: sound });
}
