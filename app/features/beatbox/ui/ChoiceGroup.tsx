'use client';

import { useRef, type KeyboardEvent } from "react";
import { smallKey } from "./looks";

/** Where the arrow keys go in a set of choices. Null if the key isn't for moving. */
export function nextChoiceIndex(key: string, index: number, count: number): number | null {
  if (key === "ArrowRight" || key === "ArrowDown") return (index + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/**
 * A set of buttons where one is chosen. It's a single Tab stop, and the arrow keys change the
 * choice, as the standard radio group pattern says.
 */
export function ChoiceGroup<T extends string | number>({
  label,
  keyName,
  value,
  options,
  onChange,
  look = smallKey,
  stacked = false,
}: {
  label: string;
  /** The page-wide key that also changes this, shown beside the name. */
  keyName?: string;
  value: T;
  options: readonly { readonly value: T; readonly label: string }[];
  onChange: (value: T) => void;
  look?: (on: boolean) => string;
  /** Its name above, and the choices lined up in two columns, for a window. */
  stacked?: boolean;
}) {
  const group = useRef<HTMLDivElement>(null);
  const chosen = options.findIndex((option) => option.value === value);

  function keyDown(event: KeyboardEvent) {
    const next = nextChoiceIndex(event.key, chosen, options.length);
    const option = next === null ? undefined : options[next];
    if (!option || next === null) return;
    event.preventDefault();
    onChange(option.value);
    group.current?.querySelectorAll("button")[next]?.focus();
  }

  const keys = options.map((option) => (
    <button
      key={String(option.value)}
      type="button"
      role="radio"
      aria-checked={option.value === value}
      tabIndex={option.value === value ? 0 : -1}
      onClick={() => onChange(option.value)}
      className={stacked ? `${look(option.value === value)} text-left whitespace-normal! wrap-anywhere` : look(option.value === value)}
    >
      {option.value === value ? "> " : ""}
      {option.label}
    </button>
  ));
  const name = (
    <span className={`font-bold uppercase ${look === smallKey ? "text-bb-large" : "text-display"}`} title={keyName ? `Key: ${keyName}` : undefined}>
      {label}
    </span>
  );

  if (stacked) {
    return (
      <div ref={group} role="radiogroup" aria-label={label} onKeyDown={keyDown} className="flex w-full flex-col gap-1">
        {name}
        <div className="grid w-full grid-cols-1 gap-1 sm:grid-cols-2">{keys}</div>
      </div>
    );
  }

  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={label}
      onKeyDown={keyDown}
      className={`flex flex-wrap items-center ${look === smallKey ? "gap-bb-gutter" : "gap-1"}`}
    >
      {name}
      {keys}
    </div>
  );
}
