/**
 * Keeping the extension up to date in the folder its reader loaded it from (SPEC-seeing-machine.md, D1). A browser never updates such a folder
 * by itself, so the site does, with the reader's leave: it writes the build's own files there, each checked against the build's list first, and
 * nothing anywhere else. Nothing about who has the extension is sent anywhere.
 */
import { EXTENSION_ID } from './own-eye';

export type ExtensionList = { version: string; files: { name: string; size: number; sha256: string }[] };

const NAME = /^[A-Za-z][A-Za-z0-9-]{0,40}\.(?:js|json|html|css|md)$/;
const FILES_MOST = 60;
const FILE_MOST = 400_000;

export function listFrom(value: unknown): ExtensionList | null {
  const { version, files } = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  if (typeof version !== 'string' || !/^\d{1,5}(?:\.\d{1,5}){0,3}$/.test(version) || !Array.isArray(files) || files.length === 0 || files.length > FILES_MOST) return null;
  const read: ExtensionList['files'] = [];
  for (const each of files) {
    const { name, size, sha256 } = (typeof each === 'object' && each !== null ? each : {}) as Record<string, unknown>;
    if (typeof name !== 'string' || !NAME.test(name) || read.some((known) => known.name === name) || typeof size !== 'number' || !(size > 0 && size <= FILE_MOST) || typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return null;
    read.push({ name, size, sha256 });
  }
  return read.some((each) => each.name === 'manifest.json') ? { version, files: read } : null;
}

/** Whether one version comes after another. */
export function isNewer(one: string, other: string): boolean {
  const [a, b] = [one.split('.').map(Number), other.split('.').map(Number)];
  for (let i = 0; i < 4; i += 1) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
}

/** What is used of a picked folder: the browser's own handle, or a check's stand-in. */
export type Writing = { write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> };
export type FolderFile = { getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; size: number }>; createWritable(): Promise<Writing> };
export type Folder = { name: string; removeEntry?(name: string): Promise<void>; getFileHandle(name: string, options?: { create?: boolean }): Promise<FolderFile> };

const hex = (bytes: ArrayBuffer): string => [...new Uint8Array(bytes)].map((each) => each.toString(16).padStart(2, '0')).join('');
export const fingerprint = async (bytes: Uint8Array): Promise<string> => hex(await crypto.subtle.digest('SHA-256', bytes as BufferSource));

/** The id a browser gives an extension with this key. */
export async function idOfKey(key: string): Promise<string | null> {
  try {
    const bytes = Uint8Array.from(atob(key), (each) => each.charCodeAt(0));
    return [...(await fingerprint(bytes)).slice(0, 32)].map((each) => String.fromCharCode(97 + parseInt(each, 16))).join('');
  } catch {
    return null;
  }
}

async function readFile(folder: Folder, name: string): Promise<Uint8Array | null> {
  try {
    const file = await (await folder.getFileHandle(name)).getFile();
    return file.size > FILE_MOST ? null : new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
}

/** Whether a folder is the extension's: it already holds a manifest, and the manifest is ours. */
export async function isItsFolder(folder: Folder): Promise<boolean> {
  const bytes = await readFile(folder, 'manifest.json');
  if (bytes === null) return false;
  try {
    const manifest = JSON.parse(new TextDecoder().decode(bytes)) as { key?: unknown };
    return typeof manifest.key === 'string' && (await idOfKey(manifest.key)) === EXTENSION_ID;
  } catch {
    return false;
  }
}

export type Updated = { ok: true } | { ok: false; reason: string };

/**
 * The build's files into the folder. Every file is fetched and proved before anything is touched; each is written beside the one it replaces
 * (the browser's own way: what is written appears only when it is closed) and all of them are swapped at the end, the manifest last. If a swap
 * fails part of the way, what was there is put back.
 */
export async function writeUpdate(folder: Folder, list: ExtensionList, fetchFile: (name: string, sha256: string) => Promise<Uint8Array | null>): Promise<Updated> {
  if (!(await isItsFolder(folder))) return { ok: false, reason: "THAT ISN'T THE EXTENSION'S FOLDER" };
  const files = [...list.files].sort((a, b) => Number(a.name === 'manifest.json') - Number(b.name === 'manifest.json'));
  const fresh = new Map<string, Uint8Array>();
  for (const { name, size, sha256 } of files) {
    const bytes = await fetchFile(name, sha256).catch(() => null);
    if (bytes === null) return { ok: false, reason: `${name} DID NOT COME. NOTHING WAS CHANGED` };
    if (bytes.byteLength !== size || (await fingerprint(bytes)) !== sha256) return { ok: false, reason: `${name} IS NOT WHAT IT SHOULD BE. NOTHING WAS CHANGED` };
    fresh.set(name, bytes);
  }
  const before = new Map<string, Uint8Array | null>();
  for (const { name } of files) before.set(name, await readFile(folder, name));
  // A name that is new in this version is taken away again by a failure: nothing empty is left for the old one to find.
  const unmake = async () => {
    for (const [name, bytes] of before) if (bytes === null) await folder.removeEntry?.(name).catch(() => undefined);
  };

  const open: { name: string; writing: Writing }[] = [];
  try {
    for (const { name } of files) {
      const writing = await (await folder.getFileHandle(name, { create: true })).createWritable();
      open.push({ name, writing });
      await writing.write(fresh.get(name) ?? new Uint8Array());
    }
  } catch {
    for (const { writing } of open) await writing.abort().catch(() => undefined);
    await unmake();
    return { ok: false, reason: "THE BROWSER WOULDN'T WRITE THERE. NOTHING WAS CHANGED" };
  }
  let swapped = 0;
  try {
    for (const { writing } of open) {
      await writing.close();
      swapped += 1;
    }
    for (const { name, sha256 } of files) if ((await fingerprint((await readFile(folder, name)) ?? new Uint8Array())) !== sha256) throw new Error('not as written');
    return { ok: true };
  } catch {
    for (const { writing } of open.slice(swapped)) await writing.abort().catch(() => undefined);
    await unmake();
    let back = true;
    for (const [name, bytes] of before) {
      if (bytes === null) continue;
      try {
        const writing = await (await folder.getFileHandle(name)).createWritable();
        await writing.write(bytes);
        await writing.close();
      } catch {
        back = false;
      }
    }
    return { ok: false, reason: back ? 'IT STOPPED PART OF THE WAY. THE OLD ONE WAS PUT BACK' : 'IT STOPPED PART OF THE WAY, AND THE OLD ONE COULD NOT BE PUT BACK: DOWNLOAD IT AGAIN' };
  }
}
