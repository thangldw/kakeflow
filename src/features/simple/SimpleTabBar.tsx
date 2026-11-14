import { localize } from '../../i18n'
import { SIMPLE_TAB_ICONS, SIMPLE_TABS, type SimpleTab } from './simpleNavigation'

interface SimpleTabBarProps {
  readonly active: SimpleTab
  readonly onSelect: (tab: SimpleTab) => void
}

/** Bottom tab bar for Simple mode on narrow screens; wider screens show the same entries in the sidebar. */
export function SimpleTabBar({ active, onSelect }: SimpleTabBarProps) {
  return (
    <nav className="simple-tabbar" aria-label={localize("主なページ")}>
      {SIMPLE_TABS.map((tab) => {
        const Icon = SIMPLE_TAB_ICONS[tab.id]
        const current = tab.id === active
        return (
          <button key={tab.id} type="button" className="simple-tabbar-item" aria-current={current ? 'page' : undefined} onClick={() => onSelect(tab.id)}>
            <Icon size={22} aria-hidden="true" />
            <span className="simple-tab-label">{localize(tab.label)}</span>
          </button>
        )
      })}
    </nav>
  )
}
