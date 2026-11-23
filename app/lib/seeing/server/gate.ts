/**
 * Who may use the server's eye (SPEC-seeing-machine.md): the off switch, whose account it is, and who it is open to. SERVER ONLY.
 *
 *   SEEING_MACHINE=off   the server's eye is off for everybody, at once
 *   SEEING_OPEN          `accounts` opens it to everyone with an account (D2). Anything else, or unset: the owner's account only. Set by
 *                        Luke, after the attack list has passed for real on SERVER and he has looked.
 *   SEEING_OWNER_ID      the owner's account; unset, SCREENS_OWNER_ID is it
 *   SEEING_EXIT          the way out (`./way-out.ts`)
 *   SEEING_ASSET_ORIGIN  where signed assets are served from (`https://see.debaser.site` when that exists); unset, the site itself
 *
 * Who is asking comes from the session token only, checked with the auth server before anything else is read (backend.md). With the mock
 * accounts there is no session to check, so it is off, with the one exception SCREENS has too: a server that is not a production one,
 * started with SEEING_DEV_OPEN=1, treats whoever asks as the owner, for the local drives. A production build can never do that.
 */
import { authIsSupabase, ownerId, realDeps } from '../../screens/host-server';

export type SeeingEnv = Record<string, string | undefined>;
export type GateDeps = { env: SeeingEnv; accountOf: (token: string) => Promise<string | null> };

export type Gate = { ok: true; person: string } | { ok: false; status: number; reason: string };

const DEV_PERSON = 'dev';

export function isOff(env: SeeingEnv): boolean {
  return (env.SEEING_MACHINE ?? '').trim().toLowerCase() === 'off';
}

function devOpen(env: SeeingEnv): boolean {
  return env.NODE_ENV !== 'production' && env.SEEING_DEV_OPEN === '1' && !authIsSupabase(env);
}

export function seeingOwner(env: SeeingEnv): string | null {
  const own = (env.SEEING_OWNER_ID ?? '').trim().toLowerCase();
  return /^[0-9a-f-]{36}$/.test(own) ? own : ownerId(env);
}

/** The same answer whether the eye is off, not open to them, or not there: a reader is told only that they can't. */
const NOT_OPEN: Gate = { ok: false, status: 403, reason: 'THE MACHINE HAS NO EYE YET' };

export async function whoMaySee(request: Request, deps: GateDeps): Promise<Gate> {
  if (isOff(deps.env)) return { ok: false, status: 503, reason: 'THE MACHINE IS OFF' };
  if (devOpen(deps.env)) return { ok: true, person: DEV_PERSON };
  if (!authIsSupabase(deps.env)) return NOT_OPEN;
  const token = /^Bearer ([\w.-]{20,4000})$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (token === undefined) return { ok: false, status: 401, reason: 'LOG IN TO OPEN PAGES' };
  const person = (await deps.accountOf(token))?.toLowerCase() ?? null;
  if (person === null) return { ok: false, status: 401, reason: 'LOG IN TO OPEN PAGES' };
  if ((deps.env.SEEING_OPEN ?? '').trim() === 'accounts') return { ok: true, person };
  return person === seeingOwner(deps.env) ? { ok: true, person } : NOT_OPEN;
}

/** Whether a pass still stands for its person: the off switch and the owner-only rule reach pages already open. */
export function passStands(person: string, env: SeeingEnv): boolean {
  if (isOff(env)) return false;
  if (devOpen(env)) return person === DEV_PERSON;
  if (!authIsSupabase(env)) return false;
  return (env.SEEING_OPEN ?? '').trim() === 'accounts' || person === seeingOwner(env);
}

export function realGate(): GateDeps {
  const screens = realDeps();
  return {
    env: {
      ...screens.env,
      SEEING_MACHINE: process.env.SEEING_MACHINE,
      SEEING_OPEN: process.env.SEEING_OPEN,
      SEEING_OWNER_ID: process.env.SEEING_OWNER_ID,
      SEEING_EXIT: process.env.SEEING_EXIT,
      SEEING_ASSET_ORIGIN: process.env.SEEING_ASSET_ORIGIN,
      SEEING_DEV_OPEN: process.env.SEEING_DEV_OPEN,
    },
    accountOf: screens.accountOf,
  };
}
