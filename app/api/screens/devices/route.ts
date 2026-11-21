import { devicesAnswer } from '../../../lib/screens/device-mail';

/**
 * REMOTE from another of the owner's own devices (SPEC-screens.md): "here I am" from one of the owner's tabs,
 * answered with the owner's other devices on the site now and this one's waiting messages. Owner only; nothing is
 * stored (app/lib/screens/device-mail.ts).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return devicesAnswer(request);
}
