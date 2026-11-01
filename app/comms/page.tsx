import type { Metadata } from 'next';
import CommsConsole from '../components/CommsConsole';
import SiteWindow from '../components/SiteWindow';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Comms',
  description: 'Conversations between accounts - direct messages and groups - listed down the left with the open one on the right.',
};

export default function CommsPage() {
  return (
    <SiteWindow
      title="DEBASER_OS - v1.0 [COMMS]"
      active="comms"
      tip="Direct messages and groups."
    >
    <h1 className="sr-only">DEBASER.SITE // COMMS</h1>

    <CommsConsole />
    </SiteWindow>
  );
}
