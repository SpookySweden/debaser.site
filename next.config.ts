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
};

export default nextConfig;
