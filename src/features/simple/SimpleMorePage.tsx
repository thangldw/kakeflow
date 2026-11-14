import { ChevronRight, Settings, type LucideIcon } from 'lucide-react'
import { useId } from 'react'
import { localize } from '../../i18n'
import { navigation } from '../../navigation'
import type { PageId } from '../../types'
import type { UiMode } from './uiMode'

interface MoreEntry {
  readonly id: PageId
  readonly label: string
  readonly icon: LucideIcon
}

// Settings is reached from the sidebar foot in Full mode, so it is not part of `navigation`.
const settingsEntry: MoreEntry = { id: 'settings', label: '設定', icon: Settings }

function entries(pages: readonly PageId[]): MoreEntry[] {
  return pages.map((page) => {
    if (page === 'settings') return settingsEntry
    const item = navigation.find((entry) => entry.id === page)
    if (!item) throw new Error(`Unknown navigation page: ${page}`)
    return item
  })
}

// Every Full-mode page except the main tabs (overview, transactions, budgets) appears here exactly once.
const everydayEntries = entries(['import', 'capture', 'recurring', 'cards', 'family', 'settings'])
const advancedEntries = entries(['rules', 'investments', 'audit', 'reports'])

interface UiModeSwitchProps {
  readonly mode: UiMode
  readonly onChange: (mode: UiMode) => void
}

/** Two-option Simple/Full control; also used on the Settings page. */
export function UiModeSwitch({ mode, onChange }: UiModeSwitchProps) {
  const labelId = useId()
  const options: readonly { readonly value: UiMode; readonly label: string }[] = [
    { value: 'simple', label: localize("かんたん") },
    { value: 'full', label: localize("詳細") },
  ]
  return (
    <div className="simple-mode-switch" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="simple-mode-switch-label">{localize("表示モード")}</span>
      <div className="simple-mode-switch-options">
        {options.map((option) => (
          <button key={option.value} type="button" aria-pressed={mode === option.value} onClick={() => { if (mode !== option.value) onChange(option.value) }}>{option.label}</button>
        ))}
      </div>
    </div>
  )
}

function EntryList({ items, onNavigate }: { readonly items: readonly MoreEntry[]; readonly onNavigate: (page: PageId) => void }) {
  return (
    <ul className="simple-more-list">
      {items.map((item) => (
        <li key={item.id}>
          <button type="button" className="simple-more-item" data-page={item.id} onClick={() => onNavigate(item.id)}>
            <item.icon size={20} aria-hidden="true" />
            <span>{localize(item.label)}</span>
            <ChevronRight size={18} aria-hidden="true" className="simple-more-chevron" />
          </button>
        </li>
      ))}
    </ul>
  )
}

interface SimpleMorePageProps {
  readonly mode: UiMode
  readonly onModeChange: (mode: UiMode) => void
  readonly onNavigate: (page: PageId) => void
}

export function SimpleMorePage({ mode, onModeChange, onNavigate }: SimpleMorePageProps) {
  const advancedId = useId()
  return (
    <div className="simple-more">
      <EntryList items={everydayEntries} onNavigate={onNavigate} />
      <section className="simple-more-group" aria-labelledby={advancedId}>
        <h2 id={advancedId} className="simple-more-heading">{localize("詳細設定")}</h2>
        <EntryList items={advancedEntries} onNavigate={onNavigate} />
      </section>
      <div className="simple-card">
        <UiModeSwitch mode={mode} onChange={onModeChange} />
      </div>
    </div>
  )
}
