import type { Metadata } from 'next';
import SiteWindow from '../components/SiteWindow';
import UnsubscribePanel from '../components/UnsubscribePanel';

export const metadata: Metadata = {
  title: 'Weekly email',
  description: 'Turn the DEBASER_OS weekly email off, or back on.',
  robots: { index: false },
};

/** Where the weekly email's `[ TURN OFF WEEKLY EMAIL ]` lands (SPEC-notifications.md, 10A). */
export default function UnsubscribePage() {
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [WEEKLY EMAIL]" active="forum">
      <h1 className="sr-only">DEBASER.SITE // WEEKLY EMAIL</h1>
      <UnsubscribePanel />
    </SiteWindow>
  );
}
