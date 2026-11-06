import { createHash, createHmac } from 'node:crypto';

/**
 * Where the pool's compressed files live (pool-files.ts): Supabase Storage, or Cloudflare R2 once its four server-only settings are present in Vercel. With them, new files go to R2, and
 * reading tries R2 first and then Supabase, so files already written stay readable and nothing has to move. If R2 refuses a write, the file goes to Supabase instead. SERVER ONLY: nothing
 * here reaches a browser, the R2 bucket stays private, and whoever calls this has checked the session or the job's lock first.
 *
 * Signed by hand with S3's own scheme (it's 40 lines) rather than through Amazon's SDK, which is a large package for three kinds of call.
 */

export type PoolFileStore = {
  put(path: string, file: Uint8Array): Promise<void>;
  /** Null: no such file. */
  get(path: string): Promise<Uint8Array | null>;
  remove(path: string): Promise<void>;
};

export type R2Settings = { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string };

/** All four, or none: half set up means Supabase Storage. */
export function r2Settings(env: Record<string, string | undefined> = process.env): R2Settings | null {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = env.R2_BUCKET?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
const hmac = (key: Uint8Array | string, data: string) => createHmac('sha256', key).update(data, 'utf8').digest();

/** S3's signature version 4, for one call with no query string. Pure, so a check can hold it to Amazon's own published example. */
export function signS3(request: { method: string; host: string; path: string; region: string; bodyHash: string; at: Date; accessKeyId: string; secretAccessKey: string; extraHeaders?: Record<string, string> }): Record<string, string> {
  const stamp = request.at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = stamp.slice(0, 8);
  const headers: Record<string, string> = { host: request.host, 'x-amz-content-sha256': request.bodyHash, 'x-amz-date': stamp, ...request.extraHeaders };
  const names = Object.keys(headers).sort();
  const canonical = [request.method, request.path, '', ...names.map((name) => `${name}:${headers[name].trim()}`), '', names.join(';'), request.bodyHash].join('\n');
  const scope = `${day}/${request.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${request.secretAccessKey}`, day), request.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign, 'utf8').digest('hex');
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${request.accessKeyId}/${scope},SignedHeaders=${names.join(';')},Signature=${signature}` };
}

const encodedKey = (path: string) => path.split('/').map(encodeURIComponent).join('/');

export function r2Store(settings: R2Settings, fetchImpl: typeof fetch = fetch, now: () => Date = () => new Date()): PoolFileStore {
  const host = `${settings.accountId}.r2.cloudflarestorage.com`;
  const call = (method: string, path: string, body?: Uint8Array) => {
    const key = `/${encodeURIComponent(settings.bucket)}/${encodedKey(path)}`;
    const headers = signS3({ method, host, path: key, region: 'auto', bodyHash: sha256(body ?? ''), at: now(), accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey });
    const { host: _host, ...sent } = headers;
    return fetchImpl(`https://${host}${key}`, { method, headers: sent, ...(body ? { body: Buffer.from(body) } : {}), signal: AbortSignal.timeout(30_000) });
  };
  return {
    put: async (path, file) => {
      const answer = await call('PUT', path, file);
      if (!answer.ok) throw new Error('POOL_STORE');
    },
    get: async (path) => {
      const answer = await call('GET', path);
      if (answer.status === 404) return null;
      if (!answer.ok) throw new Error('POOL_STORE');
      return new Uint8Array(await answer.arrayBuffer());
    },
    remove: async (path) => {
      const answer = await call('DELETE', path);
      if (!answer.ok && answer.status !== 404) throw new Error('POOL_STORE');
    },
  };
}

/** R2 first when it's set up, with Supabase Storage behind it. With no settings, this is just the Supabase store. */
export function poolStoreWith(supabase: PoolFileStore, r2: PoolFileStore | null): PoolFileStore {
  if (r2 === null) return supabase;
  return {
    put: async (path, file) => {
      try {
        await r2.put(path, file);
      } catch {
        await supabase.put(path, file);
      }
    },
    get: async (path) => {
      const found = await r2.get(path).catch(() => null);
      return found ?? supabase.get(path);
    },
    // From both: a file can be in either, and a failure here only leaves a file behind.
    remove: async (path) => {
      await Promise.allSettled([r2.remove(path), supabase.remove(path)]);
    },
  };
}

export function poolStore(supabase: PoolFileStore, env: Record<string, string | undefined> = process.env): PoolFileStore {
  const settings = r2Settings(env);
  return poolStoreWith(supabase, settings === null ? null : r2Store(settings));
}
