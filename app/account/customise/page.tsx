import type { Metadata } from 'next';
import Link from 'next/link';
import CustomiserHost from '../../components/CustomiserHost';
import SiteNav from '../../components/SiteNav';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Customise Public Profile',
  description: 'The full-page view of the account profile customiser.',
};

/**
 * The customiser as a page rather than a pop-up.
 *
 * It renders the same console the account page opens in a window, so the panel
 * can be linked to directly (and still works with the pop-up blocked).
 */
export default function CustomiseProfilePage() {
  return (
    <main className="min-h-screen bg-[#008080] p-4 font-mono select-none flex items-center justify-center">
      <div className="w-[95vw] h-[92vh] bg-[#c0c0c0] border-t-2 border-l-2 border-white border-r-2 border-b-2 border-black flex flex-col shadow-2xl rounded-none">

        {/* Title Bar */}
        <div className="bg-[#000080] text-white px-3 py-1 flex justify-between items-center font-bold text-sm">
          <span>DEBASER_OS - v1.0 [CUSTOMISE PUBLIC PROFILE]</span>
          <div className="flex gap-1">
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">_</button>
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">□</button>
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">×</button>
          </div>
        </div>

        {/* Taskbar Navigation */}
        <SiteNav active="account" />

        {/* Content Body - Customiser */}
        <div className="flex-1 bg-white border-inset border-2 border-gray-600 m-2 p-4 overflow-y-auto text-black">
          <h1 className="text-3xl font-bold mb-2">CUSTOMISE PUBLIC PROFILE</h1>
          <p className="text-xs mb-2 leading-relaxed">
            Style the page other people see when they click your username or your picture on the board. Sign in first -
            this console writes to the signed-in account.
          </p>
          <p className="text-xs mb-4 leading-relaxed">
            <Link href="/account" className="underline hover:bg-gray-300">
              [ BACK TO THE ACCOUNT PAGE ]
            </Link>
          </p>

          <CustomiserHost />
        </div>

        {/* Status Bar */}
        <div className="px-3 py-1 text-xs bg-[#c0c0c0] border-t border-white flex justify-between text-black">
          <span>Status: Profile Editor Active</span>
          <span>UTF-8</span>
        </div>

      </div>
    </main>
  );
}
