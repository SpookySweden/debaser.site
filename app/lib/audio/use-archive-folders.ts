'use client';

import { useCallback, useEffect, useState } from 'react';
import { type FolderPath } from './archive-tree';
import { getMusicRepository, type MusicFolder } from './repository';

export type UseArchiveFoldersResult = {
  /** The folders anybody has made, A to Z. */
  folders: MusicFolder[];
  /** False until the folders have been read once. */
  ready: boolean;
  /**
   * Makes the folder at that whole path (or takes the one that is already there) and re-reads
   * the list, so a path somebody else made while this page was open appears as well.
   */
  create: (path: FolderPath, creator: { id: string; displayName: string }) => Promise<MusicFolder>;
  /** Re-reads the list. */
  refresh: () => Promise<void>;
};

/**
 * The archive's folders, as the browser reads them.
 *
 * Kept away from the page for the same reason the listing is kept away from it: what a folder
 * is and where it lives is not a drawing concern, and a store that cannot be reached is an
 * empty list rather than a broken page - the catalogue's own folders are implied by the files
 * it ships, so the directory still reads correctly with no folder table at all.
 */
export function useArchiveFolders(): UseArchiveFoldersResult {
  const [folders, setFolders] = useState<MusicFolder[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // `listFolders` never throws, so there is no failure to draw: an empty list is the answer.
    void getMusicRepository()
      .listFolders()
      .then((next) => {
        if (cancelled) return;
        setFolders(next);
        setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    setFolders(await getMusicRepository().listFolders());
  }, []);

  const create = useCallback<UseArchiveFoldersResult['create']>(async (path, creator) => {
    const folder = await getMusicRepository().createFolder({
      path,
      creatorId: creator.id,
      creatorName: creator.displayName,
    });

    setFolders(await getMusicRepository().listFolders());

    return folder;
  }, []);

  return { folders, ready, create, refresh };
}
