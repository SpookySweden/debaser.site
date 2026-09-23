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
    <h1 className="text-xl font-bold mb-2">DEBASER.SITE // COMMS</h1>
    <p className="text-xs mb-4 leading-relaxed">
      Direct messages and group chats, listed down the left with the open one on the right. A message that
      arrives while the site is open pops up on a desktop, and takes a phone straight here.
    </p>

    <CommsConsole />
    </SiteWindow>
  );
}
