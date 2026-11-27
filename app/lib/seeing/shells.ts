/**
 * Sites the server's eye can't show (Luke, 2026-11-27: "youtube itself looks kinda messed up just white with gray boxes"): they draw themselves with
 * scripts that ask for more than a signed-out server is given, and their videos never pass through the server, by rule. Said plainly, with OWN EYE.
 */
export const SHELL_SITES = ['youtube.com', 'youtu.be', 'x.com', 'twitter.com', 'instagram.com', 'facebook.com', 'tiktok.com'] as const;

export function shellOf(address: string | null): string | null {
  if (address === null || !/^https?:/.test(address)) return null;
  try {
    const host = new URL(address).hostname.toLowerCase().replace(/\.$/, '');
    return SHELL_SITES.find((site) => host === site || host.endsWith(`.${site}`)) ?? null;
  } catch {
    return null;
  }
}
