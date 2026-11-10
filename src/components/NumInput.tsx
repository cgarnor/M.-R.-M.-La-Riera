import React, { useState } from 'react';
import { fmtNum } from '../state/analysis';

interface Props {
  /** Current value (undefined = empty, only with `allowEmpty`). */
  value: number | undefined;
  /** Called with the parsed and clamped value when the user confirms (blur, Enter or arrow keys). */
  onCommit: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Round to an integer. */
  integer?: boolean;
  /** Maximum decimals shown. */
  digits?: number;
  allowEmpty?: boolean;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  /** Accessible name (the visible label is not a <label> element). */
  ariaLabel?: string;
}

/** Shortest representation of `v` with at most `digits` decimals, in the interface language. */
function show(v: number | undefined, digits: number): string {
  if (v === undefined || !Number.isFinite(v)) return '';
  const s = fmtNum(v, digits);
  return s.includes(',') || s.includes('.') ? s.replace(/[.,]?0+$/, '') : s;
}

/**
 * Numeric text field. The text is edited freely and only validated when it is confirmed, so
 * intermediate values ("", "1", "0,") never fight with the limits. Accepts "," or "." as decimal mark.
 */
export function NumInput({ value, onCommit, min = -Infinity, max = Infinity, step = 1, integer, digits = 6, allowEmpty, placeholder, className = 'input num', style, title, ariaLabel }: Props) {
  const [text, setText] = useState<string | null>(null);

  const clamp = (v: number) => {
    const c = Math.min(max, Math.max(min, v));
    return integer ? Math.round(c) : c;
  };

  const commit = (raw: string) => {
    setText(null);
    const s = raw.trim().replace(',', '.');
    if (s === '') { if (allowEmpty) onCommit(undefined); return; }
    const v = Number(s);
    if (Number.isFinite(v)) onCommit(clamp(v));
  };

  return (
    <input
      className={className}
      type="text"
      inputMode="decimal"
      spellCheck={false}
      autoComplete="off"
      placeholder={placeholder}
      title={title}
      aria-label={ariaLabel}
      style={style}
      value={text ?? show(value, digits)}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
        else if (e.key === 'Escape') setText(null);
        else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const cur = Number(((e.target as HTMLInputElement).value || '0').replace(',', '.'));
          const base = Number.isFinite(cur) ? cur : value ?? 0;
          const v = clamp(+(base + (e.key === 'ArrowUp' ? step : -step)).toPrecision(12));
          setText(null);
          onCommit(v);
        }
      }}
    />
  );
}
