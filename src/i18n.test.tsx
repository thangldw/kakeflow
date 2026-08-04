import { fireEvent, render, screen } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nProvider, hasTranslation, localize, useI18n } from './i18n'
import { DISPLAY_LABEL_SOURCES } from './displayLabels'

function LocaleProbe() {
  const { locale, setLocale, text } = useI18n()
  const [renderCount, setRenderCount] = useState(0)
  return <>
    <output>{locale}:{text('家計の概要')}</output>
    <output data-testid="global-localize">{renderCount}:{localize('設定')}</output>
    <button onClick={() => setLocale('en')}>English</button>
    <button onClick={() => setLocale('vi')}>Vietnamese</button>
    <button onClick={() => setRenderCount((count) => count + 1)}>Rerender</button>
  </>
}

describe('application localization', () => {
  afterEach(() => {
    localStorage.removeItem('kakeflow.locale')
    document.documentElement.lang = 'en'
  })

  it('keeps every domain display label translated in English and Vietnamese', () => {
    expect(DISPLAY_LABEL_SOURCES.filter((source) => !hasTranslation('en', source))).toEqual([])
    expect(DISPLAY_LABEL_SOURCES.filter((source) => !hasTranslation('vi', source))).toEqual([])
  })

  it('uses Japanese as the stable default', () => {
    render(<I18nProvider><LocaleProbe /></I18nProvider>)
    expect(screen.getByText('ja:家計の概要')).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('ja')
  })

  it('switches and persists English and Vietnamese', () => {
    render(<I18nProvider><LocaleProbe /></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'English' }))
    expect(screen.getByText('en:Household overview')).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('en')
    expect(localStorage.getItem('kakeflow.locale')).toBe('en')

    fireEvent.click(screen.getByRole('button', { name: 'Vietnamese' }))
    expect(screen.getByText('vi:Tổng quan tài chính gia đình')).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('vi')
    expect(localStorage.getItem('kakeflow.locale')).toBe('vi')

    fireEvent.click(screen.getByRole('button', { name: 'Rerender' }))
    expect(screen.getByTestId('global-localize')).toHaveTextContent('1:Cài đặt')
  })

  it('does not reset global localization during the Strict Mode effect cycle', () => {
    localStorage.setItem('kakeflow.locale', 'vi')
    render(<StrictMode><I18nProvider><LocaleProbe /></I18nProvider></StrictMode>)

    expect(screen.getByText('vi:Tổng quan tài chính gia đình')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Rerender' }))
    expect(screen.getByTestId('global-localize')).toHaveTextContent('1:Cài đặt')
  })
})
