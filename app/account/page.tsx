import type { Metadata } from 'next';
import AccountConsole from '../components/AccountConsole';
import SiteWindow from '../components/SiteWindow';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Account Manager',
  description: 'Create an account, log in and manage your Debaser profile and session.',
};

export default function Account() {
  return (
    <SiteWindow
      title="DEBASER_OS - v1.0 [ACCOUNT MANAGER]"
      active="account"
      tip="Create an account, log in, and manage how your posts are signed on the board. Reading and posting stay open to guests - an account just attaches your name to whatever you file."
    >
    <h1 className="sr-only">DEBASER.SITE // ACCOUNT MANAGER</h1>

    <AccountConsole />
    </SiteWindow>
  );
}
