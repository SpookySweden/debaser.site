'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getModerationStore } from '../lib/moderation/repository';
import {
  GOOD_STANDING,
  hiddenKey,
  NO_ROLE,
  type HiddenMark,
  type ModerationRole,
  type ModTargetKind,
  type Standing,
} from '../lib/moderation/types';
import { useAuth } from './AuthProvider';

/**
 * Who the reader is to moderation (SPEC-moderation.md): a moderator or not, banned or not, and whom they have blocked.
 *
 * The database already keeps a blocked person's rows and other people's hidden rows from reaching this browser; the filters here
 * (`shows`) are for the mock store, for rows that arrive on a live wire, and so a block takes effect on screen at once instead of on
 * the next read. `version` moves on whenever what the reader may see changed (a block, an unblock, a moderator's hide anywhere),
 * so the board and the rooms can read again.
 */

type ModerationContextValue = {
  role: ModerationRole;
  standing: Standing;
  blocked: ReadonlySet<string>;
  version: number;
  /**
   * The moderator tools on the page (the ADMIN and MOD rows, HIDE, the pin panel) are drawn only while this is on (Luke, 2026-11-20:
   * "make the settings hidden by default instead of covering the page"). Off by default; the `[ MOD ]` key after the reader's name
   * turns it on. Kept in this browser, per person. Always false for somebody who isn't a moderator.
   */
  toolsOn: boolean;
  setToolsShown(shown: boolean): void;
  isBlocked(person: string | null | undefined): boolean;
  block(person: string): Promise<void>;
  unblock(person: string): Promise<void>;
  /** Read role, standing, blocks and hidden marks again (after a moderator's action, an appeal...). */
  refresh(): void;
  /** The hidden mark a row wears: its own (from the database) or the mock store's. */
  markFor(kind: ModTargetKind, id: string, own?: HiddenMark | null): HiddenMark | null;
  /** Whether this reader sees the row at all: not a blocked author's, and not hidden unless it is theirs or they moderate. */
  shows(kind: ModTargetKind, id: string, authorId: string | null | undefined, own?: HiddenMark | null): boolean;
};

const NOBODY: ModerationContextValue = {
  role: NO_ROLE,
  standing: GOOD_STANDING,
  blocked: new Set(),
  version: 0,
  toolsOn: false,
  setToolsShown: () => undefined,
  isBlocked: () => false,
  block: async () => undefined,
  unblock: async () => undefined,
  refresh: () => undefined,
  markFor: (_kind, _id, own) => own ?? null,
  shows: () => true,
};

/** This browser's memory of whose moderator tools are showing: `{ <account id>: true }`. Shown is never the default. */
export const MOD_TOOLS_KEY = 'debaser.moderation.tools-shown.v1';

function readToolsShown(person: string): boolean {
  try {
    const saved = JSON.parse(window.localStorage.getItem(MOD_TOOLS_KEY) ?? '{}') as Record<string, unknown>;
    return saved[person] === true;
  } catch {
    return false;
  }
}

function writeToolsShown(person: string, shown: boolean): void {
  try {
    const saved = JSON.parse(window.localStorage.getItem(MOD_TOOLS_KEY) ?? '{}') as Record<string, unknown>;
    if (shown) saved[person] = true;
    else delete saved[person];
    window.localStorage.setItem(MOD_TOOLS_KEY, JSON.stringify(saved));
  } catch {
    // Storage off: the choice lasts until the page is left.
  }
}

const ModerationContext = createContext<ModerationContextValue>(NOBODY);

export function ModerationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const me = user?.id ?? null;
  // What was read, and for whom: a different reader (or nobody) reads as no role, good standing, nobody blocked, until their own
  // answer lands.
  const [read, setRead] = useState<{ me: string; role: ModerationRole; standing: Standing; blocked: ReadonlySet<string>; toolsShown: boolean } | null>(null);
  const current = read !== null && read.me === me ? read : null;
  const role = current?.role ?? NO_ROLE;
  const standing = current?.standing ?? GOOD_STANDING;
  const blocked = useMemo<ReadonlySet<string>>(() => current?.blocked ?? new Set(), [current]);
  const setBlocked = useCallback(
    (change: (was: ReadonlySet<string>) => ReadonlySet<string>) =>
      setRead((was) => (was === null || was.me !== me ? was : { ...was, blocked: change(was.blocked) })),
    [me],
  );
  const [marks, setMarks] = useState<Record<string, HiddenMark>>({});
  const [version, setVersion] = useState(0);
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    const store = getModerationStore();
    let cancelled = false;
    if (me === null) {
      void Promise.resolve().then(() => {
        if (!cancelled) setMarks(store.hiddenMarks());
      });
      return () => {
        cancelled = true;
      };
    }
    void Promise.all([
      store.myRole(me).catch(() => NO_ROLE),
      store.myStanding(me).catch(() => GOOD_STANDING),
      store.listBlocks(me).catch(() => [] as string[]),
    ]).then(([nextRole, nextStanding, nextBlocks]) => {
      if (cancelled) return;
      setRead({ me, role: nextRole, standing: nextStanding, blocked: new Set(nextBlocks), toolsShown: readToolsShown(me) });
      setMarks(store.hiddenMarks());
    });
    return () => {
      cancelled = true;
    };
  }, [me, asked]);

  useEffect(() => {
    const store = getModerationStore();
    return store.subscribePulse(() => {
      setMarks(store.hiddenMarks());
      setVersion((value) => value + 1);
    });
  }, []);

  const refresh = useCallback(() => {
    setAsked((value) => value + 1);
    setMarks(getModerationStore().hiddenMarks());
    setVersion((value) => value + 1);
  }, []);

  const block = useCallback(
    async (person: string) => {
      if (me === null) return;
      await getModerationStore().block(me, person);
      setBlocked((was) => new Set([...was, person]));
      setVersion((value) => value + 1);
    },
    [me, setBlocked],
  );

  const unblock = useCallback(
    async (person: string) => {
      if (me === null) return;
      await getModerationStore().unblock(me, person);
      setBlocked((was) => new Set([...was].filter((id) => id !== person)));
      setVersion((value) => value + 1);
    },
    [me, setBlocked],
  );

  const toolsOn = role.moderator && current?.toolsShown === true;
  const setToolsShown = useCallback(
    (shown: boolean) => {
      if (me === null) return;
      writeToolsShown(me, shown);
      setRead((was) => (was === null || was.me !== me ? was : { ...was, toolsShown: shown }));
    },
    [me],
  );

  const value = useMemo<ModerationContextValue>(() => {
    const markFor = (kind: ModTargetKind, id: string, own?: HiddenMark | null) => own ?? marks[hiddenKey(kind, id)] ?? null;
    const isBlocked = (person: string | null | undefined) => person !== null && person !== undefined && blocked.has(person);
    return {
      role,
      toolsOn,
      setToolsShown,
      standing,
      blocked,
      version,
      isBlocked,
      block,
      unblock,
      refresh,
      markFor,
      shows: (kind, id, authorId, own) => {
        // A moderator's own block never hides what they moderate (SPEC-moderation.md).
        if (!role.moderator && isBlocked(authorId)) return false;
        if (markFor(kind, id, own) === null) return true;
        return role.moderator || (me !== null && authorId === me);
      },
    };
  }, [role, standing, blocked, version, block, unblock, refresh, marks, me, toolsOn, setToolsShown]);

  return <ModerationContext.Provider value={value}>{children}</ModerationContext.Provider>;
}

export function useModeration(): ModerationContextValue {
  return useContext(ModerationContext);
}
