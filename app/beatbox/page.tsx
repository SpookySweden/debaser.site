import type { Metadata } from 'next';
import BeatBoxLoader from '../components/BeatBoxLoader';
import SiteWindow from '../components/SiteWindow';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Beat Box',
  description: 'A music maker with loop recording, on BeepBox songs: the loop keeps going round while you record over it.',
};

/**
 * The beat box (app/features/beatbox/README.txt): open to everyone, signed in or not. The synth is large and
 * needs a browser, so it loads on this page only, on the client.
 */
export default function BeatBoxPage() {
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [BEATBOX]" active="beatbox" tip="A music maker with loop recording." fill>
      <h1 className="sr-only">DEBASER.SITE // BEAT BOX</h1>
      <BeatBoxLoader />
    </SiteWindow>
  );
}
