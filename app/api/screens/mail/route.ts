import { mailAnswer } from '../../../lib/screens/device-mail';

/**
 * REMOTE from another of the owner's own devices (SPEC-screens.md): one message of the handshake that starts a picture
 * between two of the owner's devices (an ask, an offer, an answer, a no, a stop). Owner only; held in memory until the
 * other device collects it, at most a minute (app/lib/screens/device-mail.ts).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return mailAnswer(request);
}
