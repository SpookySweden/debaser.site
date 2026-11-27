/**
 * The extension as this build has it (SPEC-seeing-machine.md, D1): each file, a list of them with their fingerprints, and all of them as one
 * download. Made when the site is built, from the folder the repository keeps, so it is always the version the site runs. SERVER ONLY.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import type { ExtensionList } from '../extension';

/** Every file of it. `Temp/check-see-extension.cjs` holds this to the folder. */
export const EXTENSION_FILES = ['README.md', 'act.js', 'frame.js', 'icon-128.png', 'icon-16.png', 'icon-32.png', 'icon-48.png', 'lens.js', 'machine.css', 'machine.html', 'machine.js', 'manifest.json', 'panel.css', 'panel.html', 'panel.js', 'sites.js', 'worker.js'] as const;

/**
 * A file as it is served: the same bytes on whichever machine the site is built, whatever that machine does with line ends. Its icons
 * (2026-11-27, Luke's text icon) are pictures, served as the bytes they are.
 */
export async function extensionFile(name: string): Promise<Buffer | null> {
  const known = EXTENSION_FILES.find((each) => each === name);
  if (known === undefined) return null;
  if (known.endsWith('.png')) return readFile(join(process.cwd(), 'extension', known));
  return Buffer.from((await readFile(join(process.cwd(), 'extension', known), 'utf8')).replace(/\r\n/g, '\n'), 'utf8');
}

export async function extensionList(): Promise<ExtensionList> {
  const files: ExtensionList['files'] = [];
  for (const name of EXTENSION_FILES) {
    const bytes = await extensionFile(name);
    if (bytes !== null) files.push({ name, size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const manifest = JSON.parse((await extensionFile('manifest.json'))?.toString('utf8') ?? '{}') as { version: string };
  // The version before this one, from the record of every version (in the order they were made).
  const versions = Object.keys(JSON.parse(await readFile(join(process.cwd(), 'extension-versions.json'), 'utf8').catch(() => '{}')) as Record<string, string>);
  const previous = versions[versions.indexOf(manifest.version) - 1];
  return previous === undefined || !versions.includes(manifest.version) ? { version: manifest.version, files } : { version: manifest.version, previous, files };
}

const FOLDER = 'debaser-extension';

/** A plain zip: one folder, each file deflated. (1980: a zip's first day, so the same files make the same bytes.) */
export function zipOf(files: readonly { name: string; bytes: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const names: Buffer[] = [];
  let at = 0;
  for (const { name, bytes } of files) {
    const called = Buffer.from(`${FOLDER}/${name}`, 'utf8');
    const packed = deflateRawSync(bytes, { level: 9 });
    const head = Buffer.alloc(26);
    head.writeUInt16LE(20, 0);
    head.writeUInt16LE(0x0800, 2);
    head.writeUInt16LE(8, 4);
    head.writeUInt16LE(0, 6);
    head.writeUInt16LE(0x21, 8);
    head.writeUInt32LE(crc32(bytes), 10);
    head.writeUInt32LE(packed.byteLength, 14);
    head.writeUInt32LE(bytes.byteLength, 18);
    head.writeUInt16LE(called.byteLength, 22);
    parts.push(Buffer.from([0x50, 0x4b, 3, 4]), head, called, packed);
    const entry = Buffer.alloc(14);
    entry.writeUInt32LE(at, 10);
    names.push(Buffer.from([0x50, 0x4b, 1, 2, 20, 0]), head, entry, called);
    at += 4 + head.byteLength + called.byteLength + packed.byteLength;
  }
  const list = Buffer.concat(names);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(list.byteLength, 12);
  end.writeUInt32LE(at, 16);
  return Buffer.concat([...parts, list, end]);
}

/**
 * `store`: the copy for the Chrome Web Store and Edge Add-ons, without the manifest's `key` (a store gives the extension its own id, and
 * refuses or ignores a key of ours). The key stays in the one people load by hand, so its id is the one the site knows (EXTENSION_ID).
 */
export async function extensionZip(store = false): Promise<{ name: string; bytes: Buffer }> {
  const files: { name: string; bytes: Buffer }[] = [];
  for (const name of EXTENSION_FILES) {
    const bytes = await extensionFile(name);
    if (bytes === null) continue;
    if (store && name === 'manifest.json') {
      const manifest = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
      delete manifest.key;
      files.push({ name, bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8') });
    } else files.push({ name, bytes });
  }
  return { name: `${FOLDER}-${store ? 'store-' : ''}${(await extensionList()).version}.zip`, bytes: zipOf(files) };
}
