/**
 * The project file: a ZIP holding `project.json`, a PNG per plane and any imported pictures and sounds. Work can leave the browser, be
 * backed up, and come back. The site never sees it.
 */
import { readProject, unusedDrawings } from './project';
import { planeFile, planeKey } from './planes';
import { readFile, writeFile } from './storage';
import { zipExtract, zipList, zipParts, type ZipEntry } from './zip';
import type { PlaneName, Project } from './types';

export const FILE_EXTENSION = '.animate.zip';

type SaveFilePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>;

/** A file name: the project's own, without anything a file system refuses. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, ' ').trim();
  return cleaned === '' ? 'UNTITLED' : cleaned.slice(0, 80);
}

/** Every asset a project points at. */
export function assetIdsOf(project: Project): string[] {
  const ids = new Set<string>();
  if (project.audio !== null) ids.add(project.audio.assetId);
  for (const drawing of Object.values(project.drawings)) {
    for (const plane of ['line', 'colour'] as PlaneName[]) {
      for (const op of drawing.planes[plane]) if (op.kind === 'image') ids.add(op.assetId);
    }
  }
  return [...ids];
}

/** The project as one file. The drawings no cel uses are left behind. `pictureFor` gives a plane's newest picture. */
export async function buildProjectFile(project: Project, pictureFor: (key: string) => Promise<Blob | null>): Promise<Blob> {
  const unused = new Set(unusedDrawings(project));
  const drawings = Object.fromEntries(Object.entries(project.drawings).filter(([id]) => !unused.has(id)));
  const kept: Project = { ...project, drawings };
  const entries: ZipEntry[] = [{ name: 'project.json', bytes: new TextEncoder().encode(JSON.stringify(kept)) }];

  for (const drawing of Object.values(drawings)) {
    for (const plane of ['line', 'colour'] as PlaneName[]) {
      if (drawing.planes[plane].length === 0) continue;
      const key = planeKey(drawing.id, plane);
      const blob = await pictureFor(key);
      if (blob !== null) entries.push({ name: `planes/${planeFile(key)}`, bytes: new Uint8Array(await blob.arrayBuffer()) });
    }
  }
  for (const assetId of assetIdsOf(kept)) {
    const blob = await readFile(project.id, `assets/${assetId}`);
    if (blob !== null) entries.push({ name: `assets/${assetId}`, bytes: new Uint8Array(await blob.arrayBuffer()) });
  }
  return new Blob(zipParts(entries), { type: 'application/zip' });
}

/** Save with the browser's own file dialog where it has one, otherwise as a download. False when the person cancelled. */
export async function saveBlobAs(blob: Blob, name: string, description: string, extensions: string[]): Promise<boolean> {
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (picker !== undefined) {
    try {
      const handle = await picker.call(window, { suggestedName: name, types: [{ description, accept: { [blob.type || 'application/octet-stream']: extensions } }] });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (error) {
      if ((error as Error).name === 'AbortError') return false;
      // Anything else (a blocked dialog): fall through to a download.
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

/** A project file read and its pictures stored under a new project id, so it can't overwrite anything already here. */
export async function readProjectFile(file: Blob, newProjectId: string): Promise<Project | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let entries;
  try {
    entries = zipList(bytes);
  } catch {
    return null;
  }
  const head = entries.find((entry) => entry.name === 'project.json');
  if (head === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(await zipExtract(bytes, head)));
  } catch {
    return null;
  }
  const project = readProject(parsed);
  if (project === null) return null;

  for (const entry of entries) {
    if (entry.name === 'project.json' || entry.name.includes('..')) continue;
    const content = await zipExtract(bytes, entry);
    if (entry.name.startsWith('planes/')) {
      await writeFile(newProjectId, entry.name.slice('planes/'.length), new Blob([content as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
    } else if (entry.name.startsWith('assets/')) {
      await writeFile(newProjectId, entry.name, new Blob([content as Uint8Array<ArrayBuffer>]));
    }
  }
  return { ...project, id: newProjectId };
}
