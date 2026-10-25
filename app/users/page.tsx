import type { Metadata } from 'next';
import SiteWindow from '../components/SiteWindow';
import UserDirectory from '../components/UserDirectory';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Users',
  description: 'Every account on the site with its online lamp: the house account first, as admin.',
};

export default function UsersPage() {
  return (
    <SiteWindow
      title="DEBASER_OS - v1.0 [USERS]"
      active="users"
      tip="Every account."
    >
    <h1 className="sr-only">DEBASER.SITE // USER DIRECTORY</h1>

    <UserDirectory />
    </SiteWindow>
  );
}
