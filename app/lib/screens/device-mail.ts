import { bodyText, ownerIsAsking, realDeps, type ScreensDeps } from './host-server';

/**
 * REMOTE from another of the owner's own devices, with nothing installed on it (SPEC-screens.md; Luke, 2026-11-21:
 * "without any software needing to be installed on the devices for now. Just a selection option of which signed in
 * device to stream from when you click remote").
 *
 * Every tab of the owner's that has the site open says "here I am" every few seconds (`/api/screens/devices`); this
 * file keeps who said so lately, and a small mailbox per device for the handshake that starts a picture between two
 * of them (an ask, the shared screen's offer, the answer, a no, a stop). The picture itself then travels straight
 * between the two browsers by WebRTC; nothing of it passes through here.
 *
 * Kept in this server's memory only: nothing is stored, and a restart of the site forgets it all (the tabs say "here
 * I am" again within seconds). The site's server is one process on the PC, so one memory is the whole truth. Owner
 * only, by the same session-token check as the engine's routes: everybody else is refused, the same way whether any
 * device is there or not.
 *
 * What a browser allows, said plainly: a page can never capture its screen by itself. The device asked shows a
 * pop-up, and somebody at it must press SHARE and choose a screen in the browser's own prompt. Nothing can be
 * controlled from the other side: that needs the screen engine installed.
 */

/** A device is listed while it has said "here I am" this lately. */
export const DEVICE_FRESH_MS = 15_000;
/** A message not collected in this long is dropped. */
export const MAIL_KEPT_MS = 60_000;
/** The largest message: a WebRTC description with its addresses (a few kilobytes); this is generous. */
export const MAX_MAIL_BYTES = 32 * 1024;
/** The most messages waiting for one device. */
export const MAX_WAITING = 20;
/** The most devices remembered at once. */
export const MAX_DEVICES = 12;

export const MAIL_KINDS = ['ask', 'offer', 'answer', 'no', 'stop'] as const;
export type MailKind = (typeof MAIL_KINDS)[number];

export type Device = { id: string; name: string; seenAt: number };
export type Mail = { from: string; kind: MailKind; body: string; at: number };

const ID = /^[a-z0-9]{8,32}$/;

/** A device's name as it says it: printable, one line, at most 60 characters. Never HTML: shown as plain text. */
export function cleanName(name: unknown): string {
  if (typeof name !== 'string') return 'A DEVICE';
  const plain = name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return plain.length > 0 ? plain : 'A DEVICE';
}

export function isDeviceId(id: unknown): id is string {
  return typeof id === 'string' && ID.test(id);
}

/** The whole memory, as a value a check can make and read. */
export class DeviceMail {
  readonly devices = new Map<string, Device>();
  readonly mail = new Map<string, Mail[]>();

  private forgetOld(now: number): void {
    for (const [id, device] of this.devices) if (now - device.seenAt > DEVICE_FRESH_MS * 4) this.devices.delete(id);
    for (const [id, list] of this.mail) {
      const kept = list.filter((m) => now - m.at <= MAIL_KEPT_MS);
      if (kept.length === 0) this.mail.delete(id);
      else this.mail.set(id, kept);
    }
  }

  /** "Here I am": noted, and answered with the other devices listed now and this one's waiting messages (taken). */
  hereIAm(id: string, name: string, now: number): { devices: { id: string; name: string }[]; mail: Mail[] } {
    this.forgetOld(now);
    if (!this.devices.has(id) && this.devices.size >= MAX_DEVICES) {
      // The longest-silent goes, so a new device is never shut out by old ones.
      const oldest = [...this.devices.values()].sort((a, b) => a.seenAt - b.seenAt)[0];
      if (oldest) this.devices.delete(oldest.id);
    }
    this.devices.set(id, { id, name, seenAt: now });
    const devices = [...this.devices.values()]
      .filter((d) => d.id !== id && now - d.seenAt <= DEVICE_FRESH_MS)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((d) => ({ id: d.id, name: d.name }));
    const mail = this.mail.get(id) ?? [];
    this.mail.delete(id);
    return { devices, mail };
  }

  /** A message for another device. Refused for a device not listed lately, an unknown kind, or a full mailbox. */
  send(from: string, to: string, kind: MailKind, body: string, now: number): string | null {
    this.forgetOld(now);
    if (from === to) return 'A device cannot send to itself.';
    const target = this.devices.get(to);
    if (!target || now - target.seenAt > DEVICE_FRESH_MS) return 'That device is not on the site right now.';
    const list = this.mail.get(to) ?? [];
    if (list.length >= MAX_WAITING) return 'That device has too many messages waiting.';
    list.push({ from, kind, body, at: now });
    this.mail.set(to, list);
    return null;
  }
}

const memory = new DeviceMail();

const NEVER_KEPT = { 'Cache-Control': 'private, no-store' };
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...NEVER_KEPT } });
const refused = () => json(403, { error: 'Not available.' });

async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return null;
  const text = await bodyText(request, MAX_MAIL_BYTES + 1024);
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** POST /api/screens/devices `{ id, name }` -> `{ devices: [{ id, name }], mail: [...] }`. Owner only. */
export async function devicesAnswer(request: Request, deps: ScreensDeps = realDeps(), store: DeviceMail = memory, now = Date.now()): Promise<Response> {
  if (!(await ownerIsAsking(request, deps))) return refused();
  const body = await jsonBody(request);
  if (body === null || !isDeviceId(body.id)) return json(400, { error: 'Say which device this is.' });
  return json(200, store.hereIAm(body.id, cleanName(body.name), now));
}

/** POST /api/screens/mail `{ from, to, kind, body }` -> 204. Owner only. */
export async function mailAnswer(request: Request, deps: ScreensDeps = realDeps(), store: DeviceMail = memory, now = Date.now()): Promise<Response> {
  if (!(await ownerIsAsking(request, deps))) return refused();
  const body = await jsonBody(request);
  if (body === null) return json(400, { error: 'That is not a message.' });
  const { from, to, kind } = body;
  const text = typeof body.body === 'string' ? body.body : '';
  if (!isDeviceId(from) || !isDeviceId(to)) return json(400, { error: 'Say which devices.' });
  if (!MAIL_KINDS.includes(kind as MailKind)) return json(400, { error: 'Not a kind of message this knows.' });
  if (new TextEncoder().encode(text).byteLength > MAX_MAIL_BYTES) return json(413, { error: 'That message is too large.' });
  const why = store.send(from, to, kind as MailKind, text, now);
  if (why !== null) return json(409, { error: why });
  return new Response(null, { status: 204, headers: NEVER_KEPT });
}
