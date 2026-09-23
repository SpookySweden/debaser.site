'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { nameColourHex } from '../profile/name-colours';
import { getLoreRepository } from './repository';
import {
  base64ToBytes,
  bytesToBase64,
  createLoreSession,
  type LoreIdentity,
  type LorePeer,
  type LoreSession,
  type LoreStatus,
} from './session';
import type { LorePage } from './types';

export type UseLorePageResult = {
  /** The row as last read, or null when there is no page at that address. */
  page: LorePage | null;
  /** False until the store has answered once. */
  ready: boolean;
  /** The store's own words when it will not answer; null while it is answering. */
  error: string | null;
  /** The shared document, once the row has been read. Null before that, and for a missing page. */
  doc: Y.Doc | null;
  /** The presence state that rides with the document: who is in the room, and where their caret is. */
  awareness: Awareness | null;
  /** Who is in the room, this tab first. */
  peers: LorePeer[];
  /** `SYNCING` until the handshake lands, then `LIVE` or `ALONE`. */
  status: LoreStatus;
  /** Who this tab is in the room: the name that rides on its caret, and the colour it is drawn in. */
  identity: LoreIdentity;
  /** Files the writing as it now stands. Never rejects: the page says what went wrong instead. */
  save: (text: string) => Promise<void>;
  saving: boolean;
  /** The stamp the page carries once a save has landed. */
  savedAt: string | null;
  /** The store's own words when a save was refused. */
  saveError: string | null;
};

/** Who is editing: the account, or null for a reader who is not signed in. */
export type LoreEditor = { id: string; name: string };

/**
 * One lore page: the row, the shared document, and the room it is open in.
 *
 * The three come together and go together - a document with no row to file it against, or a room
 * with no document in it, is of no use to anybody - so they are one hook rather than three. The
 * document is built from the row's own Yjs state, and the room is joined with a session on top of
 * it (see ./session.ts); both are torn down when the reader walks away, which is what drops their
 * caret from everybody else's page.
 *
 * Saving is deliberately not automatic here: the editor knows when it has stopped typing and what
 * its own text says, so the page calls `save` when it means to. A save that is refused is reported
 * rather than thrown, because a page that goes on being edited after a failed save is a page whose
 * next save can still land.
 */
/**
 * The last answer from the store, and what it was an answer about.
 *
 * The key is `slug:editor`, so an answer for the page somebody was reading a moment ago - or for
 * a name they have since changed - is never drawn as if it were the current one. That is also why
 * the hook derives "nothing yet" rather than clearing state when its inputs change: a render where
 * the key does not match is a render with nothing to show, which needs no effect to arrange.
 */
type LorePageLoad = {
  key: string;
  page: LorePage | null;
  error: string | null;
  doc: Y.Doc | null;
  awareness: Awareness | null;
};

export function useLorePage(slug: string, editor: LoreEditor | null): UseLorePageResult {
  const repository = useMemo(() => getLoreRepository(), []);
  const [loaded, setLoaded] = useState<LorePageLoad | null>(null);
  const [peers, setPeers] = useState<LorePeer[]>([]);
  const [status, setStatus] = useState<LoreStatus>('SYNCING');
  const [saving, setSaving] = useState(false);
  const [filed, setFiled] = useState<{ key: string; savedAt: string | null; saveError: string | null } | null>(null);

  const docRef = useRef<Y.Doc | null>(null);
  const pageRef = useRef<LorePage | null>(null);

  const editorId = editor?.id ?? null;
  const editorName = editor?.name ?? null;
  const editorColour = editorId === null ? '#000080' : (nameColourHex(editorId) ?? '#000080');
  const identity: LoreIdentity = { name: editorName ?? 'A VISITOR', colour: editorColour };
  const key = `${slug}:${editorId ?? 'visitor'}`;
  const current = loaded !== null && loaded.key === key ? loaded : null;
  const filedNow = filed !== null && filed.key === key ? filed : null;

  useEffect(() => {
    let cancelled = false;
    let session: LoreSession | null = null;
    let stopPeers: (() => void) | null = null;
    let stopStatus: (() => void) | null = null;
    const loadKey = `${slug}:${editorId ?? 'visitor'}`;

    repository
      .getPage(slug)
      .then((row) => {
        if (cancelled) return;

        pageRef.current = row;

        if (row === null) {
          docRef.current = null;
          setLoaded({ key: loadKey, page: null, error: null, doc: null, awareness: null });
          return;
        }

        // The document the row was filed with. A page nobody has written on yet has no state at
        // all, which is an empty document rather than a failure.
        const shared = new Y.Doc();
        if (row.state.length > 0) Y.applyUpdate(shared, base64ToBytes(row.state), 'stored');

        const presence = new Awareness(shared);
        session = createLoreSession({
          room: repository.openRoom(row.slug),
          doc: shared,
          awareness: presence,
          user: { name: editorName ?? 'A VISITOR', colour: editorColour },
        });

        stopPeers = session.onPeers(setPeers);
        stopStatus = session.onStatus(setStatus);
        docRef.current = shared;
        setLoaded({ key: loadKey, page: row, error: null, doc: shared, awareness: presence });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;

        pageRef.current = null;
        docRef.current = null;
        setLoaded({
          key: loadKey,
          page: null,
          error: caught instanceof Error ? caught.message : 'THE LORE SHELF DID NOT ANSWER.',
          doc: null,
          awareness: null,
        });
      });

    return () => {
      cancelled = true;
      stopPeers?.();
      stopStatus?.();
      session?.destroy();
      docRef.current?.destroy();
      docRef.current = null;
    };
  }, [editorColour, editorId, editorName, repository, slug]);

  const save = useCallback(
    async (text: string) => {
      const page = pageRef.current;
      const shared = docRef.current;

      if (page === null || shared === null) return;

      setSaving(true);

      try {
        const row = await repository.savePage({
          id: page.id,
          state: bytesToBase64(Y.encodeStateAsUpdate(shared)),
          bodyText: text,
          editorId,
          editorName: editorName ?? 'Anonymous',
        });

        pageRef.current = row;
        setFiled({ key, savedAt: row.updatedAt, saveError: null });
      } catch (caught: unknown) {
        setFiled((previous) => ({
          key,
          savedAt: previous !== null && previous.key === key ? previous.savedAt : null,
          saveError: caught instanceof Error ? caught.message : 'THE PAGE COULD NOT BE FILED.',
        }));
      } finally {
        setSaving(false);
      }
    },
    [editorId, editorName, key, repository],
  );

  return {
    page: current?.page ?? null,
    ready: current !== null,
    error: current?.error ?? null,
    doc: current?.doc ?? null,
    awareness: current?.awareness ?? null,
    peers,
    status,
    identity,
    save,
    saving,
    savedAt: filedNow?.savedAt ?? null,
    saveError: filedNow?.saveError ?? null,
  };
}
