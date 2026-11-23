'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { browserHref, readAddress } from '../lib/seeing/address';
import { askToSee } from '../lib/seeing/ask';
import { PLATE } from '../lib/ui/controls';
import { MODULES, moduleIsOn } from '../lib/ui/modules';
import { modulesState, serverModules, subscribeToModules } from '../lib/ui/modules-slot';

/**
 * `[ SEE ]` beside an outside link (SPEC-seeing-machine.md, idea viii): opens it in BROWSER. Drawn only for somebody whose bar has
 * BROWSER on it; the link itself is unchanged. The address travels after the `#`, and this press is what opens it there.
 */
export default function SeeKey({ href, small = false }: { href: string; small?: boolean }) {
  const choices = useSyncExternalStore(subscribeToModules, modulesState, serverModules);
  const browser = MODULES.find((module) => module.key === 'browser');
  if (browser === undefined || !moduleIsOn(browser, choices)) return null;
  const read = readAddress(href);
  if (!read.ok || !/^https?:/.test(read.address)) return null;
  return (
    <Link href={browserHref(read.address)} onClick={() => askToSee(read.address)} prefetch={false} aria-label={`See ${read.address} in BROWSER`} title="Open it in BROWSER" className={`${PLATE} ${small ? 'align-baseline' : ''}`} data-see-key>
      [ SEE ]
    </Link>
  );
}

const ADDRESS = /https?:\/\/[^\s<>"']{4,300}/gi;
/** What is the sentence's and not the address's: a full stop, and a bracket the address did not open. */
function trimmed(address: string): string {
  let text = address.replace(/[.,;:!?]+$/, '');
  while (text.endsWith(')') && (text.match(/\)/g) ?? []).length > (text.match(/\(/g) ?? []).length) text = text.slice(0, -1).replace(/[.,;:!?]+$/, '');
  return text;
}

/** The SEE keys for the addresses written in somebody's words, a few at most. */
export function SeeKeysIn({ text }: { text: string }) {
  const found = [...new Set((text.match(ADDRESS) ?? []).map(trimmed))].slice(0, 3);
  return found.map((each) => <SeeKey key={each} href={each} small />);
}
