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
   * WEB became ARCHIVE and moved from /web to /archive (Luke, 2026-11-03). Every old address still lands on
   * the page: bookmarks, shared searches (the query comes along, so `/web?q=x` opens `/archive?q=x`), and
   * the music bar's "where this came from" saved in a browser before the move. Permanent, so browsers
   * and search engines learn the new address. The page's API routes stay at /api/web/*.
   */
  async redirects() {
    return [{ source: '/web', destination: '/archive', permanent: true }];
  },
};

export default nextConfig;
