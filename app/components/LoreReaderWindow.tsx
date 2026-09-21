import Image from 'next/image';

export default function LoreReaderWindow() {
  return (
    <div className="border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] p-4">
      <div className="bg-[#000080] text-white font-bold px-2 py-1 flex justify-between items-center mb-2">
        <span>Lore Reader</span>
        <span>F2</span>
      </div>
      <div className="bg-white p-4 text-sm font-mono">
        <p className="mb-4">
          The lore of Debaser begins in the ancient times when the first comic book was drawn...Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
        </p>
        <p className="mb-4">
          Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
        </p>
        <p>
          Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.
        </p>
      </div>
    </div>
  );
}
