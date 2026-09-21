import type { Metadata } from 'next';
import CommsConsole from '../components/CommsConsole';
import SiteWindow from '../components/SiteWindow';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Comms',
  description: 'Direct messages between accounts: conversations down the left, the open thread on the right.',
};

export default function CommsPage() {
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [COMMS]" active="comms" status="Comms Online">
    <h1 className="text-3xl font-bold mb-2">DEBASER.SITE // COMMS</h1>
    <p className="text-xs mb-4 leading-relaxed">
      Direct messages between accounts: conversations down the left, the open one on the right. A message
      that arrives while the site is open pops up as a small window on a desktop, and takes a phone straight
      here. While the store is the mock one every conversation lives in this browser only - Supabase brings
      the real thing, and with it messages between two different machines.
    </p>

    <CommsConsole />
    </SiteWindow>
  );
}
