import type { Metadata } from 'next';
import CommsConsole from '../components/CommsConsole';
import SiteWindow from '../components/SiteWindow';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Comms',
  description: 'Conversations between accounts - direct messages and groups - listed down the left with the open one on the right.',
};

export default function CommsPage() {
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [COMMS]" active="comms" status="Comms Online">
    <h1 className="text-3xl font-bold mb-2">DEBASER.SITE // COMMS</h1>
    <p className="text-xs mb-4 leading-relaxed">
      Conversations between accounts: direct messages and groups, listed down the left with the open one on
      the right. A message that arrives while the site is open pops up as a small window on a desktop, and
      takes a phone straight here. Every conversation is stored in Supabase, so two machines can reach
      each other - the mock store, for local work, keeps one inside a single browser.
    </p>

    <CommsConsole />
    </SiteWindow>
  );
}
