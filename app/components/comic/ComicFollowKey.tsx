/**
 * Where COMIC's `[ FOLLOW ]` key goes (SPEC-comic.md, Q12): on the contents page and at the end of each chapter.
 *
 * The key itself is NOTIFY's (SPEC-notifications.md, "COMIC interface"): `app/components/ComicFollowKey.tsx`, the COMIC NEW
 * PAGES switch (`notification_prefs.comic`, off by default), shipped with NOTIFY's part. Until that lands there is nothing to
 * switch, so this draws nothing; when it lands, this renders NOTIFY's key in its place.
 */
export default function ComicFollowKey() {
  return null;
}
