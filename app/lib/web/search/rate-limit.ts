/**
 * A small per-address limit for the search routes. In memory, so it is per server instance: on Vercel
 * each warm instance keeps its own count. That is enough to stop one visitor hammering the platforms
 * through us; the day-long fetch cache (cached-fetch.ts) keeps repeats free anyway.
 */
export type RateLimiter = { allow(key: string, now?: number): boolean };

const MAX_KEYS = 5_000;

export function makeRateLimiter(limit: number, windowMs: number): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    allow(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.delete(key);
      hits.set(key, recent);
      // Oldest first in a Map: drop the longest-quiet addresses once there are too many.
      while (hits.size > MAX_KEYS) hits.delete(hits.keys().next().value as string);
      return true;
    },
  };
}

/**
 * The caller's address as Vercel reports it, or one shared bucket. Vercel sets `x-real-ip` and overwrites
 * `x-forwarded-for` itself, so neither can be chosen by the caller there. An IPv6 address counts by its /64,
 * the block one household or server gets, so rotating through it does not buy fresh searches.
 */
export function clientAddress(headers: Headers): string {
  const real = headers.get('x-real-ip')?.trim();
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const address = (real || forwarded || 'unknown').slice(0, 64).toLowerCase();
  if (!address.includes(':')) return address;
  const [head] = address.split('::');
  // Fewer than four groups before '::' means the rest of the /64 is zeros.
  const groups = head.split(':').filter((group) => group.length > 0);
  return `${[...groups, '0', '0', '0', '0'].slice(0, 4).join(':')}::/64`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

type Budgeted = { platform: string; dailyBudget?: { perAddress: number; perInstance: number } };

/**
 * Daily budgets for the quota-limited providers, per address and per instance, both in memory (so per warm
 * instance on Vercel). Returns, for one caller, the `spendBudget` a search hands its providers. A count shared
 * across instances would need a table; this keeps one visitor from spending a platform's whole day.
 */
export function makeDailyBudgets(providers: readonly Budgeted[]): (address: string) => (platform: string) => boolean {
  const limits = new Map<string, { address: RateLimiter; instance: RateLimiter }>();
  for (const provider of providers) {
    if (!provider.dailyBudget) continue;
    limits.set(provider.platform, {
      address: makeRateLimiter(provider.dailyBudget.perAddress, DAY_MS),
      instance: makeRateLimiter(provider.dailyBudget.perInstance, DAY_MS),
    });
  }
  return (address) => (platform) => {
    const limit = limits.get(platform);
    if (!limit) return true;
    // The address is asked first, so a visitor over their own budget does not use up the instance's.
    return limit.address.allow(address) && limit.instance.allow('all');
  };
}
