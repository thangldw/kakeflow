import { useEffect, useRef, useState } from 'react'
import { formatYenText, parseYenText } from './yen'

interface YenInputProps {
  readonly value: number
  readonly onChange: (value: number) => void
  readonly allowNegative?: boolean
  /** Show the 円 mark after the field (drawn with CSS so it is not part of the label text). */
  readonly suffix?: boolean
  readonly 'aria-label'?: string
}

/**
 * Whole-yen field: digits only while typing, thousands separators after blur,
 * invalid text is flagged and never reaches the parent. Put it inside a label
 * as usual; the unit is a CSS pseudo-element so label-based queries still match.
 */
export function YenInput({ value, onChange, allowNegative = false, suffix = true, 'aria-label': ariaLabel }: YenInputProps) {
  const [text, setText] = useState(() => formatYenText(value))
  const [focused, setFocused] = useState(false)
  const parsed = parseYenText(text, allowNegative)

  // Follow outside changes only: a value we reported ourselves never rewrites the text,
  // and invalid text stays visible (flagged) instead of silently reverting.
  const reported = useRef(value)
  useEffect(() => {
    if (!focused && value !== reported.current) {
      reported.current = value
      setText(formatYenText(value))
    }
  }, [focused, value])

  return <span className={`yen-field${suffix ? ' yen-field--suffix' : ''}`}>
    <input
      type="text" inputMode={allowNegative ? 'text' : 'numeric'} autoComplete="off" value={text} aria-label={ariaLabel}
      aria-invalid={parsed == null}
      onFocus={() => { setFocused(true); setText((current) => { const n = parseYenText(current, allowNegative); return n == null ? current : String(n) }) }}
      onChange={(event) => {
        setText(event.target.value)
        const next = parseYenText(event.target.value, allowNegative)
        if (next != null) { reported.current = next; onChange(next) }
      }}
      onBlur={() => { setFocused(false); setText((current) => { const n = parseYenText(current, allowNegative); return n == null ? current : formatYenText(n) }) }}
    />
  </span>
}
