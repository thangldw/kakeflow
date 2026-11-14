import { useId } from 'react'
import { localize, useI18n, type AppLocale } from '../i18n'

// Each language is named in itself, so a reader can always find their own.
const LANGUAGES: readonly { readonly locale: AppLocale; readonly label: string; readonly lang: string }[] = [
  { locale: 'ja', label: '日本語', lang: 'ja' },
  { locale: 'en', label: 'English', lang: 'en' },
  { locale: 'vi', label: 'Tiếng Việt', lang: 'vi' },
]

/** Three-option language control for the PWA (vault setup and More); the choice is stored by the i18n provider. */
export function LanguageSwitch() {
  const labelId = useId()
  const { locale, setLocale } = useI18n()
  return <div className="simple-mode-switch pwa-language-switch" role="group" aria-labelledby={labelId}>
    <span id={labelId} className="simple-mode-switch-label">{localize("言語")}</span>
    <div className="simple-mode-switch-options pwa-language-options">
      {LANGUAGES.map((option) => <button key={option.locale} type="button" lang={option.lang} aria-pressed={locale === option.locale}
        onClick={() => { if (locale !== option.locale) setLocale(option.locale) }}>{option.label}</button>)}
    </div>
  </div>
}
