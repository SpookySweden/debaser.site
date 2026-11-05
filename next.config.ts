import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Hand-drawn artwork lives in the project `assets/` folder (never in
   * `public/`) and is streamed by `app/assets/[...path]/route.ts`. The route
   * reads its files with `fs` at request time, so the deployment trace has to
   * be told to ship the folder with it.
   */
  outputFileTracingIncludes: {
    "/assets/[...path]": ["./assets/**/*"],
  },

  /**
   * Uploaded profile pictures go to Supabase Storage once profiles live there,
   * and `next/image` has to be told which hosts it may fetch from. The path is
   * narrowed to the public object route, so the optimiser is not pointed at the
   * rest of the project's API.
   */
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },

  /**
   * The search page was WEB at /web, then ARCHIVE at /archive, and is MEDIA at /media (Luke, 2026-11-04). Every old
   * address still lands on it: bookmarks, shared searches (the query comes along, so `/web?q=x` opens `/media?q=x`), and
   * the music bar's "where this came from" saved in a browser before the move. Permanent, so browsers
   * and search engines learn the new address. The page's API routes stay at /api/web/*.
   *
   * The catalogue was MEDIA at /media and is FILES at /files. Its old addresses always named a section, a category or a
   * tag (`kind`, `cat`, `tag`, which the search page does not use), so those go to /files; a bare /media is the search page.
   *
   * The page for watching together was CYTUBE at /cytube and is STREAM at /stream (Luke, 2026-11-04); `?tab=` comes along.
   */
  async redirects() {
    return [
      { source: '/web', destination: '/media', permanent: true },
      { source: '/archive', destination: '/media', permanent: true },
      // DISCOVER was TAG STATION until 2026-11-05 (SPEC-discover.md). A shared search keeps its address's query.
      { source: '/tag-station', destination: '/discover', permanent: true },
      { source: '/cytube', destination: '/stream', permanent: true },
      ...['kind', 'cat', 'tag'].map((key) => ({ source: '/media', has: [{ type: 'query' as const, key }], destination: '/files', permanent: true })),
    ];
  },
};

export default nextConfig;
