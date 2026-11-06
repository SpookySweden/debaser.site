/**
 * Writes a plane's picture to the browser's private file storage, away from the pen: the PNG encode and the write both happen here, so
 * an autosave never stutters a stroke. The page hands over a picture it no longer needs (a transferred ImageBitmap).
 */
type WriteMessage = { id: number; path: string[]; bitmap: ImageBitmap };

async function dirOf(path: string[]): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
  let dir = await navigator.storage.getDirectory();
  for (const part of path.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
  return { dir, name: path[path.length - 1] };
}

self.onmessage = async (event: MessageEvent<WriteMessage>) => {
  const { id, path, bitmap } = event.data;
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const { dir, name } = await dirOf(path);
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    self.postMessage({ id, ok: true });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error) });
  }
};
