/**
 * Which commit this copy of the site was built from, and where it runs (SPEC-self-hosting.md, Stage 5).
 *
 *   GET /api/version  ->  { commit: "<40-hex sha>" | null, host: "pc" | "vercel" | "local" }
 *
 * `npm run deploy-status` asks this to know when a pushed commit is live on debaser.site (Luke's PC rebuilds itself from
 * main). Both values are fixed at build time by next.config.ts: the PC's self-update passes DEBASER_BUILD_COMMIT and
 * DEBASER_HOST; Vercel supplies VERCEL_GIT_COMMIT_SHA. Nothing secret: the commit is public on GitHub.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return Response.json(
    { commit: process.env.DEBASER_BUILD_COMMIT || null, host: process.env.DEBASER_HOST || 'local' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
