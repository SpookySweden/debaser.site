'use client';

import { getAuthRepository } from '../auth/auth-repository';

/**
 * Account names for HISTORY's "ADDED BY" (SPEC-history.md): read once a visit from the account list the user directory
 * already uses (`account_list`, callable with the public key), kept here, and looked up without waiting. A name not in
 * it yet reads as nothing, and the line says SOMEONE: a play is never held up for a name.
 */

let names: Map<string, string> | null = null;
let reading: Promise<void> | null = null;

export function loadAccountNames(): Promise<void> {
  if (names !== null) return Promise.resolve();
  if (reading !== null) return reading;
  const list = getAuthRepository().listAccounts?.();
  reading = (list ?? Promise.resolve([]))
    .then((accounts) => {
      names = new Map(accounts.map((account) => [account.id, account.displayName]));
    })
    .catch(() => {
      reading = null;
    });
  return reading;
}

export function accountName(id: string | null | undefined): string {
  if (!id) return '';
  return names?.get(id) ?? '';
}
