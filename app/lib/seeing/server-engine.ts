'use client';

/**
 * The server's eye, from the browser (SPEC-seeing-machine.md): pages, files and what scripts ask for, each asked of the site with the
 * reader's session, the address in the body. What may be fetched is decided there (`./server/`).
 */
import { sessionHeaders } from '../screens/host-client';
import type { SeeAnswer, SeenDocument, SeeingEngine } from './engine';
import { scriptsOff } from './site-settings';

async function ask(path: string, body: unknown, signal?: AbortSignal): Promise<Response | null> {
  const headers = await sessionHeaders();
  if (headers === null) return null;
  return fetch(`/api/see/${path}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', signal });
}

export const serverEngine: SeeingEngine = {
  name: 'SERVER EYE',
  takes: (address) => /^https?:/.test(address),
  async open(address, onStep, signal): Promise<SeeAnswer> {
    onStep('ACQUIRING SOURCE');
    const response = await ask('open', { address, scripts: !scriptsOff(address) }, signal);
    if (response === null) return { ok: false, reason: 'LOG IN TO OPEN PAGES' };
    onStep('PARSING DOCUMENT STRUCTURE');
    const answer = (await response.json()) as { ok: boolean; reason?: unknown; document?: SeenDocument };
    if (answer.ok && answer.document !== undefined) return { ok: true, document: answer.document };
    return { ok: false, reason: typeof answer.reason === 'string' ? answer.reason : 'SOMETHING WENT WRONG' };
  },
};

export type Reached = { status: number; type: string; url: string; body: ArrayBuffer };

/** What a page's own script asks for. */
export async function reach(page: string, address: string, signal: AbortSignal): Promise<Reached | null> {
  const response = await ask('ask', { page, address }, signal);
  if (response === null || !response.ok) return null;
  return {
    status: Number(response.headers.get('x-see-status')) || 200,
    type: response.headers.get('x-see-type') ?? 'application/octet-stream',
    url: decodeURIComponent(response.headers.get('x-see-url') ?? ''),
    body: await response.arrayBuffer(),
  };
}

/** Signed addresses for files a page's script put on it, in the same order; null for one that is refused. */
export async function sealFiles(page: string, files: { address: string; kind: string }[], signal: AbortSignal): Promise<(string | null)[] | null> {
  const response = await ask('seal', { page, files }, signal);
  if (response === null || !response.ok) return null;
  const answer = (await response.json()) as { addresses?: unknown };
  return Array.isArray(answer.addresses) ? answer.addresses.map((each: unknown) => (typeof each === 'string' ? each : null)) : null;
}
