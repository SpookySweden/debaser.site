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
      tip="Every account the site knows about, with a lamp that says whether anybody is behind it: green while a tab is open, yellow for the hour after it closes, red after that. debaser.site is listed first as the house account. Each name opens that account's public profile."
    >
    <h1 className="sr-only">DEBASER.SITE // USER DIRECTORY</h1>

    <UserDirectory />
    </SiteWindow>
  );
}
