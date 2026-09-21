import type { Metadata } from 'next';
import AccountConsole from '../components/AccountConsole';
import SiteNav from '../components/SiteNav';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Account Manager',
  description: 'Create an account, log in and manage your Debaser profile and session.',
};

export default function Account() {
  return (
    <main className="min-h-screen bg-[#008080] p-4 font-mono select-none flex items-center justify-center">
      <div className="w-[95vw] h-[92vh] bg-[#c0c0c0] border-t-2 border-l-2 border-white border-r-2 border-b-2 border-black flex flex-col shadow-2xl rounded-none">

        {/* Title Bar */}
        <div className="bg-[#000080] text-white px-3 py-1 flex justify-between items-center font-bold text-sm">
          <span>DEBASER_OS - v1.0 [ACCOUNT MANAGER]</span>
          <div className="flex gap-1">
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">_</button>
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">□</button>
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">×</button>
          </div>
        </div>

        {/* Taskbar Navigation */}
        <SiteNav active="account" />

        {/* Content Body - Account Console */}
        <div className="flex-1 bg-white border-inset border-2 border-gray-600 m-2 p-4 overflow-y-auto text-black">
          <h1 className="text-3xl font-bold mb-2">DEBASER.SITE // ACCOUNT MANAGER</h1>
          <p className="text-xs mb-4 leading-relaxed">
            Create an account, log in, and manage how your posts are signed on the board. Reading and posting stay open
            to guests - an account attaches your name and id to whatever you file, which is what the rows already store
            for the day Supabase Auth takes over.
          </p>

          <AccountConsole />
        </div>

        {/* Status Bar */}
        <div className="px-3 py-1 text-xs bg-[#c0c0c0] border-t border-white flex justify-between text-black">
          <span>Status: Session Manager Active</span>
          <span>UTF-8</span>
        </div>

      </div>
    </main>
  );
}
