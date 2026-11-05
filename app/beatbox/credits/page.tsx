import type { Metadata } from 'next';
import Link from 'next/link';
import SiteWindow from '../../components/SiteWindow';
import { PLATE } from '../../lib/ui/controls';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Beat Box Credits',
  description: "What the beat box is built on: BeepBox's synth and song format, by John Nesky.",
};

const BEEPBOX_LICENCE = `MIT License

Copyright (c) 2012-2024 John Nesky and contributing authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

export default function BeatBoxCreditsPage() {
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [BEATBOX]" active="beatbox" tip="What the beat box is built on.">
      <div className="flex flex-col items-start gap-3 p-3">
        <h1 className="text-headline font-bold text-ink">BEAT BOX CREDITS</h1>
        <p className="text-prose text-ink">
          The sound and the song format are BeepBox, by John Nesky:{' '}
          <a href="https://www.beepbox.co" className="underline" target="_blank" rel="noopener noreferrer">
            beepbox.co
          </a>
        </p>
        <pre className="max-w-full text-label whitespace-pre-wrap text-ink wrap-anywhere">{BEEPBOX_LICENCE}</pre>
        <Link href="/beatbox" className={PLATE}>
          [ BACK TO THE BEAT BOX ]
        </Link>
      </div>
    </SiteWindow>
  );
}
