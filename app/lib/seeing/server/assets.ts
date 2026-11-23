/**
 * Signed assets (SPEC-seeing-machine.md): a page's pictures, styles, fonts and scripts can't send a sign-in token, so each address the
 * rewriter writes carries a pass instead: what to fetch, for whom, as what, until when. No pass, no fetch: it is never an open proxy.
 *
 * A pass is sealed (AES-256-GCM) rather than signed in the open, so the address a person looks at is not in any URL that reaches
 * Cloudflare's or the site's logs; a seal that was altered does not open. The key is made when the process starts and never leaves it, so
 * a pass also ends when the site restarts. SERVER ONLY.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const PASS_LASTS_MS = 60 * 60_000;

/** What an asset is being fetched as: which types may answer, and what may be done with them. */
export const ASSET_KINDS = ['picture', 'style', 'font', 'script', 'module', 'data'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export type AssetPass = { address: string; person: string; kind: AssetKind; until: number };

const holder = globalThis as typeof globalThis & { debaserSeeingKey?: Buffer };
const processKey = (): Buffer => (holder.debaserSeeingKey ??= randomBytes(32));

export function sealPass(pass: AssetPass, key: Buffer = processKey()): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const sealed = Buffer.concat([cipher.update(JSON.stringify([pass.kind, pass.until, pass.person, pass.address]), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), sealed]).toString('base64url');
}

/** The pass, or null for one that was altered, made up, out of date, or sealed before the process started. */
export function openPass(text: string, now: number, key: Buffer = processKey()): AssetPass | null {
  if (text.length > 8000 || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const bytes = Buffer.from(text, 'base64url');
  if (bytes.length < 29) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12), { authTagLength: 16 });
    decipher.setAuthTag(bytes.subarray(12, 28));
    const [kind, until, person, address] = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')) as [AssetKind, number, string, string];
    if (!ASSET_KINDS.includes(kind) || typeof until !== 'number' || typeof person !== 'string' || typeof address !== 'string') return null;
    return until > now ? { kind, until, person, address } : null;
  } catch {
    return null;
  }
}

/** The types each kind may answer with: never HTML, never video or sound. */
export const ASSET_TYPES: Record<AssetKind, RegExp> = {
  picture: /^image\/(?:png|jpeg|jpg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)$/,
  style: /^text\/css$/,
  font: /^(?:font\/(?:woff2?|ttf|otf|sfnt|collection)|application\/(?:font-woff2?|x-font-(?:ttf|woff|otf|opentype|truetype)|vnd\.ms-fontobject|octet-stream))$/,
  script: /^(?:text|application)\/(?:javascript|x-javascript|ecmascript)$/,
  module: /^(?:text|application)\/(?:javascript|x-javascript|ecmascript)$/,
  // A script's own requests: what it reads, as bytes, never as a document of ours.
  data: /^(?:application\/(?:[\w.+-]*json|javascript|x-ndjson|xml|[\w.+-]*\+xml|octet-stream)|text\/(?:plain|html|xml|csv|javascript|x-component))$/,
};

/** A font sent as plain bytes is a font only if it starts as one. */
const FONT_STARTS = ['wOFF', 'wOF2', 'OTTO', 'true', 'ttcf', '\u0000\u0001\u0000\u0000'];
export function looksLikeFont(body: Uint8Array): boolean {
  return FONT_STARTS.includes(Buffer.from(body.subarray(0, 4)).toString('latin1'));
}

/** Bytes that say they are a picture and begin as a document or a program are neither shown nor passed on. */
export function looksLikeMarkup(body: Uint8Array): boolean {
  return /^\s*(?:<!doctype|<html|<head|<body|<script|<iframe|<!--)/i.test(Buffer.from(body.subarray(0, 512)).toString('latin1').replace(/^ï»¿/, ''));
}

/**
 * What every asset is answered with. Opened by itself it is a download of nothing that runs: no type guessing, a policy that lets nothing
 * load and takes any origin away (a picture may be an SVG with a script in it), nothing kept by a shared cache, no address passed on.
 */
export function assetHeaders(type: string): Record<string, string> {
  return {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'Content-Disposition': 'attachment; filename="asset"',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    // A frame with no origin asks as 'null'; fonts and scripts need to be told that is allowed. Nothing here depends on who asks but the pass.
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'private, max-age=600',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex',
  };
}
