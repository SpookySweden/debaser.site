'use client';

import { useState } from 'react';

export type TreePickerItem = {
  key: string;
  label: string;
  /** Small grey note after the label, the way a file dialog shows a type. */
  note?: string;
};

export type TreePickerGroup = {
  /** A folder in the tree: a page or a section of the site. */
  label: string;
  items: TreePickerItem[];
};

type TreePickerProps = {
  id: string;
  groups: TreePickerGroup[];
  value: string;
  onChange: (key: string) => void;
  /** Folders the dialog draws already open. The folder holding `value` always is. */
  openInitially?: string[];
  /** Shown when a folder is empty, so it does not just look broken. */
  emptyNote?: string;
};

/**
 * A tree of folders and items, drawn like the left pane of a Windows file dialog.
 *
 * Folders carry the Win95 [ - ] / [ + ] box and an indented list underneath, so a
 * destination is something you open and then click, not something you hunt for in a flat
 * list of forty. Only one item can be selected, and the folder holding the selection is
 * always open, which is what makes the choice legible at a glance.
 *
 * It is deliberately dumb: keys in, key out (see app/lib/forum/anchors.ts for the ones the
 * forum uses), so the same control serves any grouped choice.
 */
export default function TreePicker({ id, groups, value, onChange, openInitially = [], emptyNote }: TreePickerProps) {
  const valueFolder = groups.find((group) => group.items.some((item) => item.key === value))?.label;
  const [open, setOpen] = useState<string[]>(() =>
    [...new Set([...openInitially, ...(valueFolder === undefined ? [] : [valueFolder])])],
  );

  function toggle(folder: string) {
    setOpen((current) =>
      current.includes(folder) ? current.filter((entry) => entry !== folder) : [...current, folder],
    );
  }

  return (
    <div
      id={id}
      role="tree"
      aria-label="Filing destination"
      className="max-h-44 overflow-y-auto rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-1"
    >
      {groups.map((group) => {
        const isOpen = open.includes(group.label);

        return (
          <div key={group.label} role="treeitem" aria-expanded={isOpen} aria-selected={false} className="select-none">
            <button
              type="button"
              onClick={() => toggle(group.label)}
              aria-label={`${isOpen ? 'Close' : 'Open'} ${group.label}`}
              className="flex w-full cursor-pointer items-center gap-1 rounded-none px-1 py-[2px] text-left text-[10px] font-bold text-black hover:bg-ice-pale"
            >
              <span className="inline-block w-4 shrink-0 text-center font-mono">{isOpen ? '[-]' : '[+]'}</span>
              <span className="truncate">{group.label}</span>
            </button>

            {!isOpen ? null : group.items.length === 0 ? (
              <p className="ml-6 px-1 py-[2px] text-[10px] text-gray-700">{emptyNote ?? 'NOTHING HERE.'}</p>
            ) : (
              <ul role="group" className="ml-4">
                {group.items.map((item) => {
                  const selected = item.key === value;

                  return (
                    <li key={item.key} role="none">
                      <button
                        type="button"
                        role="treeitem"
                        aria-selected={selected}
                        onClick={() => onChange(item.key)}
                        className={`flex w-full cursor-pointer items-center gap-1 rounded-none px-1 py-[2px] text-left text-[10px] font-bold ${
                          selected ? 'bg-ena text-white' : 'text-black hover:bg-ice-pale'
                        }`}
                      >
                        <span className="inline-block w-4 shrink-0 text-center font-mono">-</span>
                        <span className="truncate">{item.label}</span>
                        {item.note === undefined ? null : (
                          <span className={`shrink-0 ${selected ? 'text-white' : 'text-gray-700'}`}>
                            [{item.note}]
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
