/**
 * A page that folds the side panel for itself (the beat box, SPEC-beatbox-ui.md): whether the reader has opened it again
 * while standing there. Held apart from the panel's remembered answer (DesktopSidebar.tsx) and never written to storage,
 * so leaving the page leaves the panel as it was. In its own small file so a page can ask without loading the panel.
 */
const listeners = new Set<() => void>();
let open = false;

export function subscribeToPagePanel(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function pagePanelOpen(): boolean {
  return open;
}

export function setPagePanelOpen(next: boolean): void {
  open = next;
  for (const listener of listeners) listener();
}

/** The one key that brings the panel back, or folds it again. */
export function togglePagePanel(): void {
  setPagePanelOpen(!open);
}
