import type { Metadata } from 'next';
import CommsConsole from '../components/CommsConsole';
import SiteNav from '../components/SiteNav';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Comms',
  description: 'Direct messages between accounts: conversations down the left, the open thread on the right.',
};

export default function CommsPage() {
  return (
    <main className="min-h-screen bg-[#008080] p-4 font-mono select-none flex items-center justify-center">
      <div className="w-[95vw] h-[92vh] bg-[#c0c0c0] border-t-2 border-l-2 border-white border-r-2 border-b-2 border-black flex flex-col shadow-2xl rounded-none">

        {/* Title Bar */}
        <div className="bg-[#000080] text-white px-3 py-1 flex justify-between items-center font-bold text-sm">
          <span>DEBASER_OS - v1.0 [COMMS]</span>
          <div className="flex gap-1">
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">_</button>
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">□</button>
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">×</button>
          </div>
        </div>

        {/* Taskbar Navigation */}
        <SiteNav active="comms" />

        {/* Content Body - Comms */}
        <div className="flex-1 bg-white border-inset border-2 border-gray-600 m-2 p-4 overflow-y-auto text-black">
          <h1 className="text-3xl font-bold mb-2">DEBASER.SITE // COMMS</h1>
          <p className="text-xs mb-4 leading-relaxed">
            Direct messages between accounts: conversations down the left, the open one on the right. A message
            that arrives while the site is open pops up as a small window on a desktop, and takes a phone straight
            here. While the store is the mock one every conversation lives in this browser only - Supabase brings
            the real thing, and with it messages between two different machines.
          </p>

          <CommsConsole />
        </div>

        {/* Status Bar */}
        <div className="px-3 py-1 text-xs bg-[#c0c0c0] border-t border-white flex justify-between text-black">
          <span>Status: Comms Online</span>
          <span>UTF-8</span>
        </div>

      </div>
    </main>
  );
}
