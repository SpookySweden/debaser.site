'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../components/AuthProvider';
import { useAdmin } from '../../components/ForumModerationControls';
import { setComicViewerAdmin } from './mock-comic-repository';
import { getComicRepository } from './repository';
import type { ComicContents } from './types';

export type ComicState = {
  contents: ComicContents | null;
  error: string | null;
  /**
   * The site's admin: sees unreleased pages and the studio. Since SPEC-moderation.md (2026-11-20) the database's `is_admin()`
   * means "on the moderator list" (Luke's own account first), not the house account, so the screen asks the same list.
   */
  admin: boolean;
  reload: () => Promise<void>;
};

const EMPTY: ComicContents = { volumes: [], chapters: [], pages: [] };

/** The whole comic as this viewer may see it, read once and again on `reload` (after a studio change). */
export function useComic(): ComicState {
  const { status } = useAuth();
  const admin = useAdmin();
  const [contents, setContents] = useState<ComicContents | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setComicViewerAdmin(admin);
    try {
      setContents(await getComicRepository().contents());
      setError(null);
    } catch (caught) {
      setContents(EMPTY);
      setError(caught instanceof Error ? caught.message : 'THE COMIC COULD NOT BE READ.');
    }
  }, [admin]);

  useEffect(() => {
    if (status === 'loading') return;
    let live = true;
    setComicViewerAdmin(admin);
    getComicRepository()
      .contents()
      .then((next) => {
        if (!live) return;
        setContents(next);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!live) return;
        setContents(EMPTY);
        setError(caught instanceof Error ? caught.message : 'THE COMIC COULD NOT BE READ.');
      });
    return () => {
      live = false;
    };
  }, [admin, status]);

  return { contents, error, admin, reload };
}
