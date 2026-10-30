import { PLATE } from '../lib/ui/controls';

type ChooseFileKeyProps = {
  id: string;
  accept: string;
  /** What a screen reader hears, since the key itself only says CHOOSE FILE. */
  label: string;
  onChoose: (file: File) => void;
};

/**
 * A file picker drawn as a bracket key.
 *
 * The browser's own picker ("Choose File / No file chosen") was the one control in the customiser that
 * was not a key. The input is still there - kept for the keyboard and screen readers, hidden from the
 * eye - and the key is its label, so pressing the key opens the same picker. Its focus ring is the
 * key's, read off the hidden input (`peer-focus-visible`).
 */
export default function ChooseFileKey({ id, accept, label, onChoose }: ChooseFileKeyProps) {
  return (
    <span className="block">
      <input
        id={id}
        type="file"
        accept={accept}
        aria-label={label}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared, so choosing the same file again still counts as a choice.
          event.target.value = '';
          if (file !== undefined) onChoose(file);
        }}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        className={`${PLATE} inline-block peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-bubble`}
      >
        [ CHOOSE FILE ]
      </label>
    </span>
  );
}
