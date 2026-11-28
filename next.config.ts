import { existsSync } from "node:fs";
import type { NextConfig } from "next";

/**
 * The art slots whose missing file used to be asked for anyway (a 404 on every guest's page, review fixes 2026-11-17).
 * The build looks on disk and tells the browser code which of these exist (`app/lib/ui/art/on-disk.ts`), so a slot
 * shows its text stand-in without asking, and the day Luke drops his drawing in, the next build shows it.
 */
const ART_WATCHED = [
  "/assets/profiles/avatar-default.png",
  "/assets/icons/google-retro.png",
  // What a MEDIA result is, where it has no picture (app/components/MediaKindMark.tsx).
  ...["video", "audio", "image", "text", "film", "live", "other"].map((kind) => `/assets/media-kinds/${kind}.png`),
];

const nextConfig: NextConfig = {
  env: {
    ART_ON_DISK: ART_WATCHED.filter((path) => existsSync(`.${path}`)).join(","),
    // Read by /api/version, so `npm run deploy-status` can tell which commit debaser.site is running (SPEC-self-hosting.md).
    DEBASER_BUILD_COMMIT: process.env.DEBASER_BUILD_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "",
    DEBASER_HOST: process.env.DEBASER_HOST ?? (process.env.VERCEL ? "vercel" : "local"),
  },

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
      // The self-hosted Supabase on Luke's PC, through the Cloudflare tunnel (SPEC-self-hosting.md).
      {
        protocol: 'https',
        hostname: 'api.debaser.site',
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
      // The site lives at debaser.site on Luke's PC since 2026-11-18 (SPEC-self-hosting.md); the Vercel copy is kept as the
      // way back and sends its visitors on, path and query included. Temporary (307), so browsers don't remember it and
      // going back to Vercel stays possible. Matches only the production address, so Vercel's preview addresses still work.
      { source: '/:path*', has: [{ type: 'host' as const, value: 'debaser-site.vercel.app' }], destination: 'https://debaser.site/:path*', permanent: false },
      { source: '/web', destination: '/media', permanent: true },
      { source: '/archive', destination: '/media', permanent: true },
      // DISCOVER was TAG STATION until 2026-11-05 (SPEC-discover.md). A shared search keeps its address's query.
      { source: '/tag-station', destination: '/discover', permanent: true },
      { source: '/cytube', destination: '/stream', permanent: true },
      ...['kind', 'cat', 'tag'].map((key) => ({ source: '/media', has: [{ type: 'query' as const, key }], destination: '/files', permanent: true })),
    ];
  },

  /**
   * REMOTE's slowest way, THROUGH THE SITE (SPEC-screens.md, "Away from home with no setup"; Luke, 2026-11-28: "Build,
   * capped, 20 GB (Recommended)"). The browser opens ONE websocket on the site's own address, and the site's program
   * only passes it along to a gateway on the same PC (`scripts/host/screens-site-gateway.cjs`, 127.0.0.1 only). That
   * is why no tunnel rule is needed: the tunnel already carries the site's address.
   *
   * HIDDEN (2026-11-28): no page asks for this address, and the gateway is not kept running. When it does run (inside
   * a check or a measurement) it gives nothing to anyone without a pass: the owner's, from `/api/screens/site-way`,
   * good for a minute and once; or, as the measuring gate, that run's one-time words. With no gateway running, this
   * address answers with an error and nothing else.
   *
   * Not on the Vercel copy: there is no gateway there to pass anything to.
   */
  async rewrites() {
    if (process.env.VERCEL) return [];
    return [{ source: '/api/screens/site-socket', destination: 'http://127.0.0.1:8481/api/screens/site-socket' }];
  },
};

export default nextConfig;
