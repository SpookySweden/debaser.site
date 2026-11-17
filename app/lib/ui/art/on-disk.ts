/**
 * Which of the watched art files were on disk when the site was built (`ART_ON_DISK`, written by next.config.ts).
 *
 * A slot whose drawing does not exist yet shows its text stand-in without asking for the file, so a guest's page makes
 * no request that can only come back "not found" (review fixes, 2026-11-17). The day the drawing is dropped into
 * `assets/`, the next build lists it and the slot shows it. Only the paths next.config.ts watches are ever listed.
 */
const ON_DISK = (process.env.ART_ON_DISK ?? '').split(',').filter((path) => path.length > 0);

export function artOnDisk(path: string): boolean {
  return ON_DISK.includes(path);
}
