/**
 * Font-size preference row registered into the General section item slot:
 * title + body-text-only description (carries the visible range) + stepper
 * pill (draft-buffered numeric input with arrow-key stepping, always-visible
 * up/down buttons with midpoint-split touch zones) + a px unit label after
 * the pill. Registered by this package — the theme feature owns the content
 * font-size setting the same way it owns the appearance preference. The
 * displayed value follows the persisted setting, never the click echo.
 */
import {
  IconChevronDownOutline14, IconChevronUpOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from '../theme-settings.ts'
import { useState } from 'react'
import type { KeyboardEvent, ChangeEvent } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createFontSizeRowStore } from './settings-store.ts'
import css from './FontSizeRow.module.css'

/** Injected business face: the preference write (t rides the standard locale seat). */
export interface FontSizeRowInjected {
  /** Change the content font size (integer px within FONT_SIZE_MIN..FONT_SIZE_MAX). */
  setFontSize: (px: number) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type FontSizeRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createFontSizeRowStore>>
  & PropsLocale<'settings.theme'> & FontSizeRowInjected

/**
 * Render the font-size row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function FontSizeRow({ t, setFontSize, useStore }: FontSizeRowComponentProps) {
  const fontSize = useStore(s => s.fontSize)
  // Draft buffer: while the field is focused the raw text lives here, so
  // out-of-range intermediates ("1" of "13") never fight the controlled
  // value. In-range edits commit live; the rest commit clamped on blur or
  // Enter. An invalid (NaN/empty) draft is discarded — the persisted value
  // wins, so clearing the field can never drop the setting to the minimum.
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? String(fontSize)
  const commit = (): void => {
    if (draft === null) return
    const v = Number(draft)
    if (draft.trim() !== '' && !Number.isNaN(v)) {
      setFontSize(Math.min(Math.max(Math.round(v), FONT_SIZE_MIN), FONT_SIZE_MAX))
    }
    setDraft(null)
  }
  const onInput = (e: ChangeEvent<HTMLInputElement>): void => {
    const raw = e.target.value
    setDraft(raw)
    const v = Number(raw)
    if (raw !== '' && !Number.isNaN(v) && v >= FONT_SIZE_MIN && v <= FONT_SIZE_MAX) setFontSize(v)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setDraft(null)
      setFontSize(Math.min(fontSize + 1, FONT_SIZE_MAX))
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setDraft(null)
      setFontSize(Math.max(fontSize - 1, FONT_SIZE_MIN))
    }
  }
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('fontSize.title')}</div>
        <div className={css.desc}>{t('fontSize.description')}</div>
      </div>
      <div className={css.control}>
        <div className={css.stepper} role="group" aria-label={t('fontSize.title')}>
          <input
            type="number"
            className={css.directInput}
            value={shown}
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            step={1}
            onChange={onInput}
            onBlur={commit}
            onKeyDown={onKey}
            aria-label={t('fontSize.title')}
            inputMode="numeric"
          />
          <span className={css.arrows}>
            <button
              type="button"
              className={`${css.arrow} ${css.arrowUp}`}
              aria-label={t('fontSize.increase')}
              disabled={fontSize >= FONT_SIZE_MAX}
              onClick={() => { setDraft(null); setFontSize(fontSize + 1) }}
            >
              <IconChevronUpOutline14 size={14} />
            </button>
            <button
              type="button"
              className={`${css.arrow} ${css.arrowDown}`}
              aria-label={t('fontSize.decrease')}
              disabled={fontSize <= FONT_SIZE_MIN}
              onClick={() => { setDraft(null); setFontSize(fontSize - 1) }}
            >
              <IconChevronDownOutline14 size={14} />
            </button>
          </span>
        </div>
        <span className={css.unit}>{t('fontSize.unit')}</span>
      </div>
    </div>
  )
}
