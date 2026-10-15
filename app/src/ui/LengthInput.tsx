import { useEffect, useState } from 'react';
import { useStudio } from './context';
import { inputLength, parseLength } from './format';

/**
 * A length field in the display unit. It keeps what the user types while they type, and reports
 * only valid values; invalid text is flagged instead of being written to the project.
 */
export function LengthInput({
  label,
  value,
  min,
  max,
  allowZero = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  allowZero?: boolean;
  onChange: (mm: number) => void;
}) {
  const { unit } = useStudio();
  const [text, setText] = useState(inputLength(value, unit));
  useEffect(() => {
    if (parseLength(text, unit) !== value) setText(inputLength(value, unit));
  }, [value, unit]);
  const parsed = parseLength(text, unit);
  const valid =
    Number.isFinite(parsed) && (allowZero ? parsed >= min : parsed > min) && parsed <= max;
  return (
    <label className="field">
      {label}, {unit}
      <input
        className="mono"
        inputMode="decimal"
        value={text}
        aria-invalid={!valid}
        onChange={(event) => {
          setText(event.target.value);
          const mm = parseLength(event.target.value, unit);
          if (Number.isFinite(mm) && (allowZero ? mm >= min : mm > min) && mm <= max) onChange(mm);
        }}
      />
      {!valid && (
        <span className="field-error">
          Enter a number {allowZero ? 'from' : 'above'} {inputLength(min, unit)} up to{' '}
          {inputLength(max, unit)}.
        </span>
      )}
    </label>
  );
}
