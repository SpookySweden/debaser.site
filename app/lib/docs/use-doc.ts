'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { canEdit, snippetOf, versionDue } from './rules';
import { getDocsRepository } from './repository';
import {
  base64ToBytes,
  bytesToBase64,
  createDocSession,
  type DocIdentity,
  type DocPeer,
  type DocSession,
  type DocStatus,
} from './session';
import type { DocRecord, DocViewer } from './types';

/** Which document: by id (DOCS) or by lore address. */
export type DocTarget = { id: string } | { slug: string };

export type UseDocResult = {
  record: DocRecord | null;
  ready: boolean;
  error: string | null;
  doc: Y.Doc | null;
  awareness: Awareness | null;
  session: DocSession | null;
  peers: DocPeer[];
  status: DocStatus;
  identity: DocIdentity;
  /** Whether this reader edits (and so sends on the channel). */
  editing: boolean;
  /** Files the writing; answers whether it landed. */
  save: (text: string) => Promise<boolean>;
  saving: boolean;
  savedAt: string | null;
  saveError: string | null;
  /** Reads the row again (after the owner changes its sharing or title). */
  reload: () => void;
  /** Draws a change to the row in place, without leaving the room. */
  patchRecord: (patch: Partial<DocRecord>) => void;
  /** When the last unnamed copy was kept, so the hourly copy knows when it is due. */
  noteVersionKept: (at: string) => void;
};

type Loaded = {
  key: string;
  record: DocRecord | null;
  error: string | null;
  doc: Y.Doc | null;
  awareness: Awareness | null;
  session: DocSession | null;
};

declare global {
  interface Window {
    /** The live document's message counts, read by the two-browser drive to price realtime. */
    debaserDocStats?: () => { sent: number; heard: number; pointersSent: number };
  }
}

/**
 * One document: the row, the shared Yjs document, and its room, joined together and let go together.
 *
 * An editor joins the room to send and hear; a reader (CAN READ, or a visitor on a PUBLIC document)
 * only hears, and reads the saved copy again each time an editor says a save has landed, so a change
 * it missed still reaches it.
 */
export function useDoc(target: DocTarget, viewer: DocViewer | null, colour: string): UseDocResult {
  const viewerId = viewer?.id ?? null;
  const viewerName = viewer?.name ?? null;
  const repository = useMemo(() => getDocsRepository(viewerId), [viewerId]);
  const targetKey = 'id' in target ? `id:${target.id}` : `slug:${target.slug}`;
  const key = `${targetKey}:${viewerId ?? 'visitor'}:${colour}:${viewerName ?? ''}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [peers, setPeers] = useState<DocPeer[]>([]);
  const [status, setStatus] = useState<DocStatus>('SYNCING');
  const [saving, setSaving] = useState(false);
  const [filed, setFiled] = useState<{ key: string; savedAt: string | null; saveError: string | null } | null>(null);

  const docRef = useRef<Y.Doc | null>(null);
  const recordRef = useRef<DocRecord | null>(null);
  const sessionRef = useRef<DocSession | null>(null);
  const lastVersionRef = useRef<string | null | undefined>(undefined);

  const identity: DocIdentity = useMemo(
    () => ({ name: viewerName ?? 'A VISITOR', colour, userId: viewerId }),
    [colour, viewerId, viewerName],
  );

  useEffect(() => {
    let cancelled = false;
    let session: DocSession | null = null;
    let shared: Y.Doc | null = null;
    const stops: (() => void)[] = [];
    const id = targetKey.startsWith('id:') ? targetKey.slice(3) : null;
    const slug = targetKey.startsWith('slug:') ? targetKey.slice(5) : null;
    const read = () => (id !== null ? repository.getDoc(id) : repository.getDocBySlug(slug ?? ''));

    read()
      .then((record) => {
        if (cancelled) return;
        recordRef.current = record;

        if (record === null) {
          setLoaded({ key, record: null, error: null, doc: null, awareness: null, session: null });
          return;
        }

        shared = new Y.Doc();
        if (record.state.length > 0) Y.applyUpdate(shared, base64ToBytes(record.state), 'stored');

        const presence = new Awareness(shared);
        const sends = viewerId !== null && canEdit(record.role);
        session = createDocSession({
          room: repository.openRoom(record.id),
          doc: shared,
          awareness: presence,
          user: { name: viewerName ?? 'A VISITOR', colour, userId: viewerId },
          canSend: sends,
        });

        const joined = session;
        const doc = shared;
        stops.push(joined.onPeers(setPeers), joined.onStatus(setStatus));

        // A reader cannot ask for the document, so a save is its cue to read the saved copy again.
        if (!sends) {
          stops.push(
            joined.onSaved(() => {
              void read().then((fresh) => {
                if (cancelled || fresh === null || fresh.state.length === 0) return;
                Y.applyUpdate(doc, base64ToBytes(fresh.state), 'remote');
              });
            }),
          );
        }

        if (typeof window !== 'undefined') window.debaserDocStats = joined.stats;

        docRef.current = shared;
        sessionRef.current = joined;
        lastVersionRef.current = undefined;
        setLoaded({ key, record, error: null, doc: shared, awareness: presence, session: joined });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setLoaded({
          key,
          record: null,
          error: caught instanceof Error ? caught.message : 'THE DOCUMENT DID NOT LOAD.',
          doc: null,
          awareness: null,
          session: null,
        });
      });

    return () => {
      cancelled = true;
      for (const stop of stops) stop();
      session?.destroy();
      shared?.destroy();
      docRef.current = null;
      sessionRef.current = null;
    };
    // `attempt` reloads on purpose; the rest is the key.
  }, [attempt, colour, key, repository, targetKey, viewerId, viewerName]);

  const current = loaded !== null && loaded.key === key ? loaded : null;
  const filedNow = filed !== null && filed.key === key ? filed : null;

  const save = useCallback(
    async (text: string): Promise<boolean> => {
      const record = recordRef.current;
      const shared = docRef.current;
      if (record === null || shared === null || viewerId === null || !canEdit(record.role)) return false;

      const viewerNow: DocViewer = { id: viewerId, name: viewerName ?? 'Anonymous' };
      const state = bytesToBase64(Y.encodeStateAsUpdate(shared));
      setSaving(true);

      try {
        const savedAt = await repository.saveDoc({ id: record.id, state, bodyText: text, viewer: viewerNow });
        sessionRef.current?.announceSaved();
        setFiled({ key, savedAt, saveError: null });

        // The hourly copy for the history, kept by whoever saves once an hour has passed.
        if (lastVersionRef.current === undefined) {
          const versions = await repository.listVersions(record.id).catch(() => []);
          lastVersionRef.current = versions.find((version) => version.name === null)?.createdAt ?? null;
        }
        if (text.trim().length > 0 && versionDue(lastVersionRef.current ?? null, Date.now())) {
          const kept = await repository
            .keepVersion({ docId: record.id, state, snippet: snippetOf(text, 200), name: null, viewer: viewerNow })
            .catch(() => null);
          lastVersionRef.current = kept?.createdAt ?? new Date().toISOString();
        }
        return true;
      } catch (caught: unknown) {
        setFiled((previous) => ({
          key,
          savedAt: previous !== null && previous.key === key ? previous.savedAt : null,
          saveError: caught instanceof Error ? caught.message : 'NOT SAVED.',
        }));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [key, repository, viewerId, viewerName],
  );

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  // A change to the row that does not change who is in the room (title, sharing, board post): drawn in
  // place, so the document and its room stay joined and no unsaved keystroke is dropped.
  const patchRecord = useCallback((patch: Partial<DocRecord>) => {
    if (recordRef.current !== null) recordRef.current = { ...recordRef.current, ...patch };
    setLoaded((previous) =>
      previous === null || previous.record === null ? previous : { ...previous, record: { ...previous.record, ...patch } },
    );
  }, []);
  const noteVersionKept = useCallback((at: string) => {
    lastVersionRef.current = at;
  }, []);

  return {
    record: current?.record ?? null,
    ready: current !== null,
    error: current?.error ?? null,
    doc: current?.doc ?? null,
    awareness: current?.awareness ?? null,
    session: current?.session ?? null,
    peers,
    status,
    identity,
    editing: viewerId !== null && current?.record !== null && current?.record !== undefined && canEdit(current.record.role),
    save,
    saving,
    savedAt: filedNow?.savedAt ?? null,
    saveError: filedNow?.saveError ?? null,
    reload,
    patchRecord,
    noteVersionKept,
  };
}
