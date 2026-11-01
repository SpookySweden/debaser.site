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
};

export default nextConfig;
