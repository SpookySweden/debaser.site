/**
 * Whose tabs are open (SPEC-seeing-machine.md): in this browser under the account's own key, so two people sharing a computer never see each
 * other's pages, and on the account, which nobody else reads, for a browser that has none of them.
 */
import { accountTabs, saveAccountTabs } from './account';
import { freshTabs, storedTabs, tabsFromStored, type Tabs } from './tabs';

const STORAGE_PREFIX = 'debaser-seeing-tabs-v1:';

export type OwnedTabs = { owner: string | null; state: Tabs };

const NOBODY: OwnedTabs = { owner: null, state: freshTabs('first') };

let held: OwnedTabs = NOBODY;
const listeners = new Set<() => void>();

const publish = (next: OwnedTabs) => {
  held = next;
  for (const listener of listeners) listener();
};

export const seeingTabs = (): OwnedTabs => held;
export const seeingTabsOnServer = (): OwnedTabs => NOBODY;

export function subscribeToSeeingTabs(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function freshId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Opens a person's tabs again where they were; their own, whoever was here before. */
export function openTabsOf(owner: string): void {
  if (held.owner === owner) return;
  let stored: Tabs | null = null;
  try {
    stored = tabsFromStored(window.localStorage.getItem(STORAGE_PREFIX + owner));
  } catch {
    // No storage here (a private window): a new tab, forgotten on leaving.
  }
  const opened = stored ?? freshTabs(freshId());
  publish({ owner, state: opened });
  if (stored !== null) return;
  // Nothing of theirs here: as they left them in another browser, unless they have begun already.
  void accountTabs()
    .catch(() => null)
    .then((kept) => {
      if (kept !== null && held.owner === owner && held.state === opened) publish({ owner, state: kept });
    });
}

/** Sent to the account a little after they stop changing. */
const SAVE_AFTER_MS = 3000;
let saving: ReturnType<typeof setTimeout> | null = null;
function saveSoon(owner: string): void {
  if (saving !== null) clearTimeout(saving);
  saving = setTimeout(() => {
    saving = null;
    if (held.owner === owner) void saveAccountTabs(owner, held.state).catch(() => undefined);
  }, SAVE_AFTER_MS);
}

/** Signed out: nobody's tabs are held in the page. What is stored stays, for them to come back to. */
export function letTabsGo(): void {
  if (held.owner !== null) publish(NOBODY);
}

export function changeTabs(change: (state: Tabs) => Tabs): void {
  if (held.owner === null) return;
  const state = change(held.state);
  if (state === held.state) return;
  publish({ owner: held.owner, state });
  saveSoon(held.owner);
  try {
    window.localStorage.setItem(STORAGE_PREFIX + held.owner, storedTabs(state));
  } catch {
    // Storage full or refused: the tabs last as long as the page.
  }
}
