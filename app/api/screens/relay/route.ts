import { relayAnswer } from '../../../lib/screens/relay-server';

/**
 * SCREENS: the relay key (Cloudflare TURN), owner only. GET says whether one is set; POST saves one typed into the
 * room's RELAY KEY form, after Cloudflare has accepted it, into the file on the PC that serves the site. Nothing of
 * it is answered back. Rules in `app/lib/screens/relay-server.ts`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return relayAnswer(request);
}

export async function POST(request: Request): Promise<Response> {
  return relayAnswer(request);
}
